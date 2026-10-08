// One search box for the hub: people, teams, songs, services, events and your tasks, each only
// as far as the person searching can already see them (role, campus).
import { Router } from 'express';
import { requireRole, campusFilter, rank } from '../auth.js';
import { str } from '../http.js';

const LIMIT = 6;

export default function searchRoutes(db) {
  const r = Router();

  r.get('/search', requireRole('volunteer'), (req, res) => {
    const q = str(req.query.q, 80).toLowerCase();
    if (q.length < 2) return res.json({ q, groups: [] });
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const starts = `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const can = (role) => rank(req.user.role) >= rank(role);
    const groups = [];
    const add = (key, label, items) => { if (items.length) groups.push({ key, label, items }); };

    if (can('leader')) {
      const cf = campusFilter(req.user, 'p.campus_id');
      const digits = q.replace(/\D/g, '');
      add('people', 'People', db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.email, p.phone, p.photo, p.status, c.short_name campus
        FROM people p LEFT JOIN campuses c ON c.id = p.campus_id
        WHERE p.archived = 0 AND ${cf.sql} AND (lower(p.first_name || ' ' || p.last_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(p.nickname, '') || ' ' || p.last_name) LIKE ? ESCAPE '\\'
          OR lower(p.last_name) LIKE ? ESCAPE '\\' OR lower(p.email) LIKE ? ESCAPE '\\'${digits.length >= 4 ? " OR replace(replace(replace(replace(p.phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?" : ''})
        ORDER BY (lower(p.first_name) LIKE ? ESCAPE '\\' OR lower(p.last_name) LIKE ? ESCAPE '\\') DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ?`)
        .all(...cf.args, like, like, starts, like, ...(digits.length >= 4 ? [`%${digits}%`] : []), starts, starts, LIMIT)
        .map((p) => ({ type: 'person', id: p.id, title: `${p.nickname || p.first_name} ${p.last_name}`.trim(), sub: [p.email || p.phone, p.campus].filter(Boolean).join(' · '), photo: p.photo, href: `/people/${p.id}` })));

      const tf = campusFilter(req.user, 't.campus_id');
      add('teams', 'Teams', db.prepare(`SELECT t.id, t.name, c.short_name campus, (SELECT COUNT(DISTINCT person_id) FROM team_members m WHERE m.team_id = t.id) members
        FROM teams t LEFT JOIN campuses c ON c.id = t.campus_id WHERE t.archived = 0 AND ${tf.sql} AND lower(t.name) LIKE ? ESCAPE '\\' ORDER BY t.name LIMIT ?`)
        .all(...tf.args, like, LIMIT)
        .map((t) => ({ type: 'team', id: t.id, title: t.name, sub: [t.campus, `${t.members} ${t.members === 1 ? 'person' : 'people'}`].filter(Boolean).join(' · '), href: `/teams/${t.id}` })));

      add('songs', 'Songs', db.prepare(`SELECT id, title, author, default_key FROM songs WHERE archived = 0 AND (lower(title) LIKE ? ESCAPE '\\' OR lower(author) LIKE ? ESCAPE '\\')
        ORDER BY lower(title) LIKE ? ESCAPE '\\' DESC, title COLLATE NOCASE LIMIT ?`).all(like, like, starts, LIMIT)
        .map((s) => ({ type: 'song', id: s.id, title: s.title, sub: [s.author, s.default_key && `Key of ${s.default_key}`].filter(Boolean).join(' · '), href: `/songs?q=${encodeURIComponent(s.title)}` })));
    }

    // Services by title or series: the next ones first, then the last two months.
    const sf = campusFilter(req.user, 's.campus_id');
    add('services', 'Services', db.prepare(`SELECT s.id, s.title, s.series, s.starts_at, c.short_name campus FROM services s JOIN campuses c ON c.id = s.campus_id
      WHERE ${sf.sql} AND (lower(s.title) LIKE ? ESCAPE '\\' OR lower(s.series) LIKE ? ESCAPE '\\') AND s.starts_at >= date('now', '-60 days')
      ORDER BY s.starts_at < date('now'), CASE WHEN s.starts_at >= date('now') THEN s.starts_at END, s.starts_at DESC LIMIT ?`).all(...sf.args, like, like, LIMIT)
      .map((s) => ({ type: 'service', id: s.id, title: s.title || s.series || 'Service', sub: [s.starts_at.replace('T', ' '), s.campus, s.title && s.series].filter(Boolean).join(' · '), when: s.starts_at, href: `/services/${s.id}` })));

    if (can('staff')) {
      const ef = campusFilter(req.user, 'e.campus_id');
      add('events', 'Events', db.prepare(`SELECT e.id, e.title, e.starts_at, e.location FROM events e WHERE e.archived = 0 AND ${ef.sql} AND lower(e.title) LIKE ? ESCAPE '\\'
        ORDER BY substr(COALESCE(e.ends_at, e.starts_at), 1, 10) < date('now'), e.starts_at LIMIT ?`).all(...ef.args, like, LIMIT)
        .map((e) => ({ type: 'event', id: e.id, title: e.title, sub: [e.starts_at.replace('T', ' '), e.location].filter(Boolean).join(' · '), when: e.starts_at, href: `/events/${e.id}` })));
    }

    // Tasks given to me or that I gave, still open.
    add('tasks', 'My tasks', db.prepare(`SELECT id, title, due_date FROM tasks WHERE done_at IS NULL AND (assignee_id = ? OR created_by = ?) AND lower(title) LIKE ? ESCAPE '\\'
      ORDER BY due_date IS NULL, due_date LIMIT ?`).all(req.user.personId ?? -1, req.user.id, like, LIMIT)
      .map((t) => ({ type: 'task', id: t.id, title: t.title, sub: t.due_date ? `Due ${t.due_date}` : '', href: `/tasks/${t.id}` })));

    res.json({ q, groups });
  });

  return r;
}
