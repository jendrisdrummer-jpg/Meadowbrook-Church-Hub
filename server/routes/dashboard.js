// The Home page: what needs attention this week, at the campuses you can see.
import { Router } from 'express';
import { requireRole, campusFilter, rank } from '../auth.js';
import { int } from '../http.js';
import { ensureServices } from './series.js';

export default function dashboardRoutes(db) {
  const r = Router();

  r.get('/dashboard', requireRole('volunteer'), (req, res) => {
    const leader = rank(req.user.role) >= rank('leader');
    const out = { role: req.user.role };
    const pid = req.user.personId ?? -1;
    out.my_next = db.prepare(`SELECT a.id, a.status, s.id service_id, s.starts_at, s.title, ps.name position, c.short_name campus_short, c.name campus
      FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id JOIN campuses c ON c.id = s.campus_id
      WHERE a.person_id = ? AND a.status != 'declined' AND s.starts_at >= date('now', '-1 day') ORDER BY s.starts_at LIMIT 5`).all(pid);
    out.my_pending = out.my_next.filter((a) => a.status === 'pending').length;
    if (!leader) return res.json(out);

    ensureServices(db);
    const cf = campusFilter(req.user, 's.campus_id');
    const args = [...cf.args];
    let extra = '';
    if (req.query.campus_id) { extra = ' AND s.campus_id = ?'; args.push(int(req.query.campus_id)); }
    const services = db.prepare(`SELECT s.id, s.starts_at, s.title, s.series, s.service_type_id, c.name campus, c.short_name campus_short, c.color campus_color,
        (SELECT COUNT(*) FROM plan_items i WHERE i.service_id = s.id) items
      FROM services s JOIN campuses c ON c.id = s.campus_id
      WHERE s.starts_at >= date('now') AND s.starts_at < date('now', '+8 days') AND ${cf.sql}${extra} ORDER BY s.starts_at`).all(...args);
    const needs = db.prepare(`SELECT n.position_id, n.count, ps.name, t.name team FROM service_needs n
      JOIN positions ps ON ps.id = n.position_id JOIN teams t ON t.id = ps.team_id WHERE n.service_id = ?`);
    const counts = db.prepare(`SELECT position_id, status, COUNT(*) n FROM assignments WHERE service_id = ? GROUP BY position_id, status`);
    out.services = services.map((s) => {
      const c = counts.all(s.id);
      const filled = (pos) => c.filter((x) => x.position_id === pos && x.status !== 'declined').reduce((a, x) => a + x.n, 0);
      const open = needs.all(s.id).map((n) => ({ ...n, open: n.count - filled(n.position_id) })).filter((n) => n.open > 0);
      return {
        ...s,
        open_positions: open,
        open_total: open.reduce((a, n) => a + n.open, 0),
        pending: c.filter((x) => x.status === 'pending').reduce((a, x) => a + x.n, 0),
        declined: c.filter((x) => x.status === 'declined').reduce((a, x) => a + x.n, 0),
        accepted: c.filter((x) => x.status === 'accepted').reduce((a, x) => a + x.n, 0),
      };
    });

    const pf = campusFilter(req.user, 'campus_id');
    out.people = db.prepare(`SELECT
        SUM(status = 'member') members, SUM(status = 'regular') regulars, SUM(status = 'guest') guests,
        SUM(status = 'guest' AND created_at >= date('now', '-30 days')) new_guests, COUNT(*) total
      FROM people WHERE archived = 0 AND ${pf.sql}`).get(...pf.args);
    out.blockouts_this_week = db.prepare(`SELECT b.start_date, b.end_date, b.reason, p.first_name, p.last_name, p.nickname
      FROM blockouts b JOIN people p ON p.id = b.person_id
      WHERE b.start_date <= date('now', '+7 days') AND b.end_date >= date('now') AND ${campusFilter(req.user, 'p.campus_id').sql}
      ORDER BY b.start_date LIMIT 20`).all(...pf.args);
    res.json(out);
  });

  return r;
}
