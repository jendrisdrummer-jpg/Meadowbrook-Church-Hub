// Ministry teams (Worship, Production, Kids, Hospitality…), their positions and members.
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, audit } from '../http.js';

export default function teamRoutes(db) {
  const r = Router();
  const getTeam = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);

  function team(req, id) {
    const t = getTeam(id);
    if (!t) throw notFound('Team');
    if (!canCampus(req.user, t.campus_id)) throw forbidden();
    return t;
  }

  // Staff manage any team at their campuses; a leader only teams they lead.
  function canManage(req, t) {
    if (rank(req.user.role) >= rank('staff')) return true;
    return Boolean(req.user.personId && db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND person_id = ? AND is_leader = 1').get(t.id, req.user.personId));
  }

  r.get('/teams', requireRole('volunteer'), (req, res) => {
    const cf = campusFilter(req.user, 't.campus_id');
    const teams = db.prepare(`SELECT t.*, (SELECT COUNT(DISTINCT person_id) FROM team_members m WHERE m.team_id = t.id) members
      FROM teams t WHERE t.archived = 0 AND ${cf.sql} ORDER BY t.name`).all(...cf.args);
    const positions = db.prepare('SELECT * FROM positions ORDER BY sort, name').all();
    res.json(teams.map((t) => ({ ...t, positions: positions.filter((p) => p.team_id === t.id) })));
  });

  r.get('/teams/:id', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    res.json({
      ...t,
      can_manage: canManage(req, t),
      positions: db.prepare('SELECT * FROM positions WHERE team_id = ? ORDER BY sort, name').all(t.id),
      members: db.prepare(`SELECT tm.person_id, tm.position_id, tm.is_leader, p.first_name, p.last_name, p.nickname, p.photo, p.email, p.phone
        FROM team_members tm JOIN people p ON p.id = tm.person_id WHERE tm.team_id = ? AND p.archived = 0
        ORDER BY tm.is_leader DESC, p.last_name, p.first_name`).all(t.id),
    });
  });

  r.post('/teams', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id);
    if (!canCampus(req.user, campusId) || (campusId == null && req.user.campusIds)) throw forbidden();
    const id = tx(db, () => {
      const info = db.prepare('INSERT INTO teams (name, campus_id, color, description) VALUES (?, ?, ?, ?)')
        .run(required(b.name, 'Team name'), campusId, /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#4f6bed', str(b.description));
      const ins = db.prepare('INSERT INTO positions (team_id, name, sort) VALUES (?, ?, ?)');
      (Array.isArray(b.positions) ? b.positions : []).map((n) => str(n, 80)).filter(Boolean).forEach((n, i) => ins.run(info.lastInsertRowid, n, i));
      return info.lastInsertRowid;
    });
    audit(db, req, 'team.create', b.name);
    res.status(201).json(getTeam(id));
  });

  r.patch('/teams/:id', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    const b = { ...req.body };
    if (b.name !== undefined) b.name = required(b.name, 'Team name');
    if (b.campus_id !== undefined) {
      if (rank(req.user.role) < rank('staff')) throw forbidden();
      b.campus_id = int(b.campus_id);
      if (!canCampus(req.user, b.campus_id)) throw forbidden();
    }
    updateFields(db, 'teams', t.id, b, ['name', 'campus_id', 'color', 'description', 'archived']);
    res.json(getTeam(t.id));
  });

  r.post('/teams/:id/positions', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    const max = db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM positions WHERE team_id = ?').get(t.id).m;
    const info = db.prepare('INSERT INTO positions (team_id, name, sort) VALUES (?, ?, ?)').run(t.id, required(req.body?.name, 'Position name'), max + 1);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/teams/:id/positions/order', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    const upd = db.prepare('UPDATE positions SET sort = ? WHERE id = ? AND team_id = ?');
    tx(db, () => (req.body?.ids || []).forEach((id, i) => upd.run(i, int(id), t.id)));
    res.json({ ok: true });
  });

  r.patch('/positions/:id', requireRole('leader'), (req, res) => {
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(req.params.id);
    if (!pos) throw notFound('Position');
    if (!canManage(req, team(req, pos.team_id))) throw forbidden();
    updateFields(db, 'positions', pos.id, { name: req.body?.name !== undefined ? required(req.body.name, 'Position name') : undefined, sort: req.body?.sort }, ['name', 'sort']);
    res.json({ ok: true });
  });

  r.delete('/positions/:id', requireRole('leader'), (req, res) => {
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(req.params.id);
    if (!pos) throw notFound('Position');
    if (!canManage(req, team(req, pos.team_id))) throw forbidden();
    const upcoming = db.prepare("SELECT COUNT(*) n FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.position_id = ? AND s.starts_at >= date('now')").get(pos.id).n;
    if (upcoming && !req.body?.force) throw bad(`${upcoming} upcoming assignment(s) use this position. Remove them first.`);
    db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id);
    res.json({ ok: true });
  });

  // Body: { person_id, position_ids: [..], is_leader } – replaces that person's positions on the team.
  r.put('/teams/:id/members/:personId', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    const personId = int(req.params.personId);
    const person = db.prepare('SELECT id, campus_id FROM people WHERE id = ? AND archived = 0').get(personId);
    if (!person) throw notFound('Person');
    const valid = new Set(db.prepare('SELECT id FROM positions WHERE team_id = ?').all(t.id).map((p) => p.id));
    const positionIds = (req.body?.position_ids || []).map((x) => int(x)).filter((x) => valid.has(x));
    const leader = req.body?.is_leader ? 1 : 0;
    if (leader && rank(req.user.role) < rank('staff')) throw forbidden();
    tx(db, () => {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').run(t.id, personId);
      const ins = db.prepare('INSERT INTO team_members (team_id, person_id, position_id, is_leader) VALUES (?, ?, ?, ?)');
      if (!positionIds.length) ins.run(t.id, personId, null, leader);
      for (const pid of positionIds) ins.run(t.id, personId, pid, leader);
      syncLeaderAccess(personId);
    });
    res.json({ ok: true });
  });

  // Leading a team gives leader access (so they can schedule it); it's taken back when they
  // lead no team any more, but only if it came from here. Access set by hand never changes.
  function syncLeaderAccess(personId) {
    const leads = db.prepare('SELECT 1 FROM team_members WHERE person_id = ? AND is_leader = 1').get(personId);
    const user = db.prepare('SELECT * FROM users WHERE person_id = ?').get(personId);
    if (leads) {
      if (user?.role === 'volunteer') db.prepare("UPDATE users SET role = 'leader', role_auto = 1 WHERE id = ?").run(user.id);
      if (!user) {
        const email = db.prepare('SELECT lower(email) e FROM people WHERE id = ?').get(personId)?.e;
        if (email && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
          db.prepare("INSERT INTO users (email, role, person_id, role_auto) VALUES (?, 'leader', ?, 1)").run(email, personId);
        }
      }
    } else if (user?.role_auto && user.role === 'leader') {
      db.prepare("UPDATE users SET role = 'volunteer', role_auto = 0 WHERE id = ?").run(user.id);
    }
  }

  r.delete('/teams/:id/members/:personId', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').run(t.id, int(req.params.personId));
    syncLeaderAccess(int(req.params.personId));
    res.json({ ok: true });
  });

  return r;
}
