// Small groups (Bible study, home groups…). A separate model from serving teams: a group never
// grants leader access and never appears in scheduling. Staff manage groups at their campuses;
// a group's own leaders manage its roster. Members see names and photos; leaders and staff also
// see members' email and phone. Each group has a chat that follows its roster (see chat.js).
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { notFound, forbidden, bad, int, str, required, audit } from '../http.js';
import { send } from '../live.js';

export default function groupRoutes(db) {
  const r = Router();
  const isStaff = (req) => rank(req.user.role) >= rank('staff');

  // Loads a group and what this account may do with it, or refuses. Archived groups are only
  // for staff (to bring back); everyone else gets "not found".
  function open(req, id) {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(int(id, 'group'));
    if (!g) throw notFound('Group');
    const staff = isStaff(req) && canCampus(req.user, g.campus_id);
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

  const summary = (g, req) => ({
    ...g,
    chat_id: chatId(g.id),
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
      const cf = campusFilter(req.user, 'g.campus_id');
      rows = db.prepare(`SELECT g.* FROM groups g WHERE g.archived = ? AND ${cf.sql} ORDER BY g.name LIMIT 500`).all(archived, ...cf.args);
    } else {
      rows = req.user.personId ? db.prepare(`SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.person_id = ? AND g.archived = 0 ORDER BY g.name LIMIT 100`).all(req.user.personId) : [];
    }
    res.json({ can_create: isStaff(req), groups: rows.map((g) => summary(g, req)) });
  });

  r.get('/groups/:id', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    const contact = manager(a) ? ', p.email, p.phone' : '';
    res.json({
      ...summary(a.g, req),
      can_manage: manager(a),
      can_staff: a.staff,
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

  // Who could be added: adults at the viewer's campuses, by name. Names and photos only, so a
  // group leader (who can't open People) can still find someone to add.
  r.get('/groups/:id/candidates', requireRole('volunteer'), (req, res) => {
    const a = open(req, req.params.id);
    if (!manager(a)) throw forbidden();
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const cf = campusFilter(req.user, 'p.campus_id');
    res.json(db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo FROM people p
      WHERE p.archived = 0 AND p.household_role != 'child' AND ${cf.sql}
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
    const person = db.prepare('SELECT id, campus_id, household_role FROM people WHERE id = ? AND archived = 0').get(personId);
    if (!person || !canCampus(req.user, person.campus_id)) throw notFound('Person');
    if (person.household_role === 'child') throw bad('Small groups are for adults for now. Children can’t be added.');
    const existing = db.prepare('SELECT is_leader FROM group_members WHERE group_id = ? AND person_id = ?').get(a.g.id, personId);
    const wantsLeader = req.body?.is_leader === undefined ? undefined : (req.body.is_leader ? 1 : 0);
    if (wantsLeader !== undefined && wantsLeader !== (existing?.is_leader ?? 0) && !a.staff) throw forbidden();
    const leader = wantsLeader ?? existing?.is_leader ?? 0;
    db.prepare(`INSERT INTO group_members (group_id, person_id, is_leader) VALUES (?, ?, ?)
      ON CONFLICT (group_id, person_id) DO UPDATE SET is_leader = excluded.is_leader`).run(a.g.id, personId, leader);
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
    if (row?.is_leader) audit(db, req, 'group.leader_remove', { group_id: a.g.id, person_id: personId });
    nudge(personId);
    res.json({ ok: true });
  });

  return r;
}
