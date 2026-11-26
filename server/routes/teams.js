// Ministry teams (Worship, Production, Kids, Hospitality…), their positions and members.
import { unreachableReasons } from '../notify.js';
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, audit, localNow } from '../http.js';
import { seesTeamDetail } from '../team-scope.js';
import { revokeCheckin } from './checkin.js';
import { closeStreams } from '../live.js';

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
    const base = teams.map((t) => ({ ...t, positions: positions.filter((p) => p.team_id === t.id) }));
    // Volunteers get the plain list. Leaders and up also get who leads each team, which teams are
    // theirs, and the open spots at the next service (only for teams they may see in detail).
    if (rank(req.user.role) < rank('leader')) return res.json(base);
    const leaders = new Map();
    for (const l of db.prepare(`SELECT tm.team_id, tm.person_id, p.first_name, p.last_name, p.nickname FROM team_members tm
        JOIN people p ON p.id = tm.person_id WHERE tm.is_leader = 1 AND p.archived = 0 GROUP BY tm.team_id, tm.person_id ORDER BY p.last_name, p.first_name`).all()) {
      leaders.set(l.team_id, [...(leaders.get(l.team_id) || []), l]);
    }
    const soon = upcomingServices(req.user);
    const need = db.prepare('SELECT COALESCE(SUM(n.count), 0) n FROM service_needs n JOIN positions ps ON ps.id = n.position_id WHERE n.service_id = ? AND ps.team_id = ?');
    // Open spots add up per position, so an over-filled position never cancels out another one's gap.
    const open = db.prepare(`SELECT COALESCE(SUM(MAX(0, n.count - (SELECT COUNT(*) FROM assignments a WHERE a.service_id = n.service_id AND a.position_id = n.position_id AND a.status != 'declined'))), 0) n
      FROM service_needs n JOIN positions ps ON ps.id = n.position_id WHERE n.service_id = ? AND ps.team_id = ?`);
    res.json(base.map((t) => {
      const lead = leaders.get(t.id) || [];
      const next = soon.find((x) => t.campus_id == null || x.campus_id === t.campus_id);
      let open_next = null;
      if (next && seesTeamDetail(db, req.user, t.id)) {
        const needed = need.get(next.id, t.id).n;
        open_next = { service_id: next.id, starts_at: next.starts_at, needed, open: open.get(next.id, t.id).n };
      }
      return {
        ...t,
        leader_names: lead.map((l) => `${l.nickname || l.first_name} ${l.last_name}`.trim()),
        mine: Boolean(req.user.personId && lead.some((l) => l.person_id === req.user.personId)),
        open_next,
      };
    }));
  });

  // Services from now to 7 days out at the campuses this person can see, earliest first. "Now" is
  // each campus's own clock.
  function upcomingServices(user) {
    const cf = campusFilter(user, 's.campus_id');
    const addDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
    return db.prepare(`SELECT s.id, s.starts_at, s.campus_id, c.timezone FROM services s JOIN campuses c ON c.id = s.campus_id
      WHERE s.starts_at >= date('now', '-1 day') AND s.starts_at < date('now', '+9 days') AND ${cf.sql} ORDER BY s.starts_at`).all(...cf.args)
      .filter((s) => {
        let now;
        try { now = localNow(s.timezone || 'UTC'); } catch { now = localNow('UTC'); }
        return s.starts_at >= `${now.date}T${now.time}` && s.starts_at.slice(0, 10) <= addDay(now.date, 7);
      });
  }

  r.get('/teams/:id', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    // Contact details only for teams this person leads (staff see all); others get names and photos.
    const detail = seesTeamDetail(db, req.user, t.id);
    const unreachable = detail ? unreachableReasons(db, db.prepare('SELECT person_id FROM team_members WHERE team_id = ?').all(t.id).map((x) => x.person_id)) : new Map();
    res.json({
      ...t,
      can_manage: canManage(req, t),
      positions: db.prepare('SELECT * FROM positions WHERE team_id = ? ORDER BY sort, name').all(t.id),
      // has_account is only yes or no (whether they can sign in), never who or how. reachable (an
      // email or an account, so a request can arrive) is only for people who see the team's contact details.
      members: db.prepare(`SELECT tm.person_id, tm.position_id, tm.is_leader, p.first_name, p.last_name, p.nickname, p.photo, p.email, p.phone,
          EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id AND u.active = 1) has_account
        FROM team_members tm JOIN people p ON p.id = tm.person_id WHERE tm.team_id = ? AND p.archived = 0
        ORDER BY tm.is_leader DESC, p.last_name, p.first_name`).all(t.id).map(({ email, phone, ...m }) => ({ ...m, ...(detail ? { email, phone, reachable: !unreachable.has(m.person_id), unreachable_reason: unreachable.get(m.person_id) || null } : {}), has_account: Boolean(m.has_account) })),
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
    const name = required(req.body?.name, 'Position name');
    if (db.prepare('SELECT 1 FROM positions WHERE team_id = ? AND lower(name) = lower(?)').get(t.id, name)) throw bad(`${t.name} already has a “${name}” position.`);
    const max = db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM positions WHERE team_id = ?').get(t.id).m;
    const info = db.prepare('INSERT INTO positions (team_id, name, sort) VALUES (?, ?, ?)').run(t.id, name, max + 1);
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
    if (req.body?.name !== undefined && db.prepare('SELECT 1 FROM positions WHERE team_id = ? AND id != ? AND lower(name) = lower(?)').get(pos.team_id, pos.id, String(req.body.name).trim())) {
      throw bad(`There’s already a “${String(req.body.name).trim()}” position on this team.`);
    }
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
    // A campus-limited leader can't add someone from a campus they can't reach. No campus is fine.
    if (person.campus_id != null && !canCampus(req.user, person.campus_id)) throw forbidden();
    const valid = new Set(db.prepare('SELECT id FROM positions WHERE team_id = ?').all(t.id).map((p) => p.id));
    const positionIds = (req.body?.position_ids || []).map((x) => int(x)).filter((x) => valid.has(x));
    const leader = req.body?.is_leader ? 1 : 0;
    if (leader && rank(req.user.role) < rank('staff')) throw forbidden();
    tx(db, () => {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').run(t.id, personId);
      const ins = db.prepare('INSERT INTO team_members (team_id, person_id, position_id, is_leader) VALUES (?, ?, ?, ?)');
      if (!positionIds.length) ins.run(t.id, personId, null, leader);
      for (const pid of positionIds) ins.run(t.id, personId, pid, leader);
      syncLeaderAccess(personId, req);
    });
    res.json({ ok: true });
  });

  const syncLeaderAccess = (personId, req) => syncLeaderAccessFor(db, personId, req);

  r.delete('/teams/:id/members/:personId', requireRole('leader'), (req, res) => {
    const t = team(req, req.params.id);
    if (!canManage(req, t)) throw forbidden();
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').run(t.id, int(req.params.personId));
    syncLeaderAccess(int(req.params.personId), req);
    res.json({ ok: true });
  });

  return r;
}

// Leading a team gives leader access (so they can schedule it); it's taken back when they
// lead no team any more, but only if it came from here. Access set by hand never changes.
export function syncLeaderAccessFor(db, personId, req) {
  const leads = db.prepare('SELECT 1 FROM team_members WHERE person_id = ? AND is_leader = 1').get(personId);
  // Normally one account per person; while old duplicates remain, each is treated the same way.
  const personCampus = db.prepare('SELECT campus_id FROM people WHERE id = ?').get(personId)?.campus_id ?? null;
  for (const user of db.prepare('SELECT * FROM users WHERE person_id = ?').all(personId)) syncOne(db, user, personId, leads, req, personCampus);
}

function syncOne(db, user, personId, leads, req, personCampus) {
  if (leads) {
    if (user.role === 'volunteer') {
      db.prepare("UPDATE users SET role = 'leader', role_auto = 1 WHERE id = ?").run(user.id);
      // A campus-limited actor (admin, staff or leader) must never hand out wider access than their own. A
      // volunteer with no campus list means "every campus", so a leader made by them gets the person's
      // campus (or, for someone with no campus, the actor's campuses). An existing list that reaches beyond
      // the actor's campuses is narrowed the same way, so a leader is never made for a campus the actor
      // doesn't cover. (When an unrestricted actor does this, nothing changes: older behaviour, noted in
      // docs/permissions.md.)
      const actor = req?.user?.campusIds;
      const current = user.campus_ids == null ? null : JSON.parse(user.campus_ids);
      let narrowed = {};
      if (actor && (current == null || !current.every((c) => actor.includes(Number(c))))) {
        const ids = personCampus != null && actor.includes(Number(personCampus)) ? [Number(personCampus)] : actor;
        db.prepare('UPDATE users SET campus_ids = ? WHERE id = ?').run(JSON.stringify(ids), user.id);
        narrowed = { campus_ids_before: current, campus_ids_after: ids };
      }
      closeStreams({ userId: user.id });
      audit(db, req, 'user.leader_auto', { user_id: user.id, person_id: personId, granted: true, ...narrowed });
    }
    // No account yet: nothing is created here. People get an account by signing in, and an admin
    // links it to them by hand (we never connect an account to a person by matching email).
  } else if (user.role_auto && user.role === 'leader') {
    db.prepare("UPDATE users SET role = 'volunteer', role_auto = 0 WHERE id = ?").run(user.id);
    revokeCheckin(db, user.id);
    closeStreams({ userId: user.id });
    audit(db, req, 'user.leader_auto', { user_id: user.id, person_id: personId, granted: false });
  }
}
