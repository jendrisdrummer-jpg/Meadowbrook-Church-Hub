// Check-in holds ("Hold: see coordinator"), releasing a held child, and who the safeguarding lead is.
// Staff with check-in access at the campus place, change and lift holds; the safeguarding lead can read them.
// Never an iPad: a station only ever learns that a child has a hold (see checkin.js), not why.
import { Router } from 'express';
import { rank, requireRole, requireAllCampuses, canCheckin, canCheckinCampus, canCampus } from '../auth.js';
import { setSetting, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, audit, HttpError } from '../http.js';
import { recordEvent } from '../checkin-events.js';
import { checkinFeatures } from '../checkin-settings.js';
import { activeHold, isLead, leadIds, leadAccounts, tellLeads, resolveCollector, MAX_LEADS } from '../holds.js';

const NOTE_MAX = 300;
const nameOf = (u) => String(u?.name || '').slice(0, 100);

export default function checkinHoldRoutes(db) {
  const r = Router();
  // Staff (or admin) who also have check-in access. A leader with the Kids' check-in switch is not enough for holds.
  const manages = (user) => Boolean(user) && !user.station && rank(user.role) >= rank('staff') && canCheckin(user);
  const requireManager = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!manages(req.user)) return res.status(403).json({ error: 'Holds are placed and lifted by staff with check-in access. Ask a staff member.' });
    next();
  };
  const campusRow = (id) => {
    const c = db.prepare('SELECT * FROM campuses WHERE id = ?').get(int(id, 'Campus'));
    if (!c) throw notFound('Campus');
    return c;
  };
  const view = (h) => ({ id: h.id, person_id: h.person_id, person_name: h.name || h.person_name, campus_id: h.campus_id, note: h.note, active: h.lifted_at == null,
    placed_at: h.placed_at, placed_by_name: h.placed_by_name, changed_at: h.changed_at, changed_by_name: h.changed_by_name,
    lifted_at: h.lifted_at, lifted_by_name: h.lifted_by_name, lift_reason: h.lift_reason });
  const SELECT = `SELECT h.*, TRIM(COALESCE(NULLIF(p.nickname, ''), p.first_name, '') || ' ' || COALESCE(p.last_name, '')) name FROM checkin_holds h LEFT JOIN people p ON p.id = h.person_id`;
  const one = (id) => view(db.prepare(`${SELECT} WHERE h.id = ?`).get(id));
  const personName = (p) => `${p.nickname || p.first_name || ''} ${p.last_name || ''}`.trim();

  // Holds, for staff with check-in access and for the named safeguarding lead (read only).
  // ?campus_id=N: the holds that are on at that campus. ?person_id=N: that child's holds, newest first, lifted ones too.
  r.get('/checkin/holds', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    const mgr = manages(req.user);
    if (req.user.station || (!mgr && !isLead(db, req.user))) throw forbidden();
    const may = (campusId) => (mgr ? canCheckinCampus(db, req.user, campusId) : canCampus(req.user, campusId));
    res.set('Cache-Control', 'no-store');
    if (req.query.person_id !== undefined) {
      const id = int(req.query.person_id, 'Person');
      const all = db.prepare(`${SELECT} WHERE h.person_id = ? ORDER BY h.id DESC LIMIT 50`).all(id);
      const rows = all.filter((h) => may(h.campus_id));
      const out = rows.map(view);
      // A hold placed at a campus this account can't see still has to be visible as a hold, or staff here would see "No hold" on a
      // child who has one. Staff with check-in access at the child's or family's campus learn only that it exists: never the
      // note, who placed it, or why.
      if (mgr && all.some((h) => h.lifted_at == null) && !rows.some((h) => h.lifted_at == null)) {
        const p = db.prepare('SELECT p.campus_id, hh.campus_id household_campus FROM people p LEFT JOIN households hh ON hh.id = p.household_id WHERE p.id = ?').get(id);
        const campuses = p ? [p.campus_id, p.household_campus].filter((x) => x != null) : [];
        if (p && (campuses.length ? campuses.some((x) => canCheckinCampus(db, req.user, x)) : canCheckinCampus(db, req.user, null))) {
          out.unshift({ person_id: id, active: true, other_campus: true });
        }
      }
      return res.json({ holds: out, can_manage: mgr, hold_mode: checkinFeatures(db).holds });
    }
    const c = campusRow(req.query.campus_id);
    if (!may(c.id)) throw forbidden();
    const rows = db.prepare(`${SELECT} WHERE h.campus_id = ? AND h.lifted_at IS NULL ORDER BY h.placed_at DESC LIMIT 500`).all(c.id);
    res.json({ holds: rows.map(view), can_manage: mgr, hold_mode: checkinFeatures(db).holds });
  });

  // Place a hold on a child. Body: { person_id, campus_id, note? }. The note is private to staff in the Hub (a pointer to
  // the confidential list, not the details). One hold at a time per child.
  r.post('/checkin/holds', requireManager, (req, res) => {
    if (checkinFeatures(db).holds === 'off') throw new HttpError(409, 'Pickup holds are switched off for this church. An admin can turn them on under Check-in iPads.');
    const c = campusRow(req.body?.campus_id);
    if (!canCheckinCampus(db, req.user, c.id)) throw forbidden();
    const p = db.prepare('SELECT p.*, h.campus_id household_campus FROM people p LEFT JOIN households h ON h.id = p.household_id WHERE p.id = ?').get(int(req.body?.person_id, 'Child'));
    if (!p) throw notFound('Child');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    if (p.household_role !== 'child') throw bad('A hold is for a child.');
    if (p.archived) throw bad('That child is archived.');
    if (p.household_campus != null && p.household_campus !== c.id) throw bad('That child’s family belongs to another campus. Place the hold from that campus.');
    if (activeHold(db, p.id)) throw new HttpError(409, 'This child already has a hold. Change its note, or lift it first.');
    const note = str(req.body?.note, NOTE_MAX);
    const name = personName(p);
    const at = new Date().toISOString();
    const id = tx(db, () => {
      const hid = Number(db.prepare('INSERT INTO checkin_holds (person_id, person_name, campus_id, note, placed_at, placed_by, placed_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(p.id, name.slice(0, 100), c.id, note, at, req.user.id, nameOf(req.user)).lastInsertRowid);
      // The record and the audit log hold ids only, never the note.
      recordEvent(db, req, { action: 'hold.set', campusId: c.id, personId: p.id, householdId: p.household_id, detail: { hold_id: hid } });
      audit(db, req, 'checkin.hold.set', { hold_id: hid, person_id: p.id, campus_id: c.id });
      return hid;
    });
    const lead = tellLeads(db, { title: 'A check-in hold was placed', body: `${nameOf(req.user) || 'A staff member'} placed a hold on ${name} at ${c.name}.`, personId: p.id });
    res.status(201).json({ ...one(id), lead });
  });

  const loadHold = (req) => {
    const h = db.prepare('SELECT * FROM checkin_holds WHERE id = ?').get(int(req.params.id, 'Hold'));
    if (!h) throw notFound('Hold');
    if (!canCheckinCampus(db, req.user, h.campus_id)) throw forbidden();
    if (h.lifted_at) throw new HttpError(409, 'That hold has already been lifted.');
    return h;
  };

  // Change a hold's private note. Body: { note }.
  r.patch('/checkin/holds/:id', requireManager, (req, res) => {
    const h = loadHold(req);
    if (typeof req.body?.note !== 'string') throw bad('Write the note.');
    const note = str(req.body.note, NOTE_MAX);
    if (note === h.note) return res.json(one(h.id));
    tx(db, () => {
      db.prepare('UPDATE checkin_holds SET note = ?, changed_at = ?, changed_by = ?, changed_by_name = ? WHERE id = ?').run(note, new Date().toISOString(), req.user.id, nameOf(req.user), h.id);
      recordEvent(db, req, { action: 'hold.change', campusId: h.campus_id, personId: h.person_id, detail: { hold_id: h.id } });
      audit(db, req, 'checkin.hold.change', { hold_id: h.id, person_id: h.person_id, campus_id: h.campus_id });
    });
    const lead = tellLeads(db, { title: 'A check-in hold was changed', body: `${nameOf(req.user) || 'A staff member'} changed the hold on ${h.person_name}.`, personId: h.person_id });
    res.json({ ...one(h.id), lead });
  });

  // Lift a hold. Body: { reason }. The row stays, as history.
  r.delete('/checkin/holds/:id', requireManager, (req, res) => {
    const h = loadHold(req);
    const reason = str(req.body?.reason, 300);
    if (!reason) throw bad('Say why you’re lifting this hold.');
    tx(db, () => {
      db.prepare('UPDATE checkin_holds SET lifted_at = ?, lifted_by = ?, lifted_by_name = ?, lift_reason = ? WHERE id = ?').run(new Date().toISOString(), req.user.id, nameOf(req.user), reason, h.id);
      recordEvent(db, req, { action: 'hold.lift', campusId: h.campus_id, personId: h.person_id, detail: { hold_id: h.id } });
      audit(db, req, 'checkin.hold.lift', { hold_id: h.id, person_id: h.person_id, campus_id: h.campus_id });
    });
    const lead = tellLeads(db, { title: 'A check-in hold was lifted', body: `${nameOf(req.user) || 'A staff member'} lifted the hold on ${h.person_name}.`, personId: h.person_id });
    res.json({ ...one(h.id), lead });
  });

  // Release a held child who is checked in now, in the Hub, to someone chosen from the family's list or (with photo ID) someone
  // else. Body: { collector: { kind, person_id | pickup_id | name, relationship?, id_type }, reason }. The hold stays on.
  r.post('/checkin/checkins/:id/release-held', requireManager, (req, res) => {
    const ci = db.prepare(`SELECT ci.*, p.household_id, TRIM(COALESCE(NULLIF(p.nickname, ''), p.first_name, '') || ' ' || COALESCE(p.last_name, '')) child
      FROM checkins ci JOIN people p ON p.id = ci.person_id WHERE ci.id = ?`).get(req.params.id);
    if (!ci) throw notFound('Check-in');
    if (!canCheckinCampus(db, req.user, ci.campus_id)) throw forbidden();
    if (ci.voided_at) throw new HttpError(409, 'That check-in was voided.');
    if (ci.checked_out_at) throw new HttpError(409, 'That child has already been checked out.');
    const hold = activeHold(db, ci.person_id);
    if (!hold) throw new HttpError(409, 'This child doesn’t have a hold, so check them out at the check-out screen.');
    // A hold placed at a campus this account doesn't cover is the other campus's to release.
    if (!canCheckinCampus(db, req.user, hold.campus_id)) throw new HttpError(403, 'This hold was placed at another campus. Contact that campus’s staff before releasing this child.');
    const reason = str(req.body?.reason, 300);
    if (!reason) throw bad('Say what you checked before releasing this child (for example, “called a parent”).');
    const who = resolveCollector(db, req.body?.collector, ci.household_id, { allowOther: true });
    tx(db, () => {
      const info = db.prepare(`UPDATE checkins SET checked_out_at = ?, checked_out_by = ?, checked_out_user_id = ?, checked_out_to_name = ?, checked_out_to_relationship = ?, checked_out_to_kind = ?,
        checked_out_id_type = ?, checked_out_held = 1 WHERE id = ? AND checked_out_at IS NULL AND voided_at IS NULL`)
        .run(new Date().toISOString(), nameOf(req.user), req.user.id, who.name, who.relationship, who.kind, who.id_type, ci.id);
      if (Number(info.changes) !== 1) throw new HttpError(409, 'That child has already been checked out.');
      recordEvent(db, req, { action: 'checkout', campusId: ci.campus_id, checkinId: ci.id, personId: ci.person_id, householdId: ci.household_id, code: ci.security_code,
        detail: { path: 'hub', held: true, collector: who } });
      recordEvent(db, req, { action: 'checkout.held_released', campusId: ci.campus_id, checkinId: ci.id, personId: ci.person_id, householdId: ci.household_id, code: ci.security_code,
        detail: { hold_id: hold.id, via: 'hub', collector_kind: who.kind, id_type: who.id_type } });
      audit(db, req, 'checkin.hold.release', { checkin_id: ci.id, hold_id: hold.id, person_id: ci.person_id, campus_id: ci.campus_id, collector_kind: who.kind, id_type: who.id_type, reason });
    });
    const lead = tellLeads(db, { title: 'A child with a hold was released',
      body: `${nameOf(req.user) || 'A staff member'} released ${ci.child}, who has a hold, to ${who.name}${who.relationship ? ` (${who.relationship})` : ''}.`, personId: ci.person_id });
    res.json({ ok: true, lead });
  });

  // ---------------------------------------------------------------- the safeguarding lead
  // Who is told about holds: a per-church setting. Staff may see who it is (so the Hub can warn when nobody is named).
  const leadView = () => {
    const ids = leadIds(db);
    const leads = ids.length ? db.prepare(`SELECT u.id, u.email, p.first_name, p.last_name FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.active = 1 AND u.id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    return { lead_ids: leads.map((u) => u.id), leads: leads.map((u) => ({ id: u.id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email })), fallback: leadAccounts(db).fallback };
  };
  r.get('/checkin/safeguarding', requireRole('staff'), (req, res) => {
    if (req.user.station) throw forbidden();
    res.json(leadView());
  });
  r.put('/checkin/safeguarding', requireRole('admin'), requireAllCampuses, (req, res) => {
    const ids = req.body?.lead_ids;
    if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw bad('Choose people from the list.');
    const unique = [...new Set(ids)];
    if (unique.length > MAX_LEADS) throw bad(`Name up to ${MAX_LEADS} people.`);
    for (const id of unique) if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) throw bad('Choose people who have an active account.');
    const from = leadIds(db);
    tx(db, () => {
      setSetting(db, 'checkin_safeguarding', { lead_ids: unique });
      audit(db, req, 'checkin.safeguarding', { from, to: unique });
      recordEvent(db, req, { action: 'safety.settings', detail: { changed: ['safeguarding_leads'], count: unique.length } });
    });
    res.json(leadView());
  });

  return r;
}
