// "My info": a signed-in member edits their own contact details from the app. Only the person
// linked to their account: phone and birthday, and (adults only) their household's home address.
// Email, family, status, campus and notes are the office's to change. Anything else goes through "Tell the office", which notifies staff.
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { HttpError, bad, str, required, audit } from '../http.js';
import { notify } from '../notify.js';
import { personFields } from './people.js';

const EDITABLE = ['phone', 'birthdate'];
// A teen's account can't change its own birthday: age decides kids' check-in rooms.
const editable = (p) => (p.household_role === 'child' ? ['phone'] : EDITABLE);
const TOPICS = { email: 'Change my email', family: 'Update my family', other: 'Something else' };
const HOURLY_CAP = 5;
const ADDRESS = { address: 200, city: 100, state: 50, zip: 20 };
// The home address belongs to the whole household; an adult in it may change it for everyone.
const canEditAddress = (p) => Boolean(p.household_id) && p.household_role !== 'child';

// The Home cards a person can order and hide (public/js/pages/home.js draws them; keep both lists in step).
export const HOME_CARDS = ['attention', 'services', 'serving', 'attendance', 'away', 'totals'];

export default function meRoutes(db) {
  const r = Router();

  // A personal preference, like the theme: only the signed-in account's own row, no id is accepted,
  // and it isn't audited. Body: { order: [cardId], hidden: [cardId] }. Card ids the person can't see
  // by role are simply ignored when Home is drawn.
  const idList = (v, what) => {
    if (!Array.isArray(v) || v.length > HOME_CARDS.length) throw bad(`The ${what} list isn’t right. Please try again.`);
    if (v.some((x) => !HOME_CARDS.includes(x)) || new Set(v).size !== v.length) throw bad(`We don’t recognise one of the cards in the ${what} list. Please refresh and try again.`);
    return v;
  };
  r.put('/me/home-layout', requireRole('volunteer'), (req, res) => {
    const layout = { order: idList(req.body?.order, 'order'), hidden: idList(req.body?.hidden, 'hidden') };
    db.prepare('UPDATE users SET home_layout = ? WHERE id = ?').run(JSON.stringify(layout), req.user.id);
    res.json({ home_layout: layout });
  });
  // Back to the standard Home.
  r.delete('/me/home-layout', requireRole('volunteer'), (req, res) => {
    db.prepare('UPDATE users SET home_layout = NULL WHERE id = ?').run(req.user.id);
    res.json({ home_layout: null });
  });

  // The caller's own person record, never one named in the request.
  function mine(req) {
    if (!req.user.personId) throw new HttpError(409, 'Your account isn’t connected to your record in the church directory yet. Please ask the office to link it.');
    const p = db.prepare('SELECT * FROM people WHERE id = ? AND archived = 0').get(req.user.personId);
    if (!p) throw new HttpError(409, 'We couldn’t find your record in the church directory. Please ask the office to take a look.');
    return p;
  }

  const view = (p) => {
    const hh = p.household_id ? db.prepare('SELECT address, city, state, zip FROM households WHERE id = ?').get(p.household_id) : null;
    const campus = p.campus_id ? db.prepare('SELECT name FROM campuses WHERE id = ?').get(p.campus_id) : null;
    return {
      first_name: p.first_name, last_name: p.last_name, email: p.email, phone: p.phone, birthdate: p.birthdate, can_edit_birthdate: editable(p).includes('birthdate'),
      campus: campus?.name || '',
      address: hh ? [hh.address, [hh.city, hh.state].filter(Boolean).join(', '), hh.zip].filter(Boolean).join(' · ') : '',
      home: hh ? { address: hh.address || '', city: hh.city || '', state: hh.state || '', zip: hh.zip || '' } : null,
      can_edit_address: canEditAddress(p),
    };
  };

  r.get('/me/person', requireRole('volunteer'), (req, res) => res.json(view(mine(req))));

  // Body: { phone?, birthdate? }. Any other field is refused rather than quietly dropped.
  r.patch('/me/person', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    const b = req.body || {};
    const allowed = editable(p);
    const extra = Object.keys(b).filter((k) => !allowed.includes(k));
    if (extra.length) throw bad('You can change your phone and birthday here. For anything else, use “Tell the office”.');
    const f = personFields(b, true);
    const changed = allowed.filter((k) => f[k] !== undefined && (f[k] ?? '') !== (p[k] ?? ''));
    if (changed.length) {
      db.prepare(`UPDATE people SET ${changed.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...changed.map((k) => f[k]), p.id);
      // Field names only: phone numbers and birthdays aren't copied into the log.
      audit(db, req, 'me.person.update', { id: p.id, fields: changed });
    }
    res.json(view(mine(req)));
  });

  // Body: { address, city, state, zip }: the household's home address, changed for everyone in it.
  // Adults only; a person with no household asks the office.
  r.patch('/me/address', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    if (!canEditAddress(p)) throw new HttpError(403, p.household_id ? 'Please ask an adult in your household, or the office, to change the home address.' : 'You’re not in a household yet. Please use “Tell the office” to send your address.');
    const b = req.body || {};
    const extra = Object.keys(b).filter((k) => !Object.hasOwn(ADDRESS, k));
    if (extra.length) throw bad('Only the street, city, state and zip can be changed here.');
    const hh = db.prepare('SELECT address, city, state, zip FROM households WHERE id = ?').get(p.household_id);
    const next = Object.fromEntries(Object.entries(ADDRESS).map(([k, max]) => [k, b[k] === undefined ? (hh[k] || '') : str(b[k], max)]));
    const changed = Object.keys(ADDRESS).filter((k) => next[k] !== (hh[k] || ''));
    if (changed.length) {
      db.prepare("UPDATE households SET address = ?, city = ?, state = ?, zip = ?, updated_at = datetime('now') WHERE id = ?").run(next.address, next.city, next.state, next.zip, p.household_id);
      // Field names only: the address itself isn't copied into the log.
      audit(db, req, 'me.household.address', { person_id: p.id, household_id: p.household_id, fields: changed });
    }
    res.json(view(mine(req)));
  });

  // Body: { topic: 'email' | 'family' | 'other', message }. Staff and admins who reach the person's campus hear about it.
  r.post('/me/office-request', requireRole('volunteer'), (req, res) => {
    const p = mine(req);
    const topic = Object.hasOwn(TOPICS, req.body?.topic) ? req.body.topic : 'other';
    const message = required(req.body?.message, 'Your message').slice(0, 1000);
    const recent = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id = ? AND action = 'me.office_request' AND at > datetime('now', '-1 hour')").get(req.user.id).n;
    if (recent >= HOURLY_CAP) throw new HttpError(429, 'You’ve sent a few notes already. Please give the office a little time to reply.');
    const staff = db.prepare("SELECT id, campus_ids FROM users WHERE active = 1 AND role IN ('staff', 'admin') AND id != ?").all(req.user.id)
      .filter((u) => !u.campus_ids || !p.campus_id || JSON.parse(u.campus_ids).includes(p.campus_id)).map((u) => u.id);
    const name = `${p.first_name} ${p.last_name}`.trim();
    const made = notify(db, staff, {
      kind: 'account',
      title: `${name}: ${TOPICS[topic]}`,
      body: message,
      push_body: 'Someone sent a message to the office.',
      url: `/#/people/${p.id}`,
    });
    audit(db, req, 'me.office_request', { id: p.id, topic, notified: made.length });
    res.status(201).json({ ok: true, notified: made.length });
  });

  return r;
}
