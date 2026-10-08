// Finance, part 2: cash and checks entered in batches (an offering count), and year-end giving
// statements (printable, emailed to every giver, and downloadable by givers themselves).
// Finance permission only, apart from a giver's own statement.
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { getSetting, setSetting, tx } from '../db.js';
import { bad, notFound, int, str, isDate, audit, localNow } from '../http.js';
import { requireFinance } from './giving.js';
import { sendMail, canSendMail } from '../mail.js';

const money = (c) => `$${((c || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const name = (p) => (p?.first_name ? `${p.nickname || p.first_name} ${p.last_name || ''}`.trim() : '');
const METHODS = ['cash', 'check', 'other'];
export const STATEMENT_DEFAULTS = { org: '', address: '', ein: '', signer: '', note: 'Thank you for your faithful generosity. No goods or services were provided in exchange for these contributions.' };

export default function financeRoutes(db) {
  const r = Router();
  const cents = (v) => Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100);
  const today = () => localNow(db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC').date;
  const info = () => ({ ...STATEMENT_DEFAULTS, org: getSetting(db, 'church_name', ''), ...getSetting(db, 'statement_info', {}) });

  // ---------------------------------------------------------------- cash & checks
  function cleanGifts(list) {
    if (!Array.isArray(list) || !list.length) throw bad('Add at least one gift.');
    return list.slice(0, 500).map((g, i) => {
      const amount = cents(g.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw bad(`Line ${i + 1}: enter an amount.`);
      const fund = db.prepare('SELECT id FROM funds WHERE id = ?').get(int(g.fund_id, 'fund'));
      if (!fund) throw bad(`Line ${i + 1}: pick a fund.`);
      const person = g.person_id ? db.prepare('SELECT id, first_name, last_name, nickname, email, campus_id FROM people WHERE id = ?').get(int(g.person_id)) : null;
      if (g.person_id && !person) throw bad(`Line ${i + 1}: that person wasn’t found.`);
      return {
        person, fund_id: fund.id, amount_cents: amount, method: METHODS.includes(g.method) ? g.method : 'cash',
        check_number: str(g.check_number, 30), name: person ? name(person) : str(g.name, 120), note: str(g.note, 300),
      };
    });
  }

  // A batch: the gifts counted together (e.g. Sunday 9am offering), all on one date.
  r.get('/finance/batches', requireFinance, (req, res) => {
    res.json(db.prepare(`SELECT b.*, c.short_name campus, COUNT(g.id) gifts, COALESCE(SUM(g.amount_cents), 0) total
      FROM gift_batches b LEFT JOIN gifts g ON g.batch_id = b.id LEFT JOIN campuses c ON c.id = b.campus_id
      GROUP BY b.id ORDER BY b.given_on DESC, b.id DESC LIMIT 200`).all());
  });
  r.get('/finance/batches/:id', requireFinance, (req, res) => {
    const b = db.prepare('SELECT * FROM gift_batches WHERE id = ?').get(int(req.params.id));
    if (!b) throw notFound('Batch');
    res.json({ ...b, gifts: db.prepare(`SELECT g.id, g.person_id, g.name, g.fund_id, g.amount_cents, g.method, g.check_number, g.note, p.first_name, p.last_name, p.nickname
      FROM gifts g LEFT JOIN people p ON p.id = g.person_id WHERE g.batch_id = ? ORDER BY g.id`).all(b.id) });
  });

  // Save a batch (new, or replacing an existing batch's gifts).
  function saveBatch(req, batchId = null) {
    const b = req.body || {};
    if (!isDate(b.given_on)) throw bad('Pick the date these were given.');
    const campusId = int(b.campus_id, 'campus');
    const gifts = cleanGifts(b.gifts);
    return tx(db, () => {
      let id = batchId;
      if (id) db.prepare('UPDATE gift_batches SET label = ?, given_on = ?, campus_id = ? WHERE id = ?').run(str(b.label, 120), b.given_on, campusId, id);
      else id = Number(db.prepare('INSERT INTO gift_batches (label, given_on, campus_id, created_by) VALUES (?, ?, ?, ?)').run(str(b.label, 120), b.given_on, campusId, req.user.id).lastInsertRowid);
      db.prepare('DELETE FROM gifts WHERE batch_id = ?').run(id);
      const ins = db.prepare(`INSERT INTO gifts (person_id, name, email, fund_id, amount_cents, method, source, status, given_on, campus_id, check_number, note, recorded_by, batch_id)
        VALUES (?, ?, ?, ?, ?, ?, 'manual', 'succeeded', ?, ?, ?, ?, ?, ?)`);
      for (const g of gifts) ins.run(g.person?.id ?? null, g.name, g.person?.email || '', g.fund_id, g.amount_cents, g.method, b.given_on, campusId ?? g.person?.campus_id ?? null, g.check_number, g.note, req.user.id, id);
      return id;
    });
  }
  r.post('/finance/batches', requireFinance, (req, res) => {
    const id = saveBatch(req);
    audit(db, req, 'finance.batch.create', { id, gifts: req.body.gifts.length });
    res.status(201).json({ id });
  });
  r.put('/finance/batches/:id', requireFinance, (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM gift_batches WHERE id = ?').get(id)) throw notFound('Batch');
    saveBatch(req, id);
    audit(db, req, 'finance.batch.update', { id });
    res.json({ id });
  });
  r.delete('/finance/batches/:id', requireFinance, (req, res) => {
    const id = int(req.params.id);
    db.prepare('DELETE FROM gift_batches WHERE id = ?').run(id);
    audit(db, req, 'finance.batch.delete', { id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- statements
  const donorKey = (personId, email) => (personId ? `p:${personId}` : `e:${String(email).toLowerCase()}`);
  // Everyone who gave in a year, with their total (gift + any fees they chose to cover).
  function donorsFor(year) {
    return db.prepare(`SELECT g.person_id, lower(MAX(COALESCE(NULLIF(p.email, ''), g.email))) email, MAX(p.first_name) first_name, MAX(p.last_name) last_name, MAX(p.nickname) nickname,
        MAX(g.name) given_name, SUM(g.amount_cents + g.fee_cents) total, COUNT(*) gifts
      FROM gifts g LEFT JOIN people p ON p.id = g.person_id
      WHERE g.status = 'succeeded' AND g.given_on LIKE ? AND (g.person_id IS NOT NULL OR g.email != '')
      GROUP BY COALESCE(CAST(g.person_id AS TEXT), lower(g.email)) ORDER BY MAX(p.last_name), MAX(g.name)`).all(`${year}%`)
      .map((d) => ({ key: donorKey(d.person_id, d.email), person_id: d.person_id, email: d.email || '', name: name(d) || d.given_name || d.email, total: d.total, gifts: d.gifts }));
  }
  function giftsFor(key, year) {
    const [kind, v] = [key.slice(0, 1), key.slice(2)];
    const where = kind === 'p' ? 'g.person_id = ?' : 'g.person_id IS NULL AND lower(g.email) = ?';
    return db.prepare(`SELECT g.given_on, g.amount_cents, g.fee_cents, g.method, g.check_number, f.name fund FROM gifts g LEFT JOIN funds f ON f.id = g.fund_id
      WHERE ${where} AND g.status = 'succeeded' AND g.given_on LIKE ? ORDER BY g.given_on, g.id`).all(kind === 'p' ? Number(v) : v, `${year}%`);
  }
  function donorInfo(key, year) {
    if (key.startsWith('p:')) {
      const p = db.prepare(`SELECT p.*, h.address street, h.city, h.state, h.zip FROM people p LEFT JOIN households h ON h.id = p.household_id WHERE p.id = ?`).get(Number(key.slice(2)));
      if (!p) return null;
      return { name: name(p), email: p.email, address: [p.street, `${[p.city, p.state].filter(Boolean).join(', ')} ${p.zip || ''}`.trim()].filter(Boolean).join(', ') };
    }
    const g = db.prepare('SELECT name, email FROM gifts WHERE person_id IS NULL AND lower(email) = ? AND given_on LIKE ? ORDER BY id LIMIT 1').get(key.slice(2), `${year}%`);
    return g ? { name: g.name || g.email, email: g.email, address: '' } : null;
  }

  // The statement itself: one HTML page, printable (Save as PDF) and the body of the email.
  function statement(key, year) {
    const d = donorInfo(key, year);
    if (!d) return null;
    const gifts = giftsFor(key, year);
    const i = info();
    const byFund = new Map();
    for (const g of gifts) byFund.set(g.fund || 'General', (byFund.get(g.fund || 'General') || 0) + g.amount_cents + g.fee_cents);
    const total = gifts.reduce((s, g) => s + g.amount_cents + g.fee_cents, 0);
    const how = { card: 'Card', bank: 'Bank', cash: 'Cash', check: 'Check', other: 'Other' };
    const body = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1d2433;max-width:680px;margin:0 auto;padding:24px;font-size:14px;line-height:1.45">
      <table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top"><div style="font-size:20px;font-weight:bold">${esc(i.org)}</div>
        <div style="white-space:pre-line;color:#555">${esc(i.address)}</div>${i.ein ? `<div style="color:#555">EIN ${esc(i.ein)}</div>` : ''}</td>
        <td style="text-align:right;vertical-align:top"><div style="font-size:18px;font-weight:bold">${esc(year)} Giving Statement</div><div style="color:#555">Issued ${esc(today())}</div></td></tr></table>
      <div style="margin:22px 0"><b>${esc(d.name)}</b>${d.address ? `<br><span style="color:#555">${esc(d.address)}</span>` : ''}</div>
      <p>Thank you for your gifts to ${esc(i.org)} in ${esc(year)}. Your total contributions were <b>${money(total)}</b>.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">${[...byFund].map(([f, c]) => `<tr><td style="padding:4px 0">${esc(f)}</td><td style="text-align:right">${money(c)}</td></tr>`).join('')}
        <tr><td style="padding:6px 0;border-top:2px solid #1d2433;font-weight:bold">Total</td><td style="text-align:right;border-top:2px solid #1d2433;font-weight:bold">${money(total)}</td></tr></table>
      <h3 style="font-size:15px;margin:22px 0 6px">Gifts</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:#555;text-align:left"><th style="padding:4px 0;border-bottom:1px solid #ccc">Date</th><th style="border-bottom:1px solid #ccc">Fund</th><th style="border-bottom:1px solid #ccc">How</th><th style="text-align:right;border-bottom:1px solid #ccc">Amount</th></tr>
        ${gifts.map((g) => `<tr><td style="padding:3px 0">${esc(g.given_on)}</td><td>${esc(g.fund || 'General')}</td><td>${esc(how[g.method] || g.method)}${g.check_number ? ` #${esc(g.check_number)}` : ''}</td><td style="text-align:right">${money(g.amount_cents + g.fee_cents)}</td></tr>`).join('')}</table>
      <p style="margin-top:22px;white-space:pre-line">${esc(i.note)}</p>
      ${i.signer ? `<p style="margin-top:18px">${esc(i.signer)}</p>` : ''}
      <p style="color:#777;font-size:12px;margin-top:18px">Amounts include any processing fees you chose to cover. Please keep this statement for your tax records.</p></div>`;
    return { donor: d, total, gifts, html: body };
  }
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
    <style>@media print { .noprint { display: none } body { margin: 0 } }</style></head><body style="margin:0;background:#fff">
    <div class="noprint" style="text-align:center;padding:12px;font-family:Arial"><button onclick="print()" style="font-size:15px;padding:8px 16px">Print or save as PDF</button></div>${body}</body></html>`;

  r.get('/finance/statements', requireFinance, (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(Number(today().slice(0, 4)) - 1);
    const sent = new Map(db.prepare('SELECT donor, sent_at FROM statement_sends WHERE year = ?').all(year).map((s) => [s.donor, s.sent_at]));
    res.json({ year, info: info(), mail: canSendMail(), donors: donorsFor(year).map((d) => ({ ...d, sent_at: sent.get(d.key) || null })) });
  });
  r.put('/finance/statement-info', requireFinance, (req, res) => {
    const b = req.body || {};
    setSetting(db, 'statement_info', { org: str(b.org, 120), address: str(b.address, 300), ein: str(b.ein, 20), signer: str(b.signer, 200), note: str(b.note, 1000) });
    res.json(info());
  });
  // One giver's statement, ready to print or save as PDF.
  r.get('/finance/statements/:key', requireFinance, (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(Number(today().slice(0, 4)) - 1);
    const s = statement(req.params.key, year);
    if (!s) throw notFound('Giver');
    res.type('html').send(page(`${year} Giving Statement · ${s.donor.name}`, s.html));
  });

  // Email statements: to everyone who gave that year (skipping those already sent, unless
  // `resend`), or just the givers listed in `keys`.
  r.post('/finance/statements/send', requireFinance, async (req, res) => {
    const b = req.body || {};
    const year = /^\d{4}$/.test(String(b.year || '')) ? String(b.year) : null;
    if (!year) throw bad('Pick a year.');
    if (!canSendMail()) throw bad('Email isn’t set up (see README → Email).');
    const done = new Set(db.prepare('SELECT donor FROM statement_sends WHERE year = ?').all(year).map((s) => s.donor));
    let list = donorsFor(year);
    if (Array.isArray(b.keys)) list = list.filter((d) => b.keys.includes(d.key));
    else if (!b.resend) list = list.filter((d) => !done.has(d.key));
    const i = info();
    const result = { sent: 0, no_email: 0, failed: 0 };
    for (const d of list) {
      const s = statement(d.key, year);
      if (!s?.donor.email) { result.no_email++; continue; }
      try {
        await sendMail({ to: s.donor.email, subject: `Your ${year} giving statement from ${i.org}`, text: `Your ${year} giving statement from ${i.org}: total ${money(s.total)}. Open this email in a browser or app that shows HTML to see each gift.`, html: s.html });
        db.prepare(`INSERT INTO statement_sends (year, donor, email, total_cents) VALUES (?, ?, ?, ?)
          ON CONFLICT (year, donor) DO UPDATE SET email = excluded.email, total_cents = excluded.total_cents, sent_at = datetime('now')`).run(year, d.key, s.donor.email, s.total);
        result.sent++;
      } catch (e) {
        console.error('Statement email failed:', e.message);
        result.failed++;
      }
    }
    audit(db, req, 'finance.statements.send', { year, ...result });
    res.json(result);
  });

  // A giver's own statement (from My giving).
  r.get('/giving/statement', requireRole('volunteer'), (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(Number(today().slice(0, 4)) - 1);
    const p = req.user.personId;
    const s = p ? statement(`p:${p}`, year) : statement(`e:${String(req.user.email).toLowerCase()}`, year);
    if (!s || !s.gifts.length) throw notFound(`A ${year} statement`);
    res.type('html').send(page(`${year} Giving Statement`, s.html));
  });

  return r;
}
