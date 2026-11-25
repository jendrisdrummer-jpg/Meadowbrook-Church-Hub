// Small groups (Bible study, home groups…). A separate model from serving teams: a group never
// grants leader access and never appears in scheduling. Staff manage groups at their campuses
// (church-wide groups: only staff with no campus limit); a group's own leaders manage its roster.
// Members and leaders see names and photos; only staff also see email and phone. Each group has
// a chat that follows its roster and is private to its members, staff included (see chat.js).
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { HttpError, notFound, forbidden, bad, int, str, required, audit } from '../http.js';
import { send } from '../live.js';

// A leader who isn't staff may add this many people per rolling day.
const LEADER_ADDS_PER_DAY = 30;
// People-finder searches by group leaders who aren't staff: at most 60 an hour each.
const FINDER_PER_HOUR = 60;
const finderUse = new Map();
export function finderLimit(userId, now = Date.now()) {
  const recent = (finderUse.get(userId) || []).filter((t) => t > now - 3600e3);
  if (recent.length >= FINDER_PER_HOUR) { finderUse.set(userId, recent); return false; }
  recent.push(now);
  finderUse.set(userId, recent);
  return true;
}

export default function groupRoutes(db) {
  const r = Router();
  const isStaff = (req) => rank(req.user.role) >= rank('staff');

  // Staff powers over a group: staff at its campus; for a church-wide group (no campus), only staff
  // with no campus limit. Campus-limited staff are ordinary members there.
  const staffOf = (req, g) => isStaff(req) && (g.campus_id == null ? !req.user.campusIds : canCampus(req.user, g.campus_id));
  // Adults only: not marked a child, no school grade, and (if we know it) at least 18.
  const ADULT_SQL = "p.household_role != 'child' AND p.grade IS NULL AND (p.birthdate IS NULL OR p.birthdate <= date('now', '-18 years'))";
  const isAdult = (p) => {
    if (p.household_role === 'child' || p.grade != null) return false;
    if (!p.birthdate) return true;
    const cut = new Date(); cut.setUTCFullYear(cut.getUTCFullYear() - 18);
    return p.birthdate <= cut.toISOString().slice(0, 10);
  };
  // Loads a group and what this account may do with it, or refuses. Archived groups are only
  // for staff (to bring back); everyone else gets "not found".
  function open(req, id) {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(int(id, 'group'));
    if (!g) throw notFound('Group');
    const staff = staffOf(req, g);
    const row = req.user.personId && db.prepare('SELECT is_leader FROM group_members WHERE group_id = ? AND person_id = ?').get(g.id, req.user.personId);
    if (g.archived && !staff) throw notFound('Group');
    if (!staff && !row) throw forbidden();
    return { g, staff, leader: Boolean(row?.is_leader), member: Boolean(row) };
  }
  const manager = (a) => a.staff || a.leader;
  const chatId = (gid) => db.prepare('SELECT id FROM chats WHERE group_id = ?').get(gid)?.id ?? null;
  const getGroup = (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  // Tell a person's open pages their chat list changed.
  const nudge = (personId) => {
    const uid = db.prepare('SELECT id FROM users WHERE person_id = ? AND active = 1').get(personId)?.id;
    if (uid) send([uid], null, { type: 'chats' });
  };

  const isMember = (req, gid) => Boolean(req.user.personId && db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND person_id = ?').get(gid, req.user.personId));
  // The chat is private to members, so non-member staff aren't pointed at it.
  const summary = (g, req) => ({
    ...g,
    chat_id: isMember(req, g.id) ? chatId(g.id) : null,
    is_member: isMember(req, g.id),
    members: db.prepare('SELECT COUNT(*) n FROM group_members gm JOIN people p ON p.id = gm.person_id WHERE gm.group_id = ? AND p.archived = 0').get(g.id).n,
    leaders: db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname FROM group_members gm JOIN people p ON p.id = gm.person_id
      WHERE gm.group_id = ? AND gm.is_leader = 1 AND p.archived = 0 ORDER BY p.first_name`).all(g.id),
    my_leader: Boolean(req.user.personId && db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND person_id = ? AND is_leader = 1').get(g.id, req.user.personId)),
  });

  // Staff: every group at their campuses (?archived=1 for the archived ones). Everyone else:
  // the groups they're in.
  r.get('/groups', requireRole('volunteer'), (req, res) => {
    const archived = req.query.archived === '1' && isStaff(req) ? 1 : 0;
    let rows;
    if (isStaff(req)) {
      // Campus-limited staff don't manage church-wide groups, so those show only if they're in them.
      const ids = req.user.campusIds;
      const sql = ids ? `${ids.length ? `g.campus_id IN (${ids.map(() => '?').join(',')}) OR ` : ''}(g.campus_id IS NULL AND g.id IN (SELECT group_id FROM group_members WHERE person_id = ?))` : '1 = 1';
      rows = db.prepare(`SELECT g.* FROM groups g WHERE g.archived = ? AND (${sql}) ORDER BY g.name LIMIT 500`).all(archived, ...(ids ? [...ids, req.user.personId ?? -1] : []));
    } else {
      rows = req.user.personId ? db.prepare(`SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.person_id = ? AND g.archived = 0 ORDER BY g.name LIMIT 100`).all(req.user.personId) : [];
    }
    res.json({ can_create: isStaff(req), groups: rows.map((g) => summary(g, req)) });
  });

  r.get('/groups/:id', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    const contact = a.staff ? ', p.email, p.phone' : '';
    res.json({
      ...summary(a.g, req),
      can_manage: manager(a),
      can_staff: a.staff,
      can_contact: a.staff,
      my_person_id: req.user.personId ?? null,
      roster: db.prepare(`SELECT gm.person_id, gm.is_leader, p.first_name, p.last_name, p.nickname, p.photo${contact}
        FROM group_members gm JOIN people p ON p.id = gm.person_id WHERE gm.group_id = ? AND p.archived = 0
        ORDER BY gm.is_leader DESC, p.first_name, p.last_name LIMIT 500`).all(a.g.id),
    });
  });

  r.post('/groups', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id);
    if (!canCampus(req.user, campusId) || (campusId == null && req.user.campusIds)) throw forbidden();
    const name = required(b.name, 'Group name').slice(0, 80);
    const id = tx(db, () => {
      const gid = Number(db.prepare('INSERT INTO groups (name, description, campus_id) VALUES (?, ?, ?)').run(name, str(b.description), campusId).lastInsertRowid);
      db.prepare("INSERT INTO chats (kind, group_id, name, created_by) VALUES ('smallgroup', ?, ?, ?)").run(gid, name, req.user.id);
      return gid;
    });
    audit(db, req, 'group.create', { group_id: id, name });
    res.status(201).json(summary(getGroup(id), req));
  });

  r.patch('/groups/:id', requireRole('staff'), (req, res) => {
    const { g, staff } = open(req, req.params.id);
    if (!staff) throw forbidden();
    const b = { ...req.body };
    if (b.name !== undefined) b.name = required(b.name, 'Group name').slice(0, 80);
    if (b.description !== undefined) b.description = str(b.description);
    if (b.campus_id !== undefined) {
      b.campus_id = int(b.campus_id);
      if (!canCampus(req.user, b.campus_id) || (b.campus_id == null && req.user.campusIds)) throw forbidden();
    }
    if (b.archived !== undefined) b.archived = b.archived ? 1 : 0;
    tx(db, () => {
      updateFields(db, 'groups', g.id, b, ['name', 'description', 'campus_id', 'archived']);
      // The chat keeps a copy of the name, so task lists and call cards can show it.
      if (b.name !== undefined) db.prepare('UPDATE chats SET name = ? WHERE group_id = ?').run(b.name, g.id);
    });
    if (b.archived !== undefined && b.archived !== g.archived) audit(db, req, b.archived ? 'group.archive' : 'group.unarchive', { group_id: g.id, name: g.name });
    res.json(summary(getGroup(g.id), req));
  });

  // Who could be added: adults at the group's campus, by name. Names and photos only, so a
  // group leader (who can't open People) can still find someone to add.
  r.get('/groups/:id/candidates', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    if (!manager(a)) throw forbidden();
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < (a.staff ? 2 : 3)) return res.json([]);
    // Group leaders who aren't staff can't page through the whole directory.
    if (!a.staff && !finderLimit(req.user.id)) throw new HttpError(429, 'That’s a lot of searches. Please wait a little and try again.');
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    // A campus group draws from its own campus (and people with no campus); church-wide groups from
    // whatever the viewer can see.
    const cf = a.g.campus_id == null ? campusFilter(req.user, 'p.campus_id') : { sql: '(p.campus_id = ? OR p.campus_id IS NULL)', args: [a.g.campus_id] };
    res.json(db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo FROM people p
      WHERE p.archived = 0 AND ${ADULT_SQL} AND ${cf.sql}
        AND (p.first_name || ' ' || p.last_name LIKE ? ESCAPE '\\' OR p.nickname LIKE ? ESCAPE '\\')
        AND p.id NOT IN (SELECT person_id FROM group_members WHERE group_id = ?)
      ORDER BY p.first_name, p.last_name LIMIT 10`).all(...cf.args, like, like, a.g.id));
  });

  // Add someone (or, for staff, change whether they lead). A group leader can add people but not
  // make leaders: that stays with staff.
  r.put('/groups/:id/members/:personId', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    if (!manager(a)) throw forbidden();
    const personId = int(req.params.personId);
    const person = db.prepare('SELECT id, campus_id, household_role, grade, birthdate FROM people WHERE id = ? AND archived = 0').get(personId);
    const existing = db.prepare('SELECT is_leader FROM group_members WHERE group_id = ? AND person_id = ?').get(a.g.id, personId);
    if (!existing) {
      // Only new members are checked: someone already in the group can still step down or be made
      // a leader after their campus or household changes.
      const reachable = person && (a.g.campus_id == null ? canCampus(req.user, person.campus_id) : (person.campus_id == null || person.campus_id === a.g.campus_id));
      if (!reachable) throw notFound('Person');
      if (!isAdult(person)) throw bad('Small groups are for adults for now. Children can’t be added.');
    }
    const wantsLeader = req.body?.is_leader === undefined ? undefined : (req.body.is_leader ? 1 : 0);
    // Leaders can't make leaders; the one thing they can change is stepping down themselves.
    const steppingDown = personId === req.user.personId && existing?.is_leader === 1 && wantsLeader === 0;
    if (wantsLeader !== undefined && wantsLeader !== (existing?.is_leader ?? 0) && !a.staff && !steppingDown) throw forbidden();
    if (!existing && !a.staff) {
      const n = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'group.member_add' AND user_id = ? AND at > datetime('now', '-1 day')").get(req.user.id).n;
      if (n >= LEADER_ADDS_PER_DAY) throw new HttpError(429, 'You’ve added a lot of people today. Please try again tomorrow, or ask the church office to help.');
    }
    const leader = wantsLeader ?? existing?.is_leader ?? 0;
    db.prepare(`INSERT INTO group_members (group_id, person_id, is_leader) VALUES (?, ?, ?)
      ON CONFLICT (group_id, person_id) DO UPDATE SET is_leader = excluded.is_leader`).run(a.g.id, personId, leader);
    if (!existing) audit(db, req, 'group.member_add', { group_id: a.g.id, person_id: personId });
    if (leader !== (existing?.is_leader ?? 0)) audit(db, req, leader ? 'group.leader_add' : 'group.leader_remove', { group_id: a.g.id, person_id: personId });
    nudge(personId);
    res.json({ ok: true });
  });

  r.delete('/groups/:id/members/:personId', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    const personId = int(req.params.personId);
    const self = personId === req.user.personId;
    if (!manager(a) && !(a.member && self)) throw forbidden();
    const row = db.prepare('SELECT is_leader FROM group_members WHERE group_id = ? AND person_id = ?').get(a.g.id, personId);
    // Only staff take another leader off the roster (a leader can step down themselves).
    if (row?.is_leader && !a.staff && !self) throw forbidden();
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND person_id = ?').run(a.g.id, personId);
    if (row) audit(db, req, 'group.member_remove', { group_id: a.g.id, person_id: personId, self });
    if (row?.is_leader) audit(db, req, 'group.leader_remove', { group_id: a.g.id, person_id: personId });
    nudge(personId);
    res.json({ ok: true });
  });

  return r;
}
