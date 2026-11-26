// People, households, authorized pickups, blockout dates, photos and the CSV import.
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole, requireAllCampuses, accountInReach, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { closeStreams } from '../live.js';
import { syncLeaderAccessFor } from './teams.js';
import { bad, notFound, forbidden, int, str, required, oneOf, isDate, audit, HttpError } from '../http.js';
import { csvRecords, toCsv } from '../csv.js';
import { ledPositionsClause, seesTeamDetail } from '../team-scope.js';
import { visibleFields, valueFromText, setValues } from './fields.js';

export const STATUSES = ['guest', 'regular', 'member', 'inactive'];
const PERSON_FIELDS = ['first_name', 'last_name', 'nickname', 'email', 'phone', 'birthdate', 'gender', 'grade', 'campus_id',
  'status', 'allergies', 'medical_notes', 'notes', 'household_id', 'household_role'];
const HOUSEHOLD_FIELDS = ['name', 'campus_id', 'address', 'city', 'state', 'zip', 'phone', 'notes'];
// Health information and private notes: staff and up only (see GET /people/:id).
const PRIVATE_PERSON_FIELDS = ['allergies', 'medical_notes', 'notes'];
const NAME_MAX = 100;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// isDate plus a real calendar day (2026-02-30 is not one).
const isRealDate = (v) => isDate(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const withoutKeys = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

export function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

export default function peopleRoutes(db, { uploadDir }) {
  const r = Router();
  const getPerson = (id) => db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  const getHousehold = (id) => db.prepare('SELECT * FROM households WHERE id = ?').get(id);

  function visiblePerson(req, id) {
    const p = getPerson(id);
    if (!p) throw notFound('Person');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    return p;
  }

  // A household the signed-in user may work with: it exists and sits at one of their campuses
  // (or has no campus yet). Everything that hangs off a household goes through this.
  function visibleHousehold(req, id) {
    const h = getHousehold(id);
    if (!h) throw notFound('Household');
    if (!canCampus(req.user, h.campus_id)) throw forbidden();
    return h;
  }

  // Cleans an incoming person body; `partial` allows leaving required fields out.
  function personFields(b, partial) {
    const out = {};
    if (!partial || b.first_name !== undefined) out.first_name = required(b.first_name, 'First name');
    for (const k of ['last_name', 'nickname', 'gender', 'allergies', 'medical_notes', 'notes']) if (b[k] !== undefined) out[k] = str(b[k]);
    for (const [k, label] of [['first_name', 'First name'], ['last_name', 'Last name'], ['nickname', 'Nickname']]) {
      if (b[k] !== undefined && String(b[k] ?? '').trim().length > NAME_MAX) throw bad(`${label} is too long (up to ${NAME_MAX} characters).`);
    }
    if (b.email !== undefined) {
      out.email = str(b.email, 200).toLowerCase();
      if (out.email && !EMAIL_SHAPE.test(out.email)) throw bad('That email doesn’t look right. It should be like name@example.org.');
    }
    if (b.phone !== undefined) out.phone = str(b.phone, 40);
    if (b.birthdate !== undefined) {
      if (b.birthdate && !isRealDate(b.birthdate)) throw bad('Birthdate must be a real date, like 2015-04-30.');
      if (b.birthdate && b.birthdate > new Date().toISOString().slice(0, 10)) throw bad('Birthdate can’t be in the future.');
      out.birthdate = b.birthdate || null;
    }
    if (b.grade !== undefined) out.grade = int(b.grade, 'Grade');
    if (b.campus_id !== undefined) out.campus_id = int(b.campus_id, 'Campus');
    if (b.household_id !== undefined) out.household_id = int(b.household_id, 'Household');
    if (b.status !== undefined) out.status = oneOf(b.status, STATUSES, 'guest');
    if (b.household_role !== undefined) out.household_role = oneOf(b.household_role, ['adult', 'child'], 'adult');
    return out;
  }

  // ---------------------------------------------------------------- list / search
  r.get('/people', requireRole('leader'), (req, res) => {
    const where = ['p.archived = ?'];
    const args = [req.query.archived === '1' ? 1 : 0];
    const cf = campusFilter(req.user, 'p.campus_id');
    where.push(cf.sql); args.push(...cf.args);
    if (req.query.campus_id) { where.push('p.campus_id = ?'); args.push(int(req.query.campus_id)); }
    if (STATUSES.includes(req.query.status)) { where.push('p.status = ?'); args.push(req.query.status); }
    if (['adult', 'child'].includes(req.query.role)) { where.push('p.household_role = ?'); args.push(req.query.role); }
    // Profile field filter: ?field_id=3&field_value=Baptized, or field_value=set / unset.
    if (req.query.field_id) {
      const field = visibleFields(db, req.user).find((f) => f.id === int(req.query.field_id));
      if (!field) throw bad('Unknown field.');
      const v = str(req.query.field_value, 100);
      if (v === 'unset') {
        where.push('NOT EXISTS (SELECT 1 FROM profile_values pv WHERE pv.person_id = p.id AND pv.field_id = ?)'); args.push(field.id);
      } else if (!v || v === 'set') {
        where.push('EXISTS (SELECT 1 FROM profile_values pv WHERE pv.person_id = p.id AND pv.field_id = ?)'); args.push(field.id);
      } else if (field.type === 'multi') {
        where.push("EXISTS (SELECT 1 FROM profile_values pv, json_each(pv.value) j WHERE pv.person_id = p.id AND pv.field_id = ? AND j.value = ?)"); args.push(field.id, v);
      } else if (field.type === 'yesno') {
        where.push('EXISTS (SELECT 1 FROM profile_values pv WHERE pv.person_id = p.id AND pv.field_id = ? AND pv.value = ?)'); args.push(field.id, v === 'yes' ? 'true' : 'false');
      } else {
        where.push('EXISTS (SELECT 1 FROM profile_values pv WHERE pv.person_id = p.id AND pv.field_id = ? AND pv.value = ?)'); args.push(field.id, JSON.stringify(v));
      }
    }
    const q = str(req.query.q, 100);
    if (q) {
      const d = digits(q);
      const like = `%${q.toLowerCase()}%`;
      where.push(`(lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(p.nickname || ' ' || p.last_name) LIKE ? OR lower(p.email) LIKE ?${d.length >= 3 ? ' OR replace(replace(replace(replace(p.phone,\'-\',\'\'),\' \',\'\'),\'(\',\'\'),\')\',\'\') LIKE ?' : ''})`);
      args.push(like, like, like);
      if (d.length >= 3) args.push(`%${d}%`);
    }
    const limit = Math.min(int(req.query.limit) ?? 100, 500);
    const offset = int(req.query.offset) ?? 0;
    const sql = `FROM people p LEFT JOIN households h ON h.id = p.household_id WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...args).n;
    const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.email, p.phone, p.status, p.campus_id,
        p.household_id, p.household_role, p.birthdate, p.grade, p.photo, h.name household_name
      ${sql} ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit, offset);
    res.json({ total, rows });
  });

  r.get('/people/export.csv', requireRole('staff'), (req, res) => {
    const cf = campusFilter(req.user, 'p.campus_id');
    const rows = db.prepare(`SELECT p.*, h.name household, c.name campus FROM people p
      LEFT JOIN households h ON h.id = p.household_id LEFT JOIN campuses c ON c.id = p.campus_id
      WHERE p.archived = 0 AND ${cf.sql} ORDER BY p.last_name, p.first_name`).all(...cf.args);
    const cols = ['id', 'first_name', 'last_name', 'nickname', 'email', 'phone', 'birthdate', 'grade', 'status', 'household', 'household_role', 'campus', 'allergies'];
    audit(db, req, 'people.export', `${rows.length} people`);
    res.type('text/csv').attachment('people.csv').send(toCsv([cols, ...rows.map((p) => cols.map((c) => p[c]))]));
  });

  // ---------------------------------------------------------------- one person
  // The account linked to a person, as shown on their page. For an admin it says whether they may
  // change it (`editable`): a campus-limited admin can't touch their own, an admin's or another campus's.
  function accountFor(req, personId) {
    const u = db.prepare(`SELECT u.id, u.role, u.email, u.active, u.last_login, u.campus_ids, u.role_auto, u.finance, u.announce, u.person_id,
        u.password_hash IS NOT NULL has_password, p.campus_id person_campus_id FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.person_id = ?`).get(personId);
    if (!u) return null;
    const { person_id: _p, person_campus_id: campusId, ...account } = u;
    return req.user.role === 'admin' ? { ...account, editable: accountInReach(req.user, { ...u, person_campus_id: campusId }) } : account;
  }

  // Leaders (including people who get leader access just by leading a team) see contact and
  // serving details here, but not health information, private notes or the pickup list: those
  // are for staff and up. Check-in has its own, narrower roster for kids' safety.
  r.get('/people/:id', requireRole('leader'), (req, res) => {
    const p = visiblePerson(req, req.params.id);
    const staff = rank(req.user.role) >= rank('staff');
    // A household at a campus this user can't reach isn't shown, with its notes and pickups.
    const hh = p.household_id ? getHousehold(p.household_id) : null;
    const household = hh && canCampus(req.user, hh.campus_id) ? hh : null;
    const showReasons = staff || db.prepare('SELECT DISTINCT team_id FROM team_members WHERE person_id = ?').all(p.id).some((m) => seesTeamDetail(db, req.user, m.team_id));
    const person = staff ? p : withoutKeys(p, PRIVATE_PERSON_FIELDS);
    // A leader who isn't staff sees another team's serving rows only when they were asked and haven't declined.
    const ledPos = ledPositionsClause(req.user, 'a.position_id');
    const upcomingLimit = staff ? { sql: '1 = 1', args: [] } : { sql: `(${ledPos.sql} OR (a.sent_at IS NOT NULL AND a.status != 'declined'))`, args: ledPos.args };
    res.json({
      ...person,
      household: household && {
        ...(staff ? household : withoutKeys(household, ['notes'])),
        members: db.prepare('SELECT id, first_name, last_name, nickname, household_role, birthdate, photo FROM people WHERE household_id = ? AND archived = 0 ORDER BY household_role, birthdate').all(household.id),
        ...(staff ? { pickups: db.prepare('SELECT * FROM household_pickups WHERE household_id = ?').all(household.id) } : {}),
      },
      teams: db.prepare(`SELECT t.id, t.name, t.color, tm.is_leader, ps.name position FROM team_members tm
        JOIN teams t ON t.id = tm.team_id LEFT JOIN positions ps ON ps.id = tm.position_id
        WHERE tm.person_id = ? AND t.archived = 0 ORDER BY t.name`).all(p.id),
      upcoming: db.prepare(`SELECT a.id, a.status, a.sent_at, s.id service_id, s.starts_at, s.title, ps.name position, c.short_name campus
        FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id
        JOIN campuses c ON c.id = s.campus_id
        WHERE a.person_id = ? AND s.starts_at >= date('now', '-1 day') AND ${upcomingLimit.sql} ORDER BY s.starts_at LIMIT 20`).all(p.id, ...upcomingLimit.args),
      // Campuses they can serve at (empty = home campus only, or any if they have none; see eligibility.js).
      serving_campuses: servingList(p.id),
      // Away reasons are private to staff and the leaders of a team this person is on.
      blockouts: db.prepare("SELECT * FROM blockouts WHERE person_id = ? AND end_date >= date('now') ORDER BY start_date").all(p.id)
        .map((b) => (showReasons ? b : withoutKeys(b, ['reason']))),
      checkins: db.prepare(`SELECT ci.checked_in_at, ci.kind, rm.name room FROM checkins ci LEFT JOIN rooms rm ON rm.id = ci.room_id
        WHERE ci.person_id = ? ORDER BY ci.checked_in_at DESC LIMIT 10`).all(p.id),
      account: accountFor(req, p.id),
    });
  });

  // Leaders can add people too, so welcome-desk volunteers can add a new family at check-in.
  r.post('/people', requireRole('leader'), (req, res) => {
    const b = req.body || {};
    const f = personFields(b, false);
    f.campus_id ??= null;
    // A check-in station adds new families as guests at its campus.
    if (req.user.station) {
      f.status = 'guest';
      f.campus_id = req.user.station.campus_id;
      const hh = f.household_id ? db.prepare('SELECT campus_id FROM households WHERE id = ?').get(f.household_id) : null;
      if (f.household_id && (!hh || (hh.campus_id != null && hh.campus_id !== f.campus_id))) throw forbidden();
    }
    if (!canCampus(req.user, f.campus_id)) throw forbidden();
    // Below staff (leaders, check-in stations) may add a child to a family, never an adult: check-in
    // treats every adult in a household as an approved pickup, which only staff may grant (audited).
    if (f.household_id && rank(req.user.role) < rank('staff') && f.household_role !== 'child') {
      throw new HttpError(403, 'Adding an adult to an existing family is for staff, because every adult in a family can pick up their children. Ask a staff member, or add a child instead.');
    }
    if (f.household_id) visibleHousehold(req, f.household_id);
    if (!b.force) {
      const dup = findDuplicate(req, f);
      if (dup) return res.status(409).json({ error: 'This might be someone already in the system.', duplicate: dup });
    }
    const id = tx(db, () => {
      if (b.new_household) {
        const h = db.prepare('INSERT INTO households (name, campus_id) VALUES (?, ?)').run(`${f.last_name || f.first_name} family`, f.campus_id);
        f.household_id = Number(h.lastInsertRowid);
      }
      const keys = Object.keys(f);
      return db.prepare(`INSERT INTO people (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(f)).lastInsertRowid;
    });
    audit(db, req, 'person.create', `${f.first_name} ${f.last_name || ''}`);
    if (f.household_id) audit(db, req, 'household.member_add', { person_id: Number(id), household_id: f.household_id, role: f.household_role || 'adult', new_household: !!b.new_household });
    res.status(201).json(getPerson(id));
  });

  // Only people at the caller's campuses are compared. Below staff (leaders, stations) the match
  // is just a name, so contact details and birthdates never leak through the 409.
  function findDuplicate(req, f) {
    const cf = campusFilter(req.user, 'campus_id');
    const same = db.prepare(`SELECT id, first_name, last_name, email, phone, birthdate FROM people
      WHERE archived = 0 AND lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND ${cf.sql}`).all(f.first_name, f.last_name || '', ...cf.args);
    const hit = same.find((p) => !f.email && !f.phone && !f.birthdate
      || (f.email && p.email === f.email)
      || (f.phone && digits(p.phone) && digits(p.phone) === digits(f.phone))
      || (f.birthdate && p.birthdate === f.birthdate)) || null;
    if (hit && rank(req.user.role) < rank('staff')) return { id: hit.id, first_name: hit.first_name, last_name: hit.last_name };
    return hit;
  }

  const servingList = (id) => db.prepare('SELECT campus_id FROM serving_campuses WHERE person_id = ? ORDER BY campus_id').all(id).map((x) => x.campus_id);

  // Sets the campuses someone can serve at. Campus-limited staff can only add or remove campuses
  // they can access; anything else already on the list stays as it is.
  r.put('/people/:id/serving-campuses', requireRole('staff'), (req, res) => {
    const p = visiblePerson(req, req.params.id);
    if (!Array.isArray(req.body?.campus_ids)) throw bad('Choose which campuses this person serves at.');
    const wanted = [...new Set(req.body.campus_ids.map((x) => int(x, 'Campus')).filter((x) => x != null))];
    for (const id of wanted) if (!db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(id)) throw bad('One of those campuses doesn’t exist.');
    const current = servingList(p.id);
    const changed = [...wanted.filter((x) => !current.includes(x)), ...current.filter((x) => !wanted.includes(x))];
    if (changed.some((id) => !canCampus(req.user, id))) throw forbidden();
    tx(db, () => {
      db.prepare('DELETE FROM serving_campuses WHERE person_id = ?').run(p.id);
      for (const id of wanted) db.prepare('INSERT INTO serving_campuses (person_id, campus_id) VALUES (?, ?)').run(p.id, id);
    });
    audit(db, req, 'person.serving_campuses', { id: p.id, from: current, to: wanted });
    res.json({ serving_campuses: wanted });
  });

  r.patch('/people/:id', requireRole('staff'), (req, res) => {
    const p = visiblePerson(req, req.params.id);
    const f = personFields(req.body || {}, true);
    if (f.campus_id !== undefined && !canCampus(req.user, f.campus_id)) throw forbidden();
    if (f.household_id) {
      if (!getHousehold(f.household_id)) throw bad('That household doesn’t exist.');
      visibleHousehold(req, f.household_id);
    }
    if (req.body?.archived !== undefined) f.archived = req.body.archived ? 1 : 0;
    updateFields(db, 'people', p.id, f, [...PERSON_FIELDS, 'archived']);
    const moved = f.household_id !== undefined && f.household_id !== p.household_id;
    audit(db, req, 'person.update', { id: p.id, fields: Object.keys(f), ...(moved ? { household_id: { from: p.household_id, to: f.household_id } } : {}) });
    if (moved) audit(db, req, p.household_id ? 'household.member_move' : 'household.member_add', { person_id: p.id, from: p.household_id, to: f.household_id, role: f.household_role ?? p.household_role });
    res.json(getPerson(p.id));
  });

  // Merge a duplicate into the person we keep: their history moves over, then they're archived.
  r.post('/people/:id/merge', requireRole('admin'), (req, res) => {
    const keep = visiblePerson(req, req.params.id);
    const dupId = int(req.body?.duplicate_id, 'Duplicate');
    const dup = visiblePerson(req, dupId);
    if (keep.id === dup.id) throw bad('Pick two different people.');
    // One person, one account: merging two people who both have accounts would leave two on one person.
    const dupUsers = db.prepare('SELECT id FROM users WHERE person_id = ?').all(dup.id);
    const dupUser = dupUsers[0];
    // Merging re-links the duplicate's account, so a campus-limited admin may only do it for accounts they could edit.
    if (req.user.campusIds) {
      const out = db.prepare('SELECT u.*, p.campus_id person_campus_id FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.person_id = ?').all(dup.id).some((u) => !accountInReach(req.user, u));
      if (out) throw new HttpError(403, 'That person’s account is outside your campuses. Ask an admin who covers every campus to merge them.');
    }
    if (dupUser && db.prepare('SELECT 1 FROM users WHERE person_id = ?').get(keep.id)) {
      throw new HttpError(409, 'Both of these people have an account. In Settings → Accounts, unlink one of them first, then merge.');
    }
    // The kept person inherits the duplicate's household when they have none, so it must be one the caller may use.
    if (!keep.household_id && dup.household_id) {
      const hh = getHousehold(dup.household_id);
      if (hh && !canCampus(req.user, hh.campus_id)) throw new HttpError(403, 'The duplicate belongs to a family at a campus you don’t cover, so it can’t be merged here. Ask an admin who covers that campus to merge them.');
    }
    const movedUsers = []; // accounts whose linked person changes: their live chat reconnects
    tx(db, () => {
      for (const [table, col] of [['assignments', 'person_id'], ['checkins', 'person_id'], ['blockouts', 'person_id'], ['plan_items', 'person_id']]) {
        db.prepare(`UPDATE OR IGNORE ${table} SET ${col} = ? WHERE ${col} = ?`).run(keep.id, dup.id);
      }
      db.prepare('UPDATE OR IGNORE team_members SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      db.prepare('UPDATE OR IGNORE attendance SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      db.prepare('DELETE FROM attendance WHERE person_id = ?').run(dup.id);
      db.prepare('UPDATE OR IGNORE profile_values SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      db.prepare('DELETE FROM team_members WHERE person_id = ?').run(dup.id);
      // Small groups: the kept person leads if either of them did. Same for serving campuses.
      db.prepare(`UPDATE group_members SET is_leader = 1 WHERE person_id = ? AND is_leader = 0
        AND group_id IN (SELECT group_id FROM group_members WHERE person_id = ? AND is_leader = 1)`).run(keep.id, dup.id);
      db.prepare('UPDATE OR IGNORE group_members SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      db.prepare('DELETE FROM group_members WHERE person_id = ?').run(dup.id);
      db.prepare('UPDATE OR IGNORE serving_campuses SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      db.prepare('DELETE FROM serving_campuses WHERE person_id = ?').run(dup.id);
      db.prepare('DELETE FROM assignments WHERE person_id = ?').run(dup.id);
      movedUsers.push(...db.prepare('SELECT id FROM users WHERE person_id = ?').all(dup.id).map((u) => u.id));
      db.prepare('UPDATE users SET person_id = ? WHERE person_id = ?').run(keep.id, dup.id);
      // Fill blanks on the kept record from the duplicate.
      const fill = {};
      for (const k of ['email', 'phone', 'birthdate', 'gender', 'allergies', 'medical_notes', 'photo', 'household_id', 'campus_id', 'grade']) {
        if ((keep[k] == null || keep[k] === '') && dup[k] != null && dup[k] !== '') fill[k] = dup[k];
      }
      updateFields(db, 'people', keep.id, fill, Object.keys(fill));
      db.prepare("UPDATE people SET archived = 1, notes = trim(notes || ' (merged into #' || ? || ')') WHERE id = ?").run(keep.id, dup.id);
    });
    for (const id of movedUsers) closeStreams({ userId: id });
    audit(db, req, 'person.merge', `${dup.id} → ${keep.id}`);
    if (!keep.household_id && dup.household_id) audit(db, req, 'household.member_add', { person_id: keep.id, household_id: dup.household_id, role: getPerson(keep.id).household_role, via: 'merge' });
    // The duplicate's existing account moves with the merge (it was already linked; nobody new is linked).
    for (const x of dupUsers) audit(db, req, 'user.link', { user_id: x.id, person_id: keep.id, from_person_id: dup.id, via: 'merge' });
    syncLeaderAccessFor(db, keep.id, req); // leadership may have moved with the merge (no-op without an account)
    res.json(getPerson(keep.id));
  });

  // ---------------------------------------------------------------- photos
  r.post('/people/:id/photo', requireRole('staff'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }), (req, res) => {
    const p = visiblePerson(req, req.params.id);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Send a JPEG, PNG or WebP image.');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.get('content-type')];
    const name = `p${p.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, name), req.body);
    if (p.photo) fs.rm(path.join(uploadDir, path.basename(p.photo)), { force: true }, () => {});
    db.prepare("UPDATE people SET photo = ?, updated_at = datetime('now') WHERE id = ?").run(`/uploads/${name}`, p.id);
    res.json({ photo: `/uploads/${name}` });
  });

  // ---------------------------------------------------------------- households
  r.get('/households', requireRole('leader'), (req, res) => {
    const q = `%${str(req.query.q, 100).toLowerCase()}%`;
    const cf = campusFilter(req.user, 'h.campus_id');
    // Matches the family's name or anyone in it, so "Brooks" or "Laura" both find the Brooks family.
    const rows = db.prepare(`SELECT h.id, h.name, h.campus_id, (SELECT COUNT(*) FROM people p WHERE p.household_id = h.id AND p.archived = 0) members
      FROM households h WHERE (lower(h.name) LIKE ? OR EXISTS (SELECT 1 FROM people m WHERE m.household_id = h.id AND m.archived = 0
        AND (lower(m.first_name || ' ' || m.last_name) LIKE ? OR lower(coalesce(m.nickname, '') || ' ' || m.last_name) LIKE ?)))
        AND ${cf.sql} ORDER BY h.name LIMIT 30`).all(q, q, q, ...cf.args);
    const people = db.prepare("SELECT first_name, nickname, household_role FROM people WHERE household_id = ? AND archived = 0 ORDER BY household_role, birthdate");
    res.json(rows.map((h) => ({ ...h, people: people.all(h.id).map((m) => ({ name: m.nickname || m.first_name, role: m.household_role })) })));
  });

  r.post('/households', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id);
    if (!canCampus(req.user, campusId)) throw forbidden();
    const info = db.prepare('INSERT INTO households (name, campus_id, address, city, state, zip, phone) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(required(b.name, 'Household name'), campusId, str(b.address), str(b.city), str(b.state), str(b.zip), str(b.phone));
    audit(db, req, 'household.create', { id: Number(info.lastInsertRowid), name: str(b.name), campus_id: campusId });
    res.status(201).json(getHousehold(info.lastInsertRowid));
  });

  r.patch('/households/:id', requireRole('staff'), (req, res) => {
    const h = visibleHousehold(req, req.params.id);
    const b = { ...req.body };
    if (b.campus_id !== undefined) {
      b.campus_id = int(b.campus_id);
      if (!canCampus(req.user, b.campus_id)) throw forbidden();
    }
    if (b.name !== undefined) b.name = required(b.name, 'Household name');
    updateFields(db, 'households', h.id, b, HOUSEHOLD_FIELDS);
    const campusChanged = b.campus_id !== undefined && b.campus_id !== h.campus_id;
    audit(db, req, 'household.update', { id: h.id, fields: HOUSEHOLD_FIELDS.filter((k) => b[k] !== undefined), ...(campusChanged ? { from_campus: h.campus_id, to_campus: b.campus_id } : {}) });
    res.json(getHousehold(h.id));
  });

  r.post('/households/:id/pickups', requireRole('staff'), (req, res) => {
    const h = visibleHousehold(req, req.params.id);
    const b = req.body || {};
    const info = db.prepare('INSERT INTO household_pickups (household_id, name, phone, relationship) VALUES (?, ?, ?, ?)')
      .run(h.id, required(b.name, 'Name'), str(b.phone, 40), str(b.relationship, 60));
    audit(db, req, 'pickup.add', { household_id: h.id, name: str(b.name) });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.delete('/pickups/:id', requireRole('staff'), (req, res) => {
    const pk = db.prepare('SELECT * FROM household_pickups WHERE id = ?').get(req.params.id);
    if (!pk) throw notFound('Pickup person');
    visibleHousehold(req, pk.household_id);
    db.prepare('DELETE FROM household_pickups WHERE id = ?').run(pk.id);
    audit(db, req, 'pickup.remove', { household_id: pk.household_id, name: pk.name });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- blockouts
  // Volunteers manage their own; leaders and up can set them for anyone they can see.
  function blockoutPerson(req, personId) {
    if (rank(req.user.role) < rank('leader') && personId !== req.user.personId) throw forbidden();
    return visiblePerson(req, personId);
  }

  r.post('/blockouts', requireRole('volunteer'), (req, res) => {
    const b = req.body || {};
    const p = blockoutPerson(req, int(b.person_id) ?? req.user.personId);
    if (!isRealDate(b.start_date) || !isRealDate(b.end_date || b.start_date)) throw bad('Pick the dates you’re away.');
    const end = b.end_date || b.start_date;
    if (end < b.start_date) throw bad('The last day can’t be before the first day.');
    const info = db.prepare('INSERT INTO blockouts (person_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)')
      .run(p.id, b.start_date, end, str(b.reason, 200));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.delete('/blockouts/:id', requireRole('volunteer'), (req, res) => {
    const bo = db.prepare('SELECT * FROM blockouts WHERE id = ?').get(req.params.id);
    if (!bo) throw notFound('Blockout');
    blockoutPerson(req, bo.person_id);
    db.prepare('DELETE FROM blockouts WHERE id = ?').run(bo.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- import (e.g. from Faith Teams)
  const IMPORT_FIELDS = {
    external_id: ['id', 'person id', 'individual id', 'member id'],
    first_name: ['first name', 'firstname', 'first', 'given name'],
    last_name: ['last name', 'lastname', 'last', 'surname', 'family name'],
    nickname: ['nickname', 'preferred name', 'goes by'],
    email: ['email', 'email address', 'primary email', 'e-mail'],
    phone: ['phone', 'mobile', 'cell', 'mobile phone', 'cell phone', 'phone number', 'primary phone'],
    birthdate: ['birthdate', 'birthday', 'date of birth', 'dob', 'birth date'],
    gender: ['gender', 'sex'],
    grade: ['grade', 'school grade'],
    status: ['status', 'membership status', 'member status', 'membership'],
    household: ['household', 'family', 'family name', 'household name', 'family id', 'household id'],
    household_role: ['family role', 'household role', 'role', 'family position'],
    address: ['address', 'street', 'address 1', 'street address', 'address line 1'],
    city: ['city'],
    state: ['state', 'province'],
    zip: ['zip', 'zip code', 'postal code', 'zipcode'],
    allergies: ['allergies', 'allergy', 'medical alerts'],
    campus: ['campus', 'location', 'site'],
  };

  function guessMapping(headers) {
    const map = {};
    for (const [field, names] of Object.entries(IMPORT_FIELDS)) {
      const hit = headers.find((h) => names.includes(h.toLowerCase().replace(/[_.]/g, ' ').trim()));
      if (hit) map[field] = hit;
    }
    return map;
  }

  r.post('/import/preview', requireRole('admin'), requireAllCampuses, express.text({ type: '*/*', limit: '20mb' }), (req, res) => {
    const { headers, records } = csvRecords(req.body);
    if (!headers.length) throw bad('That file looks empty.');
    const custom = visibleFields(db, req.user);
    const mapping = guessMapping(headers);
    // Columns named like a custom field ("Baptism Date") map to it automatically.
    for (const f of custom) {
      const hit = headers.find((h) => h.toLowerCase().replace(/[_.]/g, ' ').trim() === f.label.toLowerCase());
      if (hit) mapping[`field:${f.id}`] = hit;
    }
    res.json({
      headers, mapping, count: records.length, sample: records.slice(0, 5),
      fields: [...Object.keys(IMPORT_FIELDS), ...custom.map((f) => `field:${f.id}`)],
      labels: Object.fromEntries(custom.map((f) => [`field:${f.id}`, f.label])),
    });
  });

  r.post('/import/people', requireRole('admin'), requireAllCampuses, express.json({ limit: '25mb' }), (req, res) => {
    const { csv, mapping = {}, campus_id: defaultCampus = null, dry_run: dryRun = false } = req.body || {};
    const { records } = csvRecords(csv || '');
    if (!records.length) throw bad('Nothing to import.');
    if (!mapping.first_name) throw bad('Choose which column has first names.');
    const campuses = db.prepare('SELECT id, name, short_name FROM campuses').all();
    const campusFor = (v) => {
      const s = String(v || '').toLowerCase();
      return campuses.find((c) => c.name.toLowerCase() === s || c.short_name.toLowerCase() === s)?.id ?? (int(defaultCampus) || null);
    };
    const val = (rec, field) => (mapping[field] ? rec[mapping[field]] ?? '' : '');
    const custom = visibleFields(db, req.user).filter((f) => mapping[`field:${f.id}`]);
    const saveCustom = (personId, rec) => {
      const values = {};
      for (const f of custom) {
        const v = valueFromText(f, val(rec, `field:${f.id}`), parseDate);
        if (v !== null) values[f.id] = v;
      }
      setValues(db, personId, custom, values);
    };

    const summary = { created: 0, updated: 0, households: 0, skipped: [], total: records.length };
    const run = () => {
      const householdIds = new Map();
      records.forEach((rec, i) => {
        const first = val(rec, 'first_name');
        if (!first) { summary.skipped.push({ row: i + 2, reason: 'no first name' }); return; }
        const last = val(rec, 'last_name');
        const email = val(rec, 'email').trim().toLowerCase();
        const ext = val(rec, 'external_id');
        const birth = parseDate(val(rec, 'birthdate'));
        const campusId = campusFor(val(rec, 'campus'));
        const existing = (ext && db.prepare('SELECT * FROM people WHERE external_id = ?').get(ext))
          || (email && db.prepare('SELECT * FROM people WHERE email = ? AND lower(first_name) = lower(?) AND archived = 0').get(email, first))
          || null;

        // Group into households by the household column, else by last name + address.
        const hKey = val(rec, 'household') || (val(rec, 'address') ? `${last}|${val(rec, 'address')}`.toLowerCase() : `${last}|${email || i}`);
        let householdId = existing?.household_id ?? householdIds.get(hKey);
        if (!householdId) {
          const hName = val(rec, 'household') && !/^\d+$/.test(val(rec, 'household')) ? val(rec, 'household') : `${last || first} family`;
          householdId = Number(db.prepare('INSERT INTO households (name, campus_id, address, city, state, zip) VALUES (?, ?, ?, ?, ?, ?)')
            .run(hName, campusId, val(rec, 'address'), val(rec, 'city'), val(rec, 'state'), val(rec, 'zip')).lastInsertRowid);
          summary.households++;
        }
        householdIds.set(hKey, householdId);

        const roleRaw = val(rec, 'household_role').toLowerCase();
        const isChild = /child|son|daughter|dependent|kid/.test(roleRaw) || (!roleRaw && birth && ageYears(birth) < 18);
        const status = matchStatus(val(rec, 'status'));
        const fields = {
          first_name: first, last_name: last, nickname: val(rec, 'nickname'), email, phone: val(rec, 'phone'),
          birthdate: birth, gender: val(rec, 'gender'), grade: parseGrade(val(rec, 'grade')), status,
          household_id: householdId, household_role: isChild ? 'child' : 'adult', allergies: val(rec, 'allergies'),
          campus_id: campusId, external_id: ext || null,
        };
        if (existing) {
          const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== '' && v != null && k !== 'household_id'));
          updateFields(db, 'people', existing.id, changes, Object.keys(changes));
          saveCustom(existing.id, rec);
          summary.updated++;
        } else {
          const keys = Object.keys(fields);
          const id = db.prepare(`INSERT INTO people (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(fields)).lastInsertRowid;
          saveCustom(Number(id), rec);
          summary.created++;
        }
      });
      if (dryRun) throw new DryRun();
    };
    try {
      tx(db, run);
    } catch (e) {
      if (!(e instanceof DryRun)) throw e instanceof HttpError ? e : bad(`Import stopped: ${e.message}`);
    }
    if (!dryRun) audit(db, req, 'people.import', summary);
    res.json({ ...summary, dry_run: Boolean(dryRun) });
  });

  return r;
}

class DryRun extends Error {}

function matchStatus(s) {
  s = String(s || '').toLowerCase();
  if (!s) return 'regular';
  if (/inactive|former|moved|deceased/.test(s)) return 'inactive';
  if (/member/.test(s) && !/non/.test(s)) return 'member';
  if (/guest|visitor|first/.test(s)) return 'guest';
  return 'regular';
}

// Accepts 2014-03-09, 3/9/2014, 03/09/14.
export function parseDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    return fmt(y, +m[1], +m[2]);
  }
  return null;
}

function fmt(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function ageYears(birth) {
  return (Date.now() - Date.parse(birth)) / (365.25 * 864e5);
}

function parseGrade(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  if (/^k|kinder/.test(s)) return 0;
  if (/pre/.test(s)) return -1;
  const n = parseInt(s, 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}
