// Giving: online gifts through Stripe (one-time or recurring; card, bank account, Apple Pay or
// Google Pay), what each giver sees of their own giving, and the finance reports. Who gave what
// is only shown to accounts with the Finance permission (not to staff or admins without it).
import { Router } from 'express';
import { requireRole, siteOrigin } from '../auth.js';
import { getSetting, setSetting, tx } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str, required, isDate, audit, localNow } from '../http.js';
import { stripe, stripeConfigured, publishableKey, verifyWebhook, coverFee } from '../stripe.js';
import { sendMail, canSendMail } from '../mail.js';

export const EVERY = { week: { interval: 'week', interval_count: 1, label: 'every week' }, '2week': { interval: 'week', interval_count: 2, label: 'every 2 weeks' }, month: { interval: 'month', interval_count: 1, label: 'every month' } };
const money = (c) => `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const name = (p) => (p?.first_name ? `${p.nickname || p.first_name} ${p.last_name || ''}`.trim() : '');

export function requireFinance(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!req.user.finance) return res.status(403).json({ error: 'Giving information is only for people with Finance access.' });
  next();
}

// A tiny per-address limit on starting payments.
const recent = new Map();
function rateLimit(key, max = 20, windowMs = 10 * 60e3) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return true;
}

export default function givingRoutes(db) {
  const r = Router();
  const tz = () => db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';
  const today = () => localNow(tz()).date;
  const fees = () => ({ percent: getSetting(db, 'giving_fee_percent', 2.2), fixed_cents: getSetting(db, 'giving_fee_fixed', 30) });
  const funds = (all = false) => db.prepare(`SELECT * FROM funds ${all ? '' : 'WHERE active = 1'} ORDER BY sort, name`).all();
  const fund = (id) => db.prepare('SELECT * FROM funds WHERE id = ?').get(id);
  const person = (id) => (id ? db.prepare('SELECT id, first_name, last_name, nickname, email, campus_id FROM people WHERE id = ?').get(id) : null);
  const byEmail = (email) => (email ? db.prepare("SELECT id, first_name, last_name, nickname, email, campus_id FROM people WHERE lower(email) = lower(?) AND archived = 0 ORDER BY id LIMIT 1").get(email) : null);

  // ---------------------------------------------------------------- the giving page
  r.get('/giving/config', (req, res) => {
    const p = person(req.user?.personId);
    res.json({
      enabled: stripeConfigured(),
      publishable_key: stripeConfigured() ? publishableKey() : '',
      funds: funds().map((f) => ({ id: f.id, name: f.name, section: f.section, is_default: Boolean(f.is_default) })),
      fee: fees(),
      every: Object.fromEntries(Object.entries(EVERY).map(([k, v]) => [k, v.label])),
      me: req.user ? { name: name(p) || req.user.name, email: p?.email || req.user.email, linked: Boolean(p) } : null,
    });
  });

  // A signed-in giver's Stripe customer, made the first time they give.
  async function customerFor(p) {
    const row = db.prepare('SELECT customer_id FROM giving_customers WHERE person_id = ?').get(p.id);
    if (row) return row.customer_id;
    const c = await stripe('POST', '/customers', { email: p.email || undefined, name: name(p), metadata: { person_id: p.id } });
    db.prepare('INSERT OR IGNORE INTO giving_customers (person_id, customer_id) VALUES (?, ?)').run(p.id, c.id);
    return c.id;
  }

  // Starts Stripe's payment form (shown inside our page). Card numbers never reach this server.
  r.post('/giving/checkout', async (req, res) => {
    if (!stripeConfigured()) throw new HttpError(503, 'Online giving isn’t set up yet.');
    if (!rateLimit(req.ip)) throw new HttpError(429, 'Too many tries. Please wait a few minutes.');
    const b = req.body || {};
    const amount = Math.round(Number(String(b.amount ?? '').replace(/[$,\s]/g, '')) * 100);
    if (!Number.isFinite(amount) || amount < 100) throw bad('The smallest gift online is $1.');
    if (amount > 10_000_000) throw bad('For gifts over $100,000, please contact the church office.');
    const f = fund(int(b.fund_id, 'fund'));
    if (!f || !f.active) throw bad('Pick a fund.');
    const every = EVERY[b.every] ? b.every : null;
    const fee = b.cover_fee ? coverFee(amount, fees().percent, fees().fixed_cents) : 0;
    const p = person(req.user?.personId);
    const email = str(p?.email || b.email || req.user?.email, 200).toLowerCase();
    const giver = name(p) || str(b.name, 120);
    if (!req.user && (!giver || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw bad('Please enter your name and email for your receipt.');
    const meta = { fund_id: f.id, amount_cents: amount, fee_cents: fee, every: every || 'once', person_id: p?.id || '', name: giver };
    const origin = siteOrigin(req);
    const back = b.return_to === 'web' ? `${origin}/give?done={CHECKOUT_SESSION_ID}` : `${origin}/app/#/give?done={CHECKOUT_SESSION_ID}`;
    const customer = p ? await customerFor(p) : undefined;
    const description = `${f.name}${every ? ` (${EVERY[every].label})` : ''}`;
    const session = await stripe('POST', '/checkout/sessions', {
      ui_mode: 'embedded',
      mode: every ? 'subscription' : 'payment',
      return_url: back,
      payment_method_types: ['card', 'us_bank_account'],
      customer,
      customer_email: customer ? undefined : email || undefined,
      customer_creation: !customer && !every ? 'always' : undefined,
      submit_type: every ? undefined : 'donate',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amount + fee,
          product_data: { name: fee ? `${f.name} (including ${money(fee)} to cover fees)` : f.name },
          recurring: every ? { interval: EVERY[every].interval, interval_count: EVERY[every].interval_count } : undefined,
        },
      }],
      metadata: meta,
      payment_intent_data: every ? undefined : { metadata: meta, description },
      subscription_data: every ? { metadata: meta, description } : undefined,
    }).catch((e) => { throw new HttpError(502, e.message); });
    res.json({ client_secret: session.client_secret, session_id: session.id });
  });

  // The thank-you screen after paying.
  r.get('/giving/session/:id', async (req, res) => {
    if (!stripeConfigured()) throw notFound('Gift');
    if (!/^cs_[\w]+$/.test(req.params.id)) throw notFound('Gift');
    const s = await stripe('GET', `/checkout/sessions/${req.params.id}`).catch(() => null);
    if (!s) throw notFound('Gift');
    const f = fund(Number(s.metadata?.fund_id));
    res.json({
      status: s.status, paid: s.payment_status === 'paid', processing: s.status === 'complete' && s.payment_status === 'unpaid',
      amount_cents: Number(s.metadata?.amount_cents) || s.amount_total, fee_cents: Number(s.metadata?.fee_cents) || 0,
      fund: f?.name || '', every: EVERY[s.metadata?.every]?.label || '', email: s.customer_details?.email || '',
    });
  });

  // ---------------------------------------------------------------- my giving
  const mine = (req) => {
    const p = person(req.user.personId);
    const email = (p?.email || req.user.email || '').toLowerCase();
    return { p, email };
  };
  const ownsRecurring = (req, g) => {
    const { p, email } = mine(req);
    return g && ((p && g.person_id === p.id) || (email && g.email.toLowerCase() === email));
  };

  r.get('/giving/mine', requireRole('volunteer'), (req, res) => {
    const { p, email } = mine(req);
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : today().slice(0, 4);
    const gifts = db.prepare(`SELECT g.id, g.amount_cents, g.fee_cents, g.method, g.source, g.status, g.given_on, f.name fund
      FROM gifts g LEFT JOIN funds f ON f.id = g.fund_id
      WHERE (g.person_id = ? OR (g.person_id IS NULL AND lower(g.email) = ? AND ? != '')) AND g.given_on LIKE ? ORDER BY g.given_on DESC, g.id DESC`).all(p?.id ?? -1, email, email, `${year}%`);
    const recurring = db.prepare(`SELECT rg.id, rg.amount_cents, rg.fee_cents, rg.every, rg.status, rg.created_at, f.name fund, rg.fund_id
      FROM recurring_gifts rg LEFT JOIN funds f ON f.id = rg.fund_id
      WHERE rg.status != 'canceled' AND (rg.person_id = ? OR (lower(rg.email) = ? AND ? != '')) ORDER BY rg.id`).all(p?.id ?? -1, email, email);
    const total = gifts.filter((g) => g.status === 'succeeded').reduce((s, g) => s + g.amount_cents, 0);
    res.json({ year, total_cents: total, gifts, recurring: recurring.map((x) => ({ ...x, every_label: EVERY[x.every]?.label || x.every })) });
  });

  r.post('/giving/recurring/:id/cancel', requireRole('volunteer'), async (req, res) => {
    const g = db.prepare('SELECT * FROM recurring_gifts WHERE id = ?').get(int(req.params.id));
    if (!ownsRecurring(req, g)) throw notFound('Recurring gift');
    await stripe('DELETE', `/subscriptions/${g.subscription_id}`).catch((e) => { if (e.status !== 404) throw new HttpError(502, e.message); });
    db.prepare("UPDATE recurring_gifts SET status = 'canceled', canceled_at = datetime('now') WHERE id = ?").run(g.id);
    res.json({ ok: true });
  });

  // Change the amount or fund of a recurring gift (from the next one on).
  r.patch('/giving/recurring/:id', requireRole('volunteer'), async (req, res) => {
    const g = db.prepare('SELECT * FROM recurring_gifts WHERE id = ?').get(int(req.params.id));
    if (!ownsRecurring(req, g) || g.status === 'canceled') throw notFound('Recurring gift');
    const b = req.body || {};
    const amount = b.amount !== undefined ? Math.round(Number(String(b.amount).replace(/[$,\s]/g, '')) * 100) : g.amount_cents;
    if (!Number.isFinite(amount) || amount < 100) throw bad('The smallest gift online is $1.');
    const f = fund(b.fund_id !== undefined ? int(b.fund_id) : g.fund_id);
    if (!f || !f.active) throw bad('Pick a fund.');
    const fee = g.fee_cents ? coverFee(amount, fees().percent, fees().fixed_cents) : 0;
    const sub = await stripe('GET', `/subscriptions/${g.subscription_id}`).catch((e) => { throw new HttpError(502, e.message); });
    const item = sub.items?.data?.[0];
    const meta = { ...sub.metadata, fund_id: f.id, amount_cents: amount, fee_cents: fee };
    await stripe('POST', `/subscriptions/${g.subscription_id}`, {
      proration_behavior: 'none',
      metadata: meta,
      items: [{ id: item.id, price_data: { currency: 'usd', unit_amount: amount + fee, product: item.price.product, recurring: { interval: EVERY[g.every].interval, interval_count: EVERY[g.every].interval_count } } }],
    }).catch((e) => { throw new HttpError(502, e.message); });
    db.prepare('UPDATE recurring_gifts SET amount_cents = ?, fee_cents = ?, fund_id = ? WHERE id = ?').run(amount, fee, f.id, g.id);
    res.json({ ok: true });
  });

  // Stripe's own page for changing the card or bank account on file.
  r.post('/giving/payment-method', requireRole('volunteer'), async (req, res) => {
    const { p } = mine(req);
    const row = p && db.prepare('SELECT customer_id FROM giving_customers WHERE person_id = ?').get(p.id);
    const cust = row?.customer_id || db.prepare("SELECT customer_id FROM recurring_gifts WHERE status != 'canceled' AND lower(email) = lower(?) AND customer_id IS NOT NULL LIMIT 1").get(mine(req).email)?.customer_id;
    if (!cust) throw bad('There’s no payment method on file yet.');
    const s = await stripe('POST', '/billing_portal/sessions', { customer: cust, return_url: `${siteOrigin(req)}/app/#/giving` })
      .catch((e) => { throw new HttpError(502, `${e.message} (An admin may need to turn on Stripe’s customer portal.)`); });
    res.json({ url: s.url });
  });

  // ---------------------------------------------------------------- finance
  const range = (q) => {
    const to = isDate(q.to) ? q.to : today();
    const from = isDate(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
    return { from, to };
  };
  const GIFT = `SELECT g.*, f.name fund, f.section, p.first_name, p.last_name, p.nickname, c.short_name campus
    FROM gifts g LEFT JOIN funds f ON f.id = g.fund_id LEFT JOIN people p ON p.id = g.person_id LEFT JOIN campuses c ON c.id = g.campus_id`;
  const giftRow = (g) => ({ ...g, giver: name(g) || g.name || g.email || 'Anonymous', in_people: Boolean(g.person_id) });

  r.get('/finance/summary', requireFinance, (req, res) => {
    const { from, to } = range(req.query);
    const where = "g.status = 'succeeded' AND g.given_on BETWEEN ? AND ?";
    const total = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) total, COUNT(*) gifts, COUNT(DISTINCT COALESCE(person_id, lower(email))) givers, COALESCE(SUM(fee_cents), 0) fees
      FROM gifts g WHERE ${where}`).get(from, to);
    res.json({
      from, to, ...total,
      by_fund: db.prepare(`SELECT f.id, f.name, f.section, COALESCE(SUM(g.amount_cents), 0) total, COUNT(g.id) gifts FROM funds f
        LEFT JOIN gifts g ON g.fund_id = f.id AND ${where} GROUP BY f.id HAVING total > 0 OR f.active = 1 ORDER BY f.sort, f.name`).all(from, to),
      by_method: db.prepare(`SELECT method, SUM(amount_cents) total, COUNT(*) gifts FROM gifts g WHERE ${where} GROUP BY method ORDER BY total DESC`).all(from, to),
      by_week: db.prepare(`SELECT date(given_on, 'weekday 0', '-6 days') week, SUM(amount_cents) total FROM gifts g WHERE ${where} GROUP BY week ORDER BY week`).all(from, to),
      by_campus: db.prepare(`SELECT COALESCE(c.short_name, c.name, 'No campus') campus, SUM(g.amount_cents) total FROM gifts g LEFT JOIN campuses c ON c.id = g.campus_id WHERE ${where} GROUP BY g.campus_id ORDER BY total DESC`).all(from, to),
      pending: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_cents), 0) total FROM gifts WHERE status = 'pending'").get(),
      recurring: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE every WHEN 'week' THEN amount_cents * 52 / 12 WHEN '2week' THEN amount_cents * 26 / 12 ELSE amount_cents END), 0) monthly
        FROM recurring_gifts WHERE status = 'active'`).get(),
    });
  });

  function giftList(req) {
    const { from, to } = range(req.query);
    const args = [from, to];
    let extra = '';
    if (req.query.fund_id) { extra += ' AND g.fund_id = ?'; args.push(int(req.query.fund_id)); }
    if (req.query.status) { extra += ' AND g.status = ?'; args.push(String(req.query.status)); }
    const q = str(req.query.q, 100).toLowerCase();
    if (q) { extra += " AND (lower(COALESCE(p.first_name || ' ' || p.last_name, '')) LIKE ? OR lower(g.name) LIKE ? OR lower(g.email) LIKE ?)"; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    return db.prepare(`${GIFT} WHERE g.given_on BETWEEN ? AND ?${extra} ORDER BY g.given_on DESC, g.id DESC LIMIT 2000`).all(...args).map(giftRow);
  }
  r.get('/finance/gifts', requireFinance, (req, res) => res.json(giftList(req)));
  r.get('/finance/gifts.csv', requireFinance, (req, res) => {
    const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    const rows = giftList(req).map((g) => [g.given_on, g.giver, g.email, g.fund, (g.amount_cents / 100).toFixed(2), (g.fee_cents / 100).toFixed(2), g.method, g.source, g.status, g.campus || '', g.check_number].map(cell).join(','));
    res.setHeader('Content-Disposition', `attachment; filename="gifts-${range(req.query).from}-to-${range(req.query).to}.csv"`);
    res.type('text/csv').send(['Date,Giver,Email,Fund,Amount,Fee covered,Method,Source,Status,Campus,Check #', ...rows].join('\n'));
    audit(db, req, 'finance.export', range(req.query));
  });

  r.get('/finance/donors', requireFinance, (req, res) => {
    const { from, to } = range(req.query);
    res.json(db.prepare(`SELECT g.person_id, MAX(COALESCE(p.nickname, p.first_name) || ' ' || p.last_name) person, MAX(g.name) name, lower(g.email) email,
        SUM(g.amount_cents) total, COUNT(*) gifts, MAX(g.given_on) last_gift
      FROM gifts g LEFT JOIN people p ON p.id = g.person_id WHERE g.status = 'succeeded' AND g.given_on BETWEEN ? AND ?
      GROUP BY COALESCE(CAST(g.person_id AS TEXT), lower(g.email)) ORDER BY total DESC`).all(from, to)
      .map((d) => ({ ...d, giver: d.person || d.name || d.email || 'Anonymous' })));
  });

  r.get('/finance/recurring', requireFinance, (req, res) => {
    res.json(db.prepare(`SELECT rg.*, f.name fund, p.first_name, p.last_name, p.nickname FROM recurring_gifts rg LEFT JOIN funds f ON f.id = rg.fund_id
      LEFT JOIN people p ON p.id = rg.person_id ORDER BY rg.status = 'canceled', rg.created_at DESC`).all()
      .map((g) => ({ ...g, giver: name(g) || g.name || g.email, every_label: EVERY[g.every]?.label || g.every })));
  });

  // Link a gift (from a guest) to someone in People, and their other gifts from that email too.
  r.patch('/finance/gifts/:id', requireFinance, (req, res) => {
    const g = db.prepare('SELECT * FROM gifts WHERE id = ?').get(int(req.params.id));
    if (!g) throw notFound('Gift');
    const p = person(int(req.body?.person_id));
    if (!p) throw bad('Pick a person.');
    tx(db, () => {
      db.prepare('UPDATE gifts SET person_id = ?, campus_id = COALESCE(campus_id, ?) WHERE id = ?').run(p.id, p.campus_id, g.id);
      if (g.email) db.prepare('UPDATE gifts SET person_id = ?, campus_id = COALESCE(campus_id, ?) WHERE person_id IS NULL AND lower(email) = lower(?)').run(p.id, p.campus_id, g.email);
      if (g.email) db.prepare('UPDATE recurring_gifts SET person_id = ? WHERE person_id IS NULL AND lower(email) = lower(?)').run(p.id, g.email);
    });
    audit(db, req, 'finance.gift.link', { gift: g.id, person: p.id });
    res.json({ ok: true });
  });

  r.get('/finance/funds', requireFinance, (req, res) => res.json({ funds: funds(true), fee: fees() }));
  r.post('/finance/funds', requireFinance, (req, res) => {
    const b = req.body || {};
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 n FROM funds WHERE section = ?').get(str(b.section, 60)).n;
    const id = db.prepare('INSERT INTO funds (name, section, sort) VALUES (?, ?, ?)').run(required(b.name, 'Fund name').slice(0, 80), str(b.section, 60), sort).lastInsertRowid;
    audit(db, req, 'finance.fund.create', b.name);
    res.status(201).json(fund(id));
  });
  r.patch('/finance/funds/:id', requireFinance, (req, res) => {
    const f = fund(int(req.params.id));
    if (!f) throw notFound('Fund');
    const b = req.body || {};
    tx(db, () => {
      if (b.name !== undefined) db.prepare('UPDATE funds SET name = ? WHERE id = ?').run(required(b.name, 'Fund name').slice(0, 80), f.id);
      if (b.section !== undefined) db.prepare('UPDATE funds SET section = ? WHERE id = ?').run(str(b.section, 60), f.id);
      if (b.sort !== undefined) db.prepare('UPDATE funds SET sort = ? WHERE id = ?').run(int(b.sort), f.id);
      if (b.active !== undefined) {
        if (!b.active && f.is_default) throw bad('Pick another default fund before hiding this one.');
        db.prepare('UPDATE funds SET active = ? WHERE id = ?').run(b.active ? 1 : 0, f.id);
      }
      if (b.is_default) {
        if (!f.active && b.active !== true) throw bad('Show this fund before making it the default.');
        db.prepare('UPDATE funds SET is_default = (id = ?)').run(f.id);
      }
    });
    audit(db, req, 'finance.fund.update', { id: f.id, ...b });
    res.json(fund(f.id));
  });
  r.patch('/finance/settings', requireFinance, (req, res) => {
    const b = req.body || {};
    if (b.fee_percent !== undefined) {
      if (!(typeof b.fee_percent === 'number' && b.fee_percent >= 0 && b.fee_percent < 10)) throw bad('The fee percent is a number like 2.2.');
      setSetting(db, 'giving_fee_percent', b.fee_percent);
    }
    if (b.fee_fixed_cents !== undefined) {
      if (!(Number.isInteger(b.fee_fixed_cents) && b.fee_fixed_cents >= 0 && b.fee_fixed_cents <= 100)) throw bad('The fixed fee is in cents, like 30.');
      setSetting(db, 'giving_fee_fixed', b.fee_fixed_cents);
    }
    res.json(fees());
  });

  return r;
}

// ---------------------------------------------------------------- Stripe webhook
// Stripe tells us when gifts succeed, fail (bank payments can take a few days), repeat or are
// refunded. Every event is checked against STRIPE_WEBHOOK_SECRET, and repeats are harmless.
export function stripeWebhook(db) {
  const tz = () => db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';
  const dateOf = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('en-CA', { timeZone: tz() }) : localNow(tz()).date);
  const methodOf = (type) => (type === 'us_bank_account' ? 'bank' : 'card');

  function giver(meta, email, nameGiven) {
    const p = (meta?.person_id && db.prepare('SELECT id, email, campus_id FROM people WHERE id = ?').get(Number(meta.person_id)))
      || (email && db.prepare('SELECT id, email, campus_id FROM people WHERE lower(email) = lower(?) AND archived = 0 ORDER BY id LIMIT 1').get(email));
    return { person_id: p?.id ?? null, campus_id: p?.campus_id ?? null, email: email || p?.email || '', name: nameGiven || meta?.name || '' };
  }

  async function paymentMethodType(pi) {
    if (!pi) return 'card';
    try {
      const x = await stripe('GET', `/payment_intents/${pi}`, { 'expand[]': 'payment_method' });
      return methodOf(x.payment_method?.type || x.payment_method_types?.[0]);
    } catch { return 'card'; }
  }

  // Stripe moved some invoice fields in newer API versions; read either shape.
  const invSub = (inv) => inv.subscription?.id || inv.subscription || inv.parent?.subscription_details?.subscription
    || inv.lines?.data?.[0]?.subscription || inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription || null;
  const invPi = (inv) => inv.payment_intent?.id || inv.payment_intent || inv.payments?.data?.[0]?.payment?.payment_intent || null;

  function saveGift(g) {
    const existing = db.prepare('SELECT * FROM gifts WHERE stripe_ref = ?').get(g.stripe_ref);
    if (existing) {
      db.prepare('UPDATE gifts SET status = ? WHERE id = ?').run(g.status === 'pending' && existing.status !== 'pending' ? existing.status : g.status, existing.id);
      return { ...existing, status: g.status, isNew: false };
    }
    const id = db.prepare(`INSERT INTO gifts (person_id, name, email, fund_id, amount_cents, fee_cents, method, source, status, given_on, campus_id, recurring_id, stripe_ref, stripe_pi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(g.person_id, g.name, g.email, g.fund_id, g.amount_cents, g.fee_cents, g.method, g.source, g.status, g.given_on, g.campus_id, g.recurring_id ?? null, g.stripe_ref, g.stripe_pi ?? null).lastInsertRowid;
    return { ...g, id: Number(id), isNew: true };
  }

  // A thank-you that doubles as the receipt (Stripe can also send its own).
  async function receipt(g) {
    if (!g.email || !canSendMail()) return;
    const church = getSetting(db, 'church_name', 'Church');
    const f = db.prepare('SELECT name FROM funds WHERE id = ?').get(g.fund_id)?.name || 'General';
    const text = `Thank you for your gift to ${church}.\n\n${money(g.amount_cents)} to ${f} on ${g.given_on}${g.fee_cents ? ` (plus ${money(g.fee_cents)} you added to cover fees)` : ''}.\n\nNo goods or services were provided in exchange for this gift. Keep this email for your records; a year-end statement will follow.`;
    await sendMail({ to: g.email, subject: `Thank you for your gift to ${church}`, text, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n\n/g, '</p><p>')}</p>` }).catch((e) => console.error('Gift receipt failed:', e.message));
  }

  async function recurringFor(subId) {
    let rg = db.prepare('SELECT * FROM recurring_gifts WHERE subscription_id = ?').get(subId);
    if (rg) return rg;
    // The first invoice can arrive before the checkout event: read it from Stripe.
    const sub = await stripe('GET', `/subscriptions/${subId}`, { 'expand[]': 'customer' });
    const m = sub.metadata || {};
    const who = giver(m, sub.customer?.email, sub.customer?.name);
    db.prepare(`INSERT OR IGNORE INTO recurring_gifts (person_id, name, email, fund_id, amount_cents, fee_cents, every, subscription_id, customer_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(who.person_id, who.name, who.email, Number(m.fund_id) || null, Number(m.amount_cents) || 0, Number(m.fee_cents) || 0, m.every || 'month', subId, sub.customer?.id || null);
    return db.prepare('SELECT * FROM recurring_gifts WHERE subscription_id = ?').get(subId);
  }

  const handlers = {
    async 'checkout.session.completed'(s) {
      const m = s.metadata || {};
      if (s.mode === 'subscription' && s.subscription) {
        const who = giver(m, s.customer_details?.email, s.customer_details?.name);
        db.prepare(`INSERT INTO recurring_gifts (person_id, name, email, fund_id, amount_cents, fee_cents, every, subscription_id, customer_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active') ON CONFLICT (subscription_id) DO UPDATE SET person_id = COALESCE(excluded.person_id, person_id), email = excluded.email, name = excluded.name`)
          .run(who.person_id, who.name, who.email, Number(m.fund_id) || null, Number(m.amount_cents) || 0, Number(m.fee_cents) || 0, m.every || 'month', s.subscription, s.customer || null);
        return;
      }
      if (s.mode !== 'payment' || !s.payment_intent) return;
      const who = giver(m, s.customer_details?.email, s.customer_details?.name);
      const g = saveGift({
        ...who, fund_id: Number(m.fund_id) || null, amount_cents: Number(m.amount_cents) || s.amount_total, fee_cents: Number(m.fee_cents) || 0,
        method: await paymentMethodType(s.payment_intent), source: 'online', status: s.payment_status === 'paid' ? 'succeeded' : 'pending',
        given_on: dateOf(s.created), stripe_ref: s.payment_intent, stripe_pi: s.payment_intent,
      });
      if (g.isNew && g.status === 'succeeded') await receipt(g);
    },
    async 'checkout.session.async_payment_succeeded'(s) { await settle(s.payment_intent, 'succeeded'); },
    async 'checkout.session.async_payment_failed'(s) { await settle(s.payment_intent, 'failed'); },
    async 'payment_intent.succeeded'(pi) { await settle(pi.id, 'succeeded'); },
    async 'payment_intent.payment_failed'(pi) { await settle(pi.id, 'failed'); },
    async 'invoice.paid'(inv) {
      const sub = invSub(inv);
      if (!sub || !inv.amount_paid) return;
      const rg = await recurringFor(sub);
      const pi = invPi(inv);
      const fee = Math.min(rg.fee_cents, inv.amount_paid);
      const g = saveGift({
        person_id: rg.person_id, name: rg.name, email: rg.email || inv.customer_email || '', campus_id: rg.person_id ? db.prepare('SELECT campus_id FROM people WHERE id = ?').get(rg.person_id)?.campus_id ?? null : null,
        fund_id: rg.fund_id, amount_cents: inv.amount_paid - fee, fee_cents: fee, method: await paymentMethodType(pi), source: 'recurring',
        status: 'succeeded', given_on: dateOf(inv.status_transitions?.paid_at || inv.created), recurring_id: rg.id, stripe_ref: inv.id, stripe_pi: pi,
      });
      if (rg.status !== 'active') db.prepare("UPDATE recurring_gifts SET status = 'active' WHERE id = ?").run(rg.id);
      if (g.isNew) await receipt(g);
    },
    async 'invoice.payment_failed'(inv) {
      const sub = invSub(inv);
      if (sub) db.prepare("UPDATE recurring_gifts SET status = 'past_due' WHERE subscription_id = ? AND status != 'canceled'").run(sub);
    },
    async 'customer.subscription.updated'(sub) {
      const status = sub.status === 'active' ? 'active' : ['canceled', 'incomplete_expired', 'unpaid'].includes(sub.status) ? 'canceled' : 'past_due';
      db.prepare('UPDATE recurring_gifts SET status = ? WHERE subscription_id = ?').run(status, sub.id);
    },
    async 'customer.subscription.deleted'(sub) {
      db.prepare("UPDATE recurring_gifts SET status = 'canceled', canceled_at = COALESCE(canceled_at, datetime('now')) WHERE subscription_id = ?").run(sub.id);
    },
    async 'charge.refunded'(ch) {
      if (!ch.refunded) return; // partly refunded: leave it for finance to adjust
      db.prepare("UPDATE gifts SET status = 'refunded' WHERE stripe_ref IN (?, ?) OR stripe_pi = ?").run(ch.payment_intent || '-', ch.invoice || '-', ch.payment_intent || '-');
    },
  };
  async function settle(pi, status) {
    if (!pi) return;
    const g = db.prepare('SELECT * FROM gifts WHERE stripe_ref = ?').get(pi);
    if (!g || g.status === status) return;
    db.prepare('UPDATE gifts SET status = ? WHERE id = ?').run(status, g.id);
    if (status === 'succeeded') await receipt({ ...g, status });
  }

  return async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const event = verifyWebhook(raw, req.get('stripe-signature'));
    if (!event) return res.status(400).json({ error: 'Bad signature.' });
    try {
      await handlers[event.type]?.(event.data.object);
      res.json({ received: true });
    } catch (e) {
      console.error(`Stripe ${event.type} failed:`, e.message);
      res.status(500).json({ error: 'Will retry.' });
    }
  };
}
