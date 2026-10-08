// Services, their order of service (plan items), the song library and volunteer scheduling.
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { updateFields, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, oneOf, isDate, isDateTime, audit } from '../http.js';
import { ensureServices } from './series.js';

export default function serviceRoutes(db) {
  const r = Router();
  const getService = (id) => db.prepare('SELECT * FROM services WHERE id = ?').get(id);

  function service(req, id) {
    const s = getService(id);
    if (!s) throw notFound('Service');
    if (!canCampus(req.user, s.campus_id)) throw forbidden();
    return s;
  }

  const isStaff = (req) => rank(req.user.role) >= rank('staff');
  const isAssigned = (req, serviceId) => Boolean(req.user.personId
    && db.prepare("SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ? AND status != 'declined'").get(serviceId, req.user.personId));
  const leadsTeam = (req, teamId) => Boolean(req.user.personId
    && db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND person_id = ? AND is_leader = 1').get(teamId, req.user.personId));

  function requireEditPlan(req, s) {
    if (rank(req.user.role) < rank('leader')) throw forbidden();
    if (!canCampus(req.user, s.campus_id)) throw forbidden();
  }

  function requireSchedule(req, s, positionId) {
    if (!canCampus(req.user, s.campus_id)) throw forbidden();
    if (isStaff(req)) return;
    const pos = db.prepare('SELECT team_id FROM positions WHERE id = ?').get(positionId);
    if (!pos || !leadsTeam(req, pos.team_id)) throw forbidden();
  }

  // ---------------------------------------------------------------- services
  r.get('/services', requireRole('volunteer'), (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const to = isDate(req.query.to) ? req.query.to : new Date(Date.now() + 56 * 864e5).toISOString().slice(0, 10);
    ensureServices(db, to);
    const cf = campusFilter(req.user, 's.campus_id');
    const args = [from, `${to}T23:59`, ...cf.args];
    let extra = '';
    if (req.query.campus_id) { extra = ' AND s.campus_id = ?'; args.push(int(req.query.campus_id)); }
    // Volunteers only see the services they serve at.
    if (rank(req.user.role) < rank('leader')) { extra += ' AND s.id IN (SELECT service_id FROM assignments WHERE person_id = ?)'; args.push(req.user.personId ?? -1); }
    const rows = db.prepare(`SELECT s.*, st.name type_name, c.name campus_name, c.short_name campus_short, c.color campus_color,
        (SELECT COALESCE(SUM(count), 0) FROM service_needs n WHERE n.service_id = s.id) needed, st.every_weeks,
        (SELECT COUNT(*) FROM assignments a WHERE a.service_id = s.id AND a.status != 'declined') filled,
        (SELECT COUNT(*) FROM assignments a WHERE a.service_id = s.id AND a.status = 'accepted') accepted,
        (SELECT COUNT(*) FROM assignments a WHERE a.service_id = s.id AND a.status = 'declined') declined
      FROM services s JOIN campuses c ON c.id = s.campus_id LEFT JOIN service_types st ON st.id = s.service_type_id
      WHERE s.starts_at >= ? AND s.starts_at <= ? AND ${cf.sql}${extra} ORDER BY s.starts_at, c.sort`).all(...args);
    res.json(rows);
  });

  // A one-off service or event. Repeating services are created through /series.
  r.post('/services', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id);
    if (!campusId || !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId)) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    if (!isDateTime(b.starts_at)) throw bad('Pick a date and time.');
    const id = tx(db, () => {
      const info = db.prepare('INSERT INTO services (campus_id, title, series, starts_at, duration_min, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(campusId, str(b.title, 200), str(b.series, 200), b.starts_at, int(b.duration_min) ?? 75, str(b.notes));
      saveNeeds(info.lastInsertRowid, b.needs);
      return info.lastInsertRowid;
    });
    res.status(201).json(getService(id));
  });

  function saveNeeds(serviceId, needs) {
    if (!Array.isArray(needs)) return;
    db.prepare('DELETE FROM service_needs WHERE service_id = ?').run(serviceId);
    const ins = db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, ?)');
    for (const n of needs) {
      const count = Math.min(int(n.count) ?? 1, 50);
      if (count > 0) ins.run(serviceId, int(n.position_id, 'Position'), count);
    }
  }

  // Positions needed for just this service.
  r.put('/services/:id/needs', requireRole('staff'), (req, res) => {
    const s = service(req, req.params.id);
    tx(db, () => saveNeeds(s.id, req.body?.needs || []));
    res.json({ ok: true });
  });

  r.get('/services/:id', requireRole('volunteer'), (req, res) => {
    const s = service(req, req.params.id);
    if (rank(req.user.role) < rank('leader') && !isAssigned(req, s.id)) throw forbidden();
    const campus = db.prepare('SELECT * FROM campuses WHERE id = ?').get(s.campus_id);
    const type = s.service_type_id ? db.prepare('SELECT * FROM service_types WHERE id = ?').get(s.service_type_id) : null;
    const assignments = db.prepare(`SELECT a.*, p.first_name, p.last_name, p.nickname, p.photo, p.phone, p.email
      FROM assignments a JOIN people p ON p.id = a.person_id WHERE a.service_id = ? ORDER BY a.created_at`).all(s.id);
    const needs = db.prepare('SELECT position_id, count FROM service_needs WHERE service_id = ?').all(s.id);
    // Positions shown = this service's needs plus anything someone was scheduled into ad hoc.
    const posIds = new Set([...needs.map((n) => n.position_id), ...assignments.map((a) => a.position_id)]);
    const positions = posIds.size
      ? db.prepare(`SELECT ps.id, ps.name, ps.team_id, t.name team_name, t.color team_color FROM positions ps JOIN teams t ON t.id = ps.team_id
          WHERE ps.id IN (${[...posIds].map(() => '?').join(',')}) ORDER BY t.name, ps.sort`).all(...posIds)
      : [];
    res.json({
      ...s,
      campus,
      type,
      can_edit_plan: rank(req.user.role) >= rank('leader'),
      can_schedule: isStaff(req) ? 'all' : rank(req.user.role) >= rank('leader') ? 'own-teams' : 'none',
      items: planItems(s.id),
      positions: positions.map((p) => ({
        ...p,
        needed: needs.find((n) => n.position_id === p.id)?.count ?? 0,
        can_schedule: isStaff(req) || leadsTeam(req, p.team_id),
        assignments: assignments.filter((a) => a.position_id === p.id),
      })),
      headcounts: db.prepare('SELECT area, count FROM headcounts WHERE service_id = ?').all(s.id),
    });
  });

  r.patch('/services/:id', requireRole('staff'), (req, res) => {
    const s = service(req, req.params.id);
    const b = { ...req.body };
    if (b.starts_at !== undefined && !isDateTime(b.starts_at)) throw bad('Pick a date and time.');
    for (const k of ['title', 'series', 'notes']) if (b[k] !== undefined) b[k] = str(b[k]);
    tx(db, () => {
      // Moving one service of a series to another day: skip its old day so it isn't recreated.
      if (s.service_type_id && b.starts_at && b.starts_at.slice(0, 10) !== s.starts_at.slice(0, 10)) {
        db.prepare('INSERT OR IGNORE INTO service_skips (service_type_id, day) VALUES (?, ?)').run(s.service_type_id, s.starts_at.slice(0, 10));
      }
      updateFields(db, 'services', s.id, b, ['title', 'series', 'notes', 'starts_at', 'duration_min']);
    });
    res.json(getService(s.id));
  });

  r.delete('/services/:id', requireRole('staff'), (req, res) => {
    const s = service(req, req.params.id);
    tx(db, () => {
      // Remember the skipped date so the series doesn't create this service again.
      if (s.service_type_id) db.prepare('INSERT OR IGNORE INTO service_skips (service_type_id, day) VALUES (?, ?)').run(s.service_type_id, s.starts_at.slice(0, 10));
      db.prepare('DELETE FROM services WHERE id = ?').run(s.id);
    });
    audit(db, req, 'service.delete', `${s.id} ${s.starts_at}`);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- plan items
  function planItems(serviceId) {
    return db.prepare(`SELECT i.*, so.title song_title, so.author song_author, so.ccli, p.first_name, p.last_name, p.nickname
      FROM plan_items i LEFT JOIN songs so ON so.id = i.song_id LEFT JOIN people p ON p.id = i.person_id
      WHERE i.service_id = ? ORDER BY i.sort, i.id`).all(serviceId);
  }

  function itemFields(b) {
    const out = {};
    if (b.kind !== undefined) out.kind = oneOf(b.kind, ['header', 'song', 'item'], 'item');
    for (const k of ['title', 'song_key', 'notes']) if (b[k] !== undefined) out[k] = str(b[k]);
    if (b.song_id !== undefined) out.song_id = int(b.song_id);
    if (b.person_id !== undefined) out.person_id = int(b.person_id);
    if (b.length_sec !== undefined) out.length_sec = Math.max(0, int(b.length_sec) ?? 0);
    return out;
  }

  r.post('/services/:id/items', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    requireEditPlan(req, s);
    const f = itemFields(req.body || {});
    if (f.song_id && !f.title) f.title = db.prepare('SELECT title FROM songs WHERE id = ?').get(f.song_id)?.title ?? '';
    if (f.song_id && !f.song_key) f.song_key = db.prepare('SELECT default_key FROM songs WHERE id = ?').get(f.song_id)?.default_key ?? '';
    f.sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM plan_items WHERE service_id = ?').get(s.id).m) + 1;
    const keys = Object.keys(f);
    db.prepare(`INSERT INTO plan_items (service_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(s.id, ...Object.values(f));
    res.status(201).json(planItems(s.id));
  });

  r.patch('/items/:id', requireRole('leader'), (req, res) => {
    const item = db.prepare('SELECT * FROM plan_items WHERE id = ?').get(req.params.id);
    if (!item) throw notFound('Item');
    requireEditPlan(req, service(req, item.service_id));
    const f = itemFields(req.body || {});
    updateFields(db, 'plan_items', item.id, f, Object.keys(f));
    res.json(planItems(item.service_id));
  });

  r.delete('/items/:id', requireRole('leader'), (req, res) => {
    const item = db.prepare('SELECT * FROM plan_items WHERE id = ?').get(req.params.id);
    if (!item) throw notFound('Item');
    requireEditPlan(req, service(req, item.service_id));
    db.prepare('DELETE FROM plan_items WHERE id = ?').run(item.id);
    res.json(planItems(item.service_id));
  });

  r.put('/services/:id/items/order', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    requireEditPlan(req, s);
    const upd = db.prepare('UPDATE plan_items SET sort = ? WHERE id = ? AND service_id = ?');
    tx(db, () => (req.body?.ids || []).forEach((id, i) => upd.run(i, int(id), s.id)));
    res.json(planItems(s.id));
  });

  // Copies another service's order of service (e.g. 9:00 → 11:00, or last week's as a template).
  r.post('/services/:id/copy-plan', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    requireEditPlan(req, s);
    const from = service(req, int(req.body?.from_service_id, 'Service'));
    tx(db, () => {
      if (req.body?.replace) db.prepare('DELETE FROM plan_items WHERE service_id = ?').run(s.id);
      const base = db.prepare('SELECT COALESCE(MAX(sort), -1) m FROM plan_items WHERE service_id = ?').get(s.id).m + 1;
      db.prepare(`INSERT INTO plan_items (service_id, sort, kind, title, song_id, song_key, length_sec, person_id, notes)
        SELECT ?, sort + ?, kind, title, song_id, song_key, length_sec, person_id, notes FROM plan_items WHERE service_id = ? ORDER BY sort`).run(s.id, base, from.id);
    });
    res.json(planItems(s.id));
  });

  // ---------------------------------------------------------------- songs
  r.get('/songs', requireRole('volunteer'), (req, res) => {
    const q = `%${str(req.query.q, 100).toLowerCase()}%`;
    res.json(db.prepare(`SELECT so.*, (SELECT MAX(s.starts_at) FROM plan_items i JOIN services s ON s.id = i.service_id WHERE i.song_id = so.id AND s.starts_at <= datetime('now')) last_used,
        (SELECT COUNT(*) FROM plan_items i JOIN services s ON s.id = i.service_id WHERE i.song_id = so.id AND s.starts_at >= date('now', '-1 year')) uses_year
      FROM songs so WHERE so.archived = 0 AND (lower(so.title) LIKE ? OR lower(so.author) LIKE ?) ORDER BY so.title COLLATE NOCASE`).all(q, q));
  });

  const songFields = (b) => {
    const out = {};
    for (const k of ['title', 'author', 'ccli', 'default_key', 'notes']) if (b[k] !== undefined) out[k] = str(b[k], 500);
    if (b.bpm !== undefined) out.bpm = int(b.bpm, 'BPM');
    if (b.archived !== undefined) out.archived = b.archived ? 1 : 0;
    return out;
  };

  r.post('/songs', requireRole('leader'), (req, res) => {
    const f = songFields(req.body || {});
    if (!f.title) throw bad('Song title is required.');
    const keys = Object.keys(f);
    const info = db.prepare(`INSERT INTO songs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(f));
    res.status(201).json(db.prepare('SELECT * FROM songs WHERE id = ?').get(info.lastInsertRowid));
  });

  r.patch('/songs/:id', requireRole('leader'), (req, res) => {
    const f = songFields(req.body || {});
    if (f.title === '') throw bad('Song title is required.');
    updateFields(db, 'songs', int(req.params.id), f, Object.keys(f));
    res.json(db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id));
  });

  // ---------------------------------------------------------------- scheduling
  // Why someone can't (or shouldn't) serve at this service. Conflicts are checked across all campuses.
  function conflictsFor(personId, s, positionId) {
    const out = [];
    const day = s.starts_at.slice(0, 10);
    const bo = db.prepare('SELECT reason FROM blockouts WHERE person_id = ? AND start_date <= ? AND end_date >= ?').get(personId, day, day);
    if (bo) out.push({ level: 'block', text: `Away${bo.reason ? `: ${bo.reason}` : ''}` });
    const end = addMinutes(s.starts_at, s.duration_min);
    const overlap = db.prepare(`SELECT s.starts_at, s.duration_min dur, c.short_name, c.name, ps.name position FROM assignments a
      JOIN services s ON s.id = a.service_id JOIN campuses c ON c.id = s.campus_id JOIN positions ps ON ps.id = a.position_id
      WHERE a.person_id = ? AND a.status != 'declined' AND s.id != ? AND s.starts_at < ? AND s.starts_at > ?`)
      .all(personId, s.id, end, addMinutes(s.starts_at, -24 * 60))
      .find((o) => addMinutes(o.starts_at, o.dur) > s.starts_at);
    if (overlap) out.push({ level: 'block', text: `Already serving ${overlap.position} at ${overlap.short_name || overlap.name} ${overlap.starts_at.slice(11)}` });
    const same = db.prepare(`SELECT ps.name FROM assignments a JOIN positions ps ON ps.id = a.position_id
      WHERE a.person_id = ? AND a.service_id = ? AND a.position_id != ? AND a.status != 'declined'`).get(personId, s.id, positionId ?? -1);
    if (same) out.push({ level: 'warn', text: `Also on ${same.name} this service` });
    const declined = db.prepare("SELECT 1 FROM assignments WHERE person_id = ? AND service_id = ? AND status = 'declined'").get(personId, s.id);
    if (declined) out.push({ level: 'warn', text: 'Declined this service' });
    return out;
  }

  // People who could fill a position, best choices first. recent_count = days they serve in the
  // four weeks either side, so the load is shared fairly.
  r.get('/services/:id/candidates', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    const positionId = int(req.query.position_id, 'Position');
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    if (!pos) throw notFound('Position');
    res.json(candidates(s, pos));
  });

  function candidates(s, pos) {
    const rows = db.prepare(`SELECT DISTINCT p.id, p.first_name, p.last_name, p.nickname, p.photo, p.campus_id,
        MAX(tm.position_id = ?) plays_position,
        (SELECT MAX(s2.starts_at) FROM assignments a JOIN services s2 ON s2.id = a.service_id WHERE a.person_id = p.id AND a.status != 'declined' AND s2.starts_at < ?) last_served,
        (SELECT COUNT(DISTINCT substr(s2.starts_at, 1, 10)) FROM assignments a JOIN services s2 ON s2.id = a.service_id
          WHERE a.person_id = p.id AND a.status != 'declined' AND s2.id != ? AND s2.starts_at >= date(?, '-28 days') AND s2.starts_at < date(?, '+28 days')) recent_count
      FROM team_members tm JOIN people p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND p.archived = 0 GROUP BY p.id`).all(pos.id, s.starts_at, s.id, s.starts_at, s.starts_at, pos.team_id);
    return rows
      .map((p) => ({ ...p, plays_position: Boolean(p.plays_position), conflicts: conflictsFor(p.id, s, pos.id) }))
      .sort((a, b) => (a.conflicts.some((c) => c.level === 'block') - b.conflicts.some((c) => c.level === 'block'))
        || (b.plays_position - a.plays_position)
        || (a.recent_count - b.recent_count)
        || String(a.last_served || '').localeCompare(String(b.last_served || '')));
  }

  r.post('/services/:id/assignments', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    const positionId = int(req.body?.position_id, 'Position');
    const personId = int(req.body?.person_id, 'Person');
    requireSchedule(req, s, positionId);
    if (!db.prepare('SELECT 1 FROM people WHERE id = ? AND archived = 0').get(personId)) throw notFound('Person');
    const conflicts = conflictsFor(personId, s, positionId);
    if (conflicts.some((c) => c.level === 'block') && !req.body?.force) {
      return res.status(409).json({ error: conflicts.filter((c) => c.level === 'block').map((c) => c.text).join('; '), conflicts });
    }
    db.prepare(`INSERT INTO assignments (service_id, position_id, person_id, status) VALUES (?, ?, ?, ?)
      ON CONFLICT(service_id, position_id, person_id) DO UPDATE SET status = excluded.status, responded_at = NULL, decline_reason = ''`)
      .run(s.id, positionId, personId, req.body?.status === 'accepted' ? 'accepted' : 'pending');
    res.status(201).json({ ok: true, conflicts });
  });

  // Fills open spots with the best available people (no blockouts or double-booking).
  r.post('/services/:id/autofill', requireRole('leader'), (req, res) => {
    const s = service(req, req.params.id);
    const needs = db.prepare('SELECT position_id, count FROM service_needs WHERE service_id = ?').all(s.id);
    const added = [];
    tx(db, () => {
      for (const n of needs) {
        try { requireSchedule(req, s, n.position_id); } catch { continue; }
        const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(n.position_id);
        let filled = db.prepare("SELECT COUNT(*) n FROM assignments WHERE service_id = ? AND position_id = ? AND status != 'declined'").get(s.id, pos.id).n;
        for (const c of candidates(s, pos)) {
          if (filled >= n.count) break;
          if (!c.plays_position || c.conflicts.length) continue;
          db.prepare("INSERT OR IGNORE INTO assignments (service_id, position_id, person_id) VALUES (?, ?, ?)").run(s.id, pos.id, c.id);
          added.push({ position: pos.name, person: `${c.nickname || c.first_name} ${c.last_name}` });
          filled++;
        }
      }
    });
    res.json({ added });
  });

  r.patch('/assignments/:id', requireRole('volunteer'), (req, res) => {
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!a) throw notFound('Assignment');
    const s = service(req, a.service_id);
    if (a.person_id !== req.user.personId) requireSchedule(req, s, a.position_id);
    const status = oneOf(req.body?.status, ['pending', 'accepted', 'declined'], null);
    if (!status) throw bad('Status must be accepted, declined or pending.');
    db.prepare("UPDATE assignments SET status = ?, decline_reason = ?, responded_at = datetime('now') WHERE id = ?")
      .run(status, status === 'declined' ? str(req.body?.reason, 300) : '', a.id);
    res.json({ ok: true });
  });

  r.delete('/assignments/:id', requireRole('leader'), (req, res) => {
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!a) throw notFound('Assignment');
    requireSchedule(req, service(req, a.service_id), a.position_id);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the signed-in person's own schedule
  r.get('/my/schedule', requireRole('volunteer'), (req, res) => {
    const pid = req.user.personId;
    if (!pid) return res.json({ linked: false, assignments: [], blockouts: [], teams: [] });
    res.json({
      linked: true,
      assignments: db.prepare(`SELECT a.id, a.status, a.decline_reason, s.id service_id, s.starts_at, s.title, s.series,
          ps.name position, t.name team, t.color team_color, c.name campus, c.short_name campus_short, c.address
        FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id
        JOIN teams t ON t.id = ps.team_id JOIN campuses c ON c.id = s.campus_id
        WHERE a.person_id = ? AND s.starts_at >= date('now', '-1 day') ORDER BY s.starts_at`).all(pid),
      blockouts: db.prepare("SELECT * FROM blockouts WHERE person_id = ? AND end_date >= date('now') ORDER BY start_date").all(pid),
      teams: db.prepare(`SELECT t.name, t.color, tm.is_leader, ps.name position FROM team_members tm JOIN teams t ON t.id = tm.team_id
        LEFT JOIN positions ps ON ps.id = tm.position_id WHERE tm.person_id = ? ORDER BY t.name`).all(pid),
    });
  });

  return r;
}

export function addMinutes(localDateTime, minutes) {
  const d = new Date(`${localDateTime}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}
