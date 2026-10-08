// Events: what's coming up (revivals, youth nights, potlucks…) on the app's calendar, made in the
// hub. An event can take sign-ups: how many are coming, a few questions, an optional cap, and a
// price per person paid by card through Stripe. Guests can sign up without an account; a private
// key on each sign-up lets them see (and, for free events, cancel) their own.
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireRole, canCampus, campusFilter, siteOrigin, rank } from '../auth.js';
import { getSetting, tx } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str, required, oneOf, isDateTime, audit, localNow } from '../http.js';
import { stripe, stripeConfigured, publishableKey } from '../stripe.js';
import { sendMail, canSendMail } from '../mail.js';
import { notify } from '../notify.js';
import { isAppImage } from '../../public/js/app-widgets.js';

const money = (c) => `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const HOLD_MIN = 35; // a spot is held this long while someone pays (Stripe's checkout lasts 30)
const QTYPES = ['text', 'choice', 'yesno'];
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

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

// "Saturday, October 19 · 6:00 PM", for emails.
function when(e) {
  const d = new Date(`${e.starts_at}:00`);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return e.all_day ? day : `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default function eventRoutes(db) {
  const r = Router();
  const tz = () => db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';
  const nowLocal = () => { const n = localNow(tz()); return `${n.date}T${n.time}`; };

  const parse = (e) => ({ ...e, all_day: Boolean(e.all_day), published: Boolean(e.published), signup: Boolean(e.signup), questions: JSON.parse(e.questions || '[]') });
  const EVENT = `SELECT e.*, c.name campus_name, c.short_name campus_short FROM events e LEFT JOIN campuses c ON c.id = e.campus_id`;

  // People counted against the cap: confirmed, plus anyone still paying.
  const taken = (eventId) => db.prepare(`SELECT COALESCE(SUM(count), 0) n FROM event_signups WHERE event_id = ?
    AND (status = 'confirmed' OR (status = 'pending' AND created_at > datetime('now', '-${HOLD_MIN} minutes')))`).get(eventId).n;

  // What a visitor may know about sign-ups right now.
  function signupState(e) {
    if (!e.signup) return { open: false };
    const used = taken(e.id);
    const left = e.capacity ? Math.max(0, e.capacity - used) : null;
    const closes = e.signup_closes || e.starts_at;
    const closed = closes <= nowLocal() ? 'Sign-ups have closed.' : left === 0 ? 'This event is full.' : '';
    return { open: !closed, closed, spots_left: left, taken: used, closes };
  }

  const visible = (req, e) => e && !e.archived && e.published && (e.visibility === 'public' || req.user);
  const forPublic = (req, e) => {
    const { created_by: _c, archived: _a, ...rest } = parse(e);
    const mine = req.user ? db.prepare("SELECT id, key, count, status, amount_cents FROM event_signups WHERE event_id = ? AND user_id = ? AND status IN ('confirmed', 'pending') ORDER BY id DESC LIMIT 1").get(e.id, req.user.id) : null;
    return { ...rest, sign_ups: signupState(e), mine: mine || null };
  };

  // ---------------------------------------------------------------- the app's calendar
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD, or upcoming (from today). ?limit for the home screen.
  r.get('/events', (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : localNow(tz()).date;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : '9999-12-31';
    const limit = Math.min(int(req.query.limit) || 200, 200);
    const rows = db.prepare(`${EVENT} WHERE e.archived = 0 AND e.published = 1 ${req.user ? '' : "AND e.visibility = 'public'"}
      AND substr(COALESCE(e.ends_at, e.starts_at), 1, 10) >= ? AND substr(e.starts_at, 1, 10) <= ? ORDER BY e.starts_at LIMIT ?`).all(from, to, limit);
    res.json(rows.map((e) => forPublic(req, e)));
  });

  r.get('/events/:id', (req, res) => {
    const e = db.prepare(`${EVENT} WHERE e.id = ?`).get(int(req.params.id));
    if (!visible(req, e)) throw notFound('Event');
    res.json({ ...forPublic(req, e), publishable_key: stripeConfigured() ? publishableKey() : '' });
  });

  // Body: { name, email, phone, count, answers: { [question id]: value } }
  r.post('/events/:id/signups', async (req, res) => {
    if (!rateLimit(req.ip)) throw new HttpError(429, 'Too many tries. Please wait a few minutes.');
    const e = db.prepare(`${EVENT} WHERE e.id = ?`).get(int(req.params.id));
    if (!visible(req, e)) throw notFound('Event');
    const ev = parse(e);
    const b = req.body || {};
    const p = req.user?.personId ? db.prepare('SELECT id, first_name, last_name, nickname, email, phone FROM people WHERE id = ?').get(req.user.personId) : null;
    const who = {
      name: str(b.name, 120) || (p ? `${p.nickname || p.first_name} ${p.last_name}`.trim() : req.user?.name || ''),
      email: (str(b.email, 200) || p?.email || req.user?.email || '').toLowerCase(),
      phone: str(b.phone, 40) || p?.phone || '',
    };
    if (!who.name) throw bad('Please enter your name.');
    if (!emailOk(who.email)) throw bad('Please enter your email, so we can confirm your spot.');
    const count = int(b.count, 'How many') ?? 1;
    if (count < 1 || count > ev.max_per) throw bad(`Sign up between 1 and ${ev.max_per} people at a time.`);
    const answers = cleanAnswers(ev.questions, b.answers || {});
    const amount = ev.price_cents * count;
    if (amount && !stripeConfigured()) throw new HttpError(503, 'Online payments aren’t set up yet. Please contact the church office.');

    // Check the cap and save in one go, so two people can't take the last spot.
    const signup = tx(db, () => {
      const st = signupState(e);
      if (!st.open) throw bad(st.closed || 'Sign-ups aren’t open for this event.');
      if (st.spots_left !== null && count > st.spots_left) throw bad(`Only ${st.spots_left} spot${st.spots_left === 1 ? '' : 's'} left.`);
      const key = crypto.randomBytes(12).toString('hex');
      const id = db.prepare(`INSERT INTO event_signups (event_id, key, person_id, user_id, name, email, phone, count, answers, status, amount_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, key, p?.id ?? null, req.user?.id ?? null, who.name, who.email, who.phone, count,
        JSON.stringify(answers), amount ? 'pending' : 'confirmed', amount).lastInsertRowid;
      return db.prepare('SELECT * FROM event_signups WHERE id = ?').get(id);
    });

    if (!amount) {
      await confirmed(signup);
      return res.status(201).json({ id: signup.id, key: signup.key, status: 'confirmed' });
    }
    const origin = siteOrigin(req);
    try {
      const session = await stripe('POST', '/checkout/sessions', {
        ui_mode: 'embedded',
        mode: 'payment',
        return_url: `${origin}/app/event-done?event=${e.id}&signup=${signup.id}&key=${signup.key}`,
        redirect_on_completion: 'if_required',
        payment_method_types: ['card'],
        customer_email: who.email,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        line_items: [{ quantity: count, price_data: { currency: 'usd', unit_amount: ev.price_cents, product_data: { name: ev.title, description: when(ev) } } }],
        metadata: { kind: 'event', event_id: e.id, signup_id: signup.id },
        payment_intent_data: { metadata: { kind: 'event', event_id: e.id, signup_id: signup.id }, description: `${ev.title} (${count} × ${money(ev.price_cents)})` },
      });
      db.prepare('UPDATE event_signups SET stripe_session = ? WHERE id = ?').run(session.id, signup.id);
      res.status(201).json({ id: signup.id, key: signup.key, status: 'pending', client_secret: session.client_secret });
    } catch (err) {
      db.prepare("UPDATE event_signups SET status = 'canceled', canceled_at = datetime('now') WHERE id = ?").run(signup.id);
      throw new HttpError(502, err.message);
    }
  });

  function cleanAnswers(questions, given) {
    const out = {};
    for (const q of questions) {
      let v = given[q.id];
      if (q.type === 'yesno') v = v === true || v === 'yes' ? 'Yes' : v === false || v === 'no' ? 'No' : '';
      else v = str(v, 1000);
      if (q.type === 'choice' && v && !q.options.includes(v)) throw bad(`Pick one of the choices for “${q.label}”.`);
      if (q.required && !v) throw bad(`Please answer “${q.label}”.`);
      if (v) out[q.id] = v;
    }
    return out;
  }

  // A sign-up's own page (the key comes back from signing up, and in the confirmation email).
  const own = (req) => {
    const s = db.prepare('SELECT * FROM event_signups WHERE id = ?').get(int(req.params.id));
    const ok = s && ((req.user && s.user_id === req.user.id) || (typeof req.query.key === 'string' && req.query.key.length === s.key.length && crypto.timingSafeEqual(Buffer.from(req.query.key), Buffer.from(s.key))));
    if (!ok) throw notFound('Sign-up');
    return s;
  };
  r.get('/event-signups/:id', async (req, res) => {
    let s = own(req);
    // Paid, but the webhook hasn't arrived yet: ask Stripe directly.
    if (s.status === 'pending' && s.stripe_session && stripeConfigured()) {
      const session = await stripe('GET', `/checkout/sessions/${s.stripe_session}`).catch(() => null);
      if (session?.payment_status === 'paid') s = await paid(s.id, session.payment_intent) || s;
    }
    const e = parse(db.prepare(`${EVENT} WHERE e.id = ?`).get(s.event_id));
    res.json({ id: s.id, status: s.status, count: s.count, amount_cents: s.amount_cents, name: s.name, email: s.email, event: { id: e.id, title: e.title, starts_at: e.starts_at, all_day: e.all_day, location: e.location, price_cents: e.price_cents } });
  });
  // Free sign-ups can be canceled by the person; paid ones go through the church (for a refund).
  r.post('/event-signups/:id/cancel', (req, res) => {
    const s = own(req);
    if (s.amount_cents && s.status === 'confirmed') throw bad('For a refund, please contact the church office.');
    db.prepare("UPDATE event_signups SET status = 'canceled', canceled_at = datetime('now') WHERE id = ? AND status IN ('confirmed', 'pending')").run(s.id);
    res.json({ ok: true });
  });

  async function confirmed(s) {
    const e = parse(db.prepare(`${EVENT} WHERE e.id = ?`).get(s.event_id));
    const church = getSetting(db, 'church_name', 'Church');
    if (e.created_by) {
      notify(db, [e.created_by], { kind: 'event', title: `${s.name} signed up for ${e.title}`, body: `${s.count} ${s.count === 1 ? 'person' : 'people'}${s.amount_cents ? ` · paid ${money(s.amount_cents)}` : ''}`, url: `/#/events/${e.id}/signups` });
    }
    if (!s.email || !canSendMail()) return;
    const hub = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
    const link = hub ? `${hub}/app/#/events/${e.id}?signup=${s.id}&key=${s.key}` : '';
    const text = [`You're signed up for ${e.title}!`, `${when(e)}${e.location ? `\n${e.location}` : ''}${e.address ? `\n${e.address}` : ''}`,
      `${s.count} ${s.count === 1 ? 'person' : 'people'}${s.amount_cents ? ` · ${money(s.amount_cents)} paid` : ''}`,
      link ? `See or change your sign-up: ${link}` : '', `See you there,\n${church}`].filter(Boolean).join('\n\n');
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    await sendMail({ to: s.email, subject: `You're signed up: ${e.title}`, text, html: text.split('\n\n').map((pp) => `<p>${esc(pp).replace(/\n/g, '<br>')}</p>`).join('') })
      .catch((err) => console.error('Event confirmation failed:', err.message));
  }

  // Payment went through (from the webhook, or checked when the person comes back).
  async function paid(signupId, pi) {
    const s = db.prepare('SELECT * FROM event_signups WHERE id = ?').get(signupId);
    if (!s || s.status === 'confirmed' || s.status === 'refunded') return s;
    db.prepare("UPDATE event_signups SET status = 'confirmed', stripe_pi = COALESCE(?, stripe_pi), canceled_at = NULL WHERE id = ?").run(pi || null, s.id);
    const now = db.prepare('SELECT * FROM event_signups WHERE id = ?').get(s.id);
    await confirmed(now);
    return now;
  }
  hooks.paid = paid;
  hooks.refunded = (pi) => db.prepare("UPDATE event_signups SET status = 'refunded', canceled_at = COALESCE(canceled_at, datetime('now')) WHERE stripe_pi = ?").run(pi);

  // ---------------------------------------------------------------- the hub
  const getEvent = (req, id) => {
    const e = db.prepare(`${EVENT} WHERE e.id = ?`).get(int(id));
    if (!e || e.archived) throw notFound('Event');
    if (!canCampus(req.user, e.campus_id)) throw forbidden();
    return e;
  };

  r.get('/admin/events', requireRole('staff'), (req, res) => {
    const past = req.query.scope === 'past';
    const cf = campusFilter(req.user, 'e.campus_id');
    const today = localNow(tz()).date;
    const rows = db.prepare(`${EVENT} WHERE e.archived = 0 AND (${cf.sql} OR e.campus_id IS NULL)
      AND substr(COALESCE(e.ends_at, e.starts_at), 1, 10) ${past ? '<' : '>='} ? ORDER BY e.starts_at ${past ? 'DESC' : 'ASC'} LIMIT 300`).all(...cf.args, today);
    const counts = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN count END), 0) people, COUNT(CASE WHEN status = 'confirmed' THEN 1 END) signups,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_cents END), 0) paid FROM event_signups WHERE event_id = ?`);
    res.json(rows.map((e) => ({ ...parse(e), ...counts.get(e.id) })));
  });

  r.get('/admin/events/:id', requireRole('staff'), (req, res) => res.json({ ...parse(getEvent(req, req.params.id)), sign_ups: signupState(getEvent(req, req.params.id)) }));

  function clean(b, old = {}) {
    const e = {};
    e.title = required(b.title ?? old.title, 'Title').slice(0, 140);
    e.description = str(b.description ?? old.description, 8000);
    const image = b.image ?? old.image ?? '';
    if (image && !isAppImage(image)) throw bad('Pictures are uploaded here in the hub.');
    e.image = image;
    e.location = str(b.location ?? old.location, 140);
    e.address = str(b.address ?? old.address, 240);
    e.campus_id = b.campus_id !== undefined ? int(b.campus_id) : old.campus_id ?? null;
    if (e.campus_id && !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(e.campus_id)) throw bad('Unknown campus.');
    e.all_day = (b.all_day ?? old.all_day) ? 1 : 0;
    e.starts_at = b.starts_at ?? old.starts_at;
    if (!isDateTime(e.starts_at)) throw bad('Pick when the event starts.');
    e.ends_at = (b.ends_at !== undefined ? b.ends_at : old.ends_at) || null;
    if (e.ends_at && (!isDateTime(e.ends_at) || e.ends_at < e.starts_at)) throw bad('The end has to be after the start.');
    e.visibility = oneOf(b.visibility ?? old.visibility, ['public', 'members'], 'public');
    e.published = (b.published ?? old.published) ? 1 : 0;
    e.signup = (b.signup ?? old.signup) ? 1 : 0;
    const cap = b.capacity !== undefined ? int(b.capacity, 'Spots') : old.capacity ?? null;
    if (cap !== null && cap < 1) throw bad('Spots must be at least 1, or blank for no limit.');
    e.capacity = cap;
    e.max_per = Math.min(50, Math.max(1, int(b.max_per ?? old.max_per ?? 10, 'People per sign-up') || 1));
    e.signup_closes = (b.signup_closes !== undefined ? b.signup_closes : old.signup_closes) || null;
    if (e.signup_closes && !isDateTime(e.signup_closes)) throw bad('Pick when sign-ups close.');
    const price = b.price !== undefined ? Math.round(Number(String(b.price || 0).replace(/[$,\s]/g, '')) * 100) : old.price_cents ?? 0;
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw bad('Check the price.');
    if (price && price < 100) throw bad('Paid events cost at least $1.');
    e.price_cents = price;
    const qs = b.questions ?? (old.questions ? JSON.parse(old.questions) : []);
    if (!Array.isArray(qs)) throw bad('Questions must be a list.');
    e.questions = JSON.stringify(qs.slice(0, 12).map((q, i) => {
      const type = oneOf(q.type, QTYPES, 'text');
      const out = { id: str(q.id, 20).replace(/[^\w-]/g, '') || `q${i + 1}`, label: required(q.label, 'Question').slice(0, 200), type, required: Boolean(q.required) };
      if (type === 'choice') {
        out.options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => str(o, 80)).filter(Boolean))].slice(0, 20);
        if (!out.options.length) throw bad(`Add choices for “${out.label}”.`);
      }
      return out;
    }));
    if (new Set(JSON.parse(e.questions).map((q) => q.id)).size !== JSON.parse(e.questions).length) throw bad('Two questions have the same id.');
    return e;
  }

  r.post('/admin/events', requireRole('staff'), (req, res) => {
    const e = clean(req.body || {});
    if (!canCampus(req.user, e.campus_id) || (e.campus_id === null && req.user.campusIds)) throw forbidden();
    const keys = Object.keys(e);
    const id = db.prepare(`INSERT INTO events (${keys.join(', ')}, created_by) VALUES (${keys.map(() => '?').join(', ')}, ?)`).run(...Object.values(e), req.user.id).lastInsertRowid;
    audit(db, req, 'event.create', e.title);
    res.status(201).json(parse(db.prepare(`${EVENT} WHERE e.id = ?`).get(id)));
  });

  r.patch('/admin/events/:id', requireRole('staff'), (req, res) => {
    const old = getEvent(req, req.params.id);
    const e = clean(req.body || {}, old);
    if (!canCampus(req.user, e.campus_id) || (e.campus_id === null && req.user.campusIds && old.campus_id !== null)) throw forbidden();
    if (e.price_cents !== old.price_cents && db.prepare("SELECT 1 FROM event_signups WHERE event_id = ? AND amount_cents > 0 AND status IN ('confirmed', 'pending')").get(old.id)) {
      throw bad('People have already paid for this event, so its price can’t change.');
    }
    db.prepare(`UPDATE events SET ${Object.keys(e).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(e), old.id);
    res.json(parse(db.prepare(`${EVENT} WHERE e.id = ?`).get(old.id)));
  });

  // Events with paid sign-ups are hidden instead of deleted, so the payments stay on record.
  r.delete('/admin/events/:id', requireRole('staff'), (req, res) => {
    const e = getEvent(req, req.params.id);
    if (db.prepare('SELECT 1 FROM event_signups WHERE event_id = ? AND amount_cents > 0 LIMIT 1').get(e.id)) db.prepare('UPDATE events SET archived = 1 WHERE id = ?').run(e.id);
    else db.prepare('DELETE FROM events WHERE id = ?').run(e.id);
    audit(db, req, 'event.delete', e.title);
    res.json({ ok: true });
  });

  const signupRows = (eventId) => db.prepare(`SELECT s.*, p.first_name, p.last_name FROM event_signups s LEFT JOIN people p ON p.id = s.person_id
    WHERE s.event_id = ? AND NOT (s.status = 'pending' AND s.created_at <= datetime('now', '-${HOLD_MIN} minutes')) AND NOT (s.status = 'canceled' AND s.amount_cents > 0 AND s.stripe_pi IS NULL)
    ORDER BY s.status != 'confirmed', s.created_at`).all(eventId).map(({ key: _k, ...s }) => ({ ...s, answers: JSON.parse(s.answers || '{}') }));

  r.get('/admin/events/:id/signups', requireRole('staff'), (req, res) => {
    const e = getEvent(req, req.params.id);
    res.json({ event: parse(e), sign_ups: signupState(e), rows: signupRows(e.id) });
  });

  r.get('/admin/events/:id/signups.csv', requireRole('staff'), (req, res) => {
    const e = parse(getEvent(req, req.params.id));
    const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    const rows = signupRows(e.id).filter((s) => s.status === 'confirmed').map((s) => [s.name, s.email, s.phone, s.count, ...e.questions.map((q) => s.answers[q.id] || ''), (s.amount_cents / 100).toFixed(2), s.created_at].map(cell).join(','));
    res.setHeader('Content-Disposition', `attachment; filename="${e.title.replace(/[^\w -]/g, '').slice(0, 60) || 'event'} sign-ups.csv"`);
    res.type('text/csv').send([['Name', 'Email', 'Phone', 'People', ...e.questions.map((q) => q.label), 'Paid', 'Signed up'].map(cell).join(','), ...rows].join('\n'));
  });

  // Staff add someone who signed up in person or by phone (paid at the door, or free).
  r.post('/admin/events/:id/signups', requireRole('staff'), (req, res) => {
    const e = parse(getEvent(req, req.params.id));
    const b = req.body || {};
    const p = b.person_id ? db.prepare('SELECT id, first_name, last_name, nickname, email, phone FROM people WHERE id = ?').get(int(b.person_id)) : null;
    const nm = str(b.name, 120) || (p ? `${p.nickname || p.first_name} ${p.last_name}`.trim() : '');
    if (!nm) throw bad('Enter a name or pick someone.');
    const count = Math.max(1, int(b.count, 'People') ?? 1);
    const answers = {};
    for (const q of e.questions) if (b.answers?.[q.id]) answers[q.id] = str(b.answers[q.id], 1000);
    const id = db.prepare(`INSERT INTO event_signups (event_id, key, person_id, name, email, phone, count, answers, status, amount_cents, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 0, ?)`).run(e.id, crypto.randomBytes(12).toString('hex'), p?.id ?? null, nm,
      (str(b.email, 200) || p?.email || '').toLowerCase(), str(b.phone, 40) || p?.phone || '', count, JSON.stringify(answers), req.user.id).lastInsertRowid;
    res.status(201).json({ id: Number(id) });
  });

  // Cancel a sign-up; a paid one can be refunded through Stripe at the same time.
  r.post('/admin/event-signups/:id/cancel', requireRole('staff'), async (req, res) => {
    const s = db.prepare('SELECT * FROM event_signups WHERE id = ?').get(int(req.params.id));
    if (!s) throw notFound('Sign-up');
    getEvent(req, s.event_id);
    if (req.body?.refund && s.stripe_pi && s.status === 'confirmed') {
      if (rank(req.user.role) < rank('staff')) throw forbidden();
      await stripe('POST', '/refunds', { payment_intent: s.stripe_pi, metadata: { kind: 'event', signup_id: s.id } }).catch((e) => { throw new HttpError(502, e.message); });
      db.prepare("UPDATE event_signups SET status = 'refunded', canceled_at = datetime('now') WHERE id = ?").run(s.id);
      audit(db, req, 'event.refund', `${s.id} ${money(s.amount_cents)}`);
    } else {
      db.prepare("UPDATE event_signups SET status = 'canceled', canceled_at = datetime('now') WHERE id = ?").run(s.id);
    }
    res.json({ ok: true });
  });

  return r;
}

// The Stripe webhook (in giving.js) hands event payments here.
export const hooks = { paid: async () => null, refunded: () => {} };
