// The Home page: what needs attention this week, at the campuses you can see.
import { Router } from 'express';
import { requireRole, campusFilter, canCampus, rank } from '../auth.js';
import { int, localNow } from '../http.js';
import { ensureServices } from './series.js';
import { ledTeamIds, ledPositionsClause } from '../team-scope.js';
import { missingPeople } from '../attendance-missing.js';
import { manages } from './forms.js';

const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Today's date at a campus, in its own time zone (a service at 9 pm Sunday is still "today"
// even when it's already Monday in UTC).
function localToday(tz) {
  try { return localNow(tz || 'UTC').date; } catch { return localNow('UTC').date; }
}

export default function dashboardRoutes(db) {
  const r = Router();

  // The date that "today" means for this person: the campus they picked, else their first campus.
  function scopeToday(user, campusId) {
    const id = campusId || user.campusIds?.[0];
    const c = id ? db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(id) : db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get();
    return localToday(c?.timezone);
  }

  // Services in the next 7 days (counting today) at the campuses this person can see.
  function weekServices(user, campusId, columns = '') {
    const cf = campusFilter(user, 's.campus_id');
    const args = [...cf.args];
    let extra = '';
    // A leader who isn't staff sees the campuses of the teams they lead (a church-wide team reaches
    // every campus), or, leading no team, their own campus, even when their account isn't limited to one.
    const led = ledTeamIds(db, user);
    if (led) {
      const rows = led.size
        ? db.prepare(`SELECT DISTINCT campus_id FROM teams WHERE id IN (${[...led].map(() => '?').join(',')})`).all(...led)
        : db.prepare('SELECT campus_id FROM people WHERE id = ?').all(user.personId ?? -1);
      const own = rows.map((x) => x.campus_id);
      if (own.length && !own.includes(null)) {
        extra += ` AND s.campus_id IN (${own.map(() => '?').join(',')})`;
        args.push(...own);
      }
    }
    if (campusId) { extra += ' AND s.campus_id = ?'; args.push(campusId); }
    // A day of slack either side in SQL, then the campus's own calendar decides.
    const rows = db.prepare(`SELECT s.id, s.starts_at, s.title, s.series, s.service_type_id, s.campus_id, c.timezone, c.name campus, c.short_name campus_short, c.color campus_color${columns}
      FROM services s JOIN campuses c ON c.id = s.campus_id
      WHERE s.starts_at >= date('now', '-1 day') AND s.starts_at < date('now', '+9 days') AND ${cf.sql}${extra} ORDER BY s.starts_at`).all(...args);
    return rows.filter((s) => {
      const today = localToday(s.timezone);
      const day = s.starts_at.slice(0, 10);
      return day >= today && day < addDays(today, 8);
    });
  }

  // Per service: what each position needs and how it stands. A leader who isn't staff sees only
  // the teams they lead (team-scope.js).
  function standing(user) {
    const lpn = ledPositionsClause(user, 'n.position_id');
    const lpa = ledPositionsClause(user, 'position_id');
    const needs = db.prepare(`SELECT n.position_id, n.count, ps.name, t.name team FROM service_needs n
      JOIN positions ps ON ps.id = n.position_id JOIN teams t ON t.id = ps.team_id WHERE n.service_id = ? AND ${lpn.sql}`);
    const counts = db.prepare(`SELECT position_id, status, (sent_at IS NOT NULL) sent, COUNT(*) n FROM assignments WHERE service_id = ? AND ${lpa.sql} GROUP BY position_id, status, sent`);
    return (serviceId) => {
      const c = counts.all(serviceId, ...lpa.args);
      const sum = (f, pos) => c.filter((x) => (pos === undefined || x.position_id === pos) && f(x)).reduce((a, x) => a + x.n, 0);
      const positions = needs.all(serviceId, ...lpn.args).map((n) => {
        const filled = sum((x) => x.status !== 'declined', n.position_id);
        const declined = sum((x) => x.status === 'declined', n.position_id);
        const open = Math.max(0, n.count - filled);
        return { ...n, filled, open, uncovered: Math.min(declined, open) };
      });
      return {
        positions,
        pending: sum((x) => x.status === 'pending'),
        waiting: sum((x) => x.status === 'pending' && x.sent), // asked, not answered
        declined: sum((x) => x.status === 'declined'),
        accepted: sum((x) => x.status === 'accepted'),
      };
    };
  }

  // What is waiting on this person, as plain counts. Everything is limited to the campuses they
  // can reach, and a leader who isn't staff only counts the teams they lead. Volunteers get zeros.
  function attention(user, campusId) {
    const out = { open_spots: 0, open_next: null, not_replied: 0, declines: 0, declines_next: null, declines_service: null, connect_cards: 0, signups: 0, forms_new: 0, forms_title: null, missing: 0 };
    if (rank(user.role) < rank('leader')) return out;
    const stand = standing(user);
    for (const s of weekServices(user, campusId)) {
      const st = stand(s.id);
      const open = st.positions.reduce((a, p) => a + p.open, 0);
      const uncovered = st.positions.reduce((a, p) => a + p.uncovered, 0);
      out.open_spots += open;
      if (open && !out.open_next) out.open_next = s.starts_at;
      out.not_replied += st.waiting;
      out.declines += uncovered;
      if (uncovered && !out.declines_next) { out.declines_next = s.starts_at; out.declines_service = s.id; }
    }
    // Same filters as the Connect cards and App sign-ups pages (routes/app.js).
    const ck = campusFilter(user, 'k.campus_id');
    out.connect_cards = db.prepare(`SELECT COUNT(*) n FROM connect_cards k WHERE k.done_at IS NULL AND ${ck.sql}${campusId ? ' AND k.campus_id = ?' : ''}`)
      .get(...ck.args, ...(campusId ? [campusId] : [])).n;
    const cp = campusFilter(user, 'p.campus_id');
    out.signups = db.prepare(`SELECT COUNT(*) n FROM people p WHERE p.signed_up_at IS NOT NULL AND p.archived = 0 AND p.welcomed_at IS NULL AND ${cp.sql}${campusId ? ' AND p.campus_id = ?' : ''}`)
      .get(...cp.args, ...(campusId ? [campusId] : [])).n;
    // Regulars who've missed the last 2+ Sundays when attendance was taken (their teams, for leaders).
    const tz = db.prepare('SELECT timezone FROM campuses ORDER BY id LIMIT 1').get()?.timezone;
    out.missing = missingPeople(db, user, { today: localToday(tz), campusId: campusId || null, minWeeks: 2 }).length;
    // New form responses are for staff, and only on the forms they manage.
    if (rank(user.role) >= rank('staff')) {
      const forms = db.prepare(`SELECT f.id, f.title, f.campus_id, (SELECT COUNT(*) FROM form_responses x WHERE x.form_id = f.id AND x.status = 'new') n FROM forms f`).all()
        .filter((f) => f.n && canCampus(user, f.campus_id) && manages(user, f) && (!campusId || f.campus_id == null || f.campus_id === campusId));
      out.forms_new = forms.reduce((a, f) => a + f.n, 0);
      if (forms.length === 1) out.forms_title = forms[0].title;
    }
    return out;
  }

  // Teams this person leads: the next service each is serving at, and where it stands.
  function myTeams(user, campusId) {
    if (!user.personId) return [];
    const teams = db.prepare(`SELECT t.id, t.name, t.color, t.campus_id, c.short_name campus_short,
        (SELECT COUNT(DISTINCT m.person_id) FROM team_members m WHERE m.team_id = t.id) members,
        (SELECT ch.id FROM chats ch WHERE ch.team_id = t.id AND ch.kind = 'team' LIMIT 1) chat_id
      FROM team_members tm JOIN teams t ON t.id = tm.team_id LEFT JOIN campuses c ON c.id = t.campus_id
      WHERE tm.person_id = ? AND tm.is_leader = 1 AND t.archived = 0 AND (t.campus_id IS NULL OR ${campusFilter(user, 't.campus_id').sql})
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE`).all(user.personId, ...campusFilter(user, 't.campus_id').args);
    const services = weekServices(user, campusId);
    const teamStanding = db.prepare(`SELECT
        COALESCE((SELECT SUM(n.count) FROM service_needs n JOIN positions ps ON ps.id = n.position_id WHERE n.service_id = ? AND ps.team_id = ?), 0) needed,
        (SELECT COUNT(*) FROM assignments a JOIN positions ps ON ps.id = a.position_id WHERE a.service_id = ? AND ps.team_id = ? AND a.status != 'declined') filled,
        COALESCE((SELECT SUM(MAX(0, n.count - (SELECT COUNT(*) FROM assignments a WHERE a.service_id = n.service_id AND a.position_id = n.position_id AND a.status != 'declined')))
          FROM service_needs n JOIN positions ps ON ps.id = n.position_id WHERE n.service_id = ? AND ps.team_id = ?), 0) open,
        (SELECT COUNT(*) FROM assignments a JOIN positions ps ON ps.id = a.position_id WHERE a.service_id = ? AND ps.team_id = ? AND a.status = 'pending' AND a.sent_at IS NOT NULL) waiting,
        (SELECT COUNT(*) FROM assignments a JOIN positions ps ON ps.id = a.position_id WHERE a.service_id = ? AND ps.team_id = ? AND a.status = 'declined') declined`);
    return teams.map((t) => {
      const mine = services.filter((s) => t.campus_id == null || s.campus_id === t.campus_id);
      const rows = mine.map((s) => ({ id: s.id, starts_at: s.starts_at, ...teamStanding.get(s.id, t.id, s.id, t.id, s.id, t.id, s.id, t.id, s.id, t.id) }));
      const open = (x) => x.open;
      return {
        ...t,
        next_service: rows[0]?.starts_at ?? null,
        open_spots: rows.reduce((a, x) => a + open(x), 0),
        not_replied: rows.reduce((a, x) => a + x.waiting, 0),
        declines: rows.reduce((a, x) => a + Math.min(x.declined, open(x)), 0),
      };
    });
  }

  // For the menu badges: light, so the app can ask often.
  r.get('/attention', requireRole('volunteer'), (req, res) => {
    const a = attention(req.user, int(req.query.campus_id));
    res.json({ connect_cards: a.connect_cards, forms_new: a.forms_new, signups: a.signups, open_spots: a.open_spots, not_replied: a.not_replied, declines: a.declines });
  });

  r.get('/dashboard', requireRole('volunteer'), (req, res) => {
    const leader = rank(req.user.role) >= rank('leader');
    const out = { role: req.user.role };
    const pid = req.user.personId ?? -1;
    const campusId = int(req.query.campus_id);
    out.my_next = db.prepare(`SELECT a.id, a.status, s.id service_id, s.starts_at, s.title, ps.name position, c.short_name campus_short, c.name campus, c.timezone
      FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id JOIN campuses c ON c.id = s.campus_id
      WHERE a.person_id = ? AND a.status != 'declined' AND s.starts_at >= date('now', '-2 days') ORDER BY s.starts_at`).all(pid)
      .filter((a) => a.starts_at.slice(0, 10) >= addDays(localToday(a.timezone), -1)).slice(0, 5)
      .map(({ timezone, ...a }) => a);
    out.my_pending = out.my_next.filter((a) => a.status === 'pending').length;
    if (!leader) return res.json(out);

    ensureServices(db);
    const stand = standing(req.user);
    const items = db.prepare('SELECT COUNT(*) n FROM plan_items WHERE service_id = ?');
    out.services = weekServices(req.user, campusId).map(({ timezone, campus_id, ...s }) => {
      const st = stand(s.id);
      const needed = st.positions.reduce((a, p) => a + p.count, 0);
      const filled = st.positions.reduce((a, p) => a + p.filled, 0);
      const open = st.positions.filter((p) => p.open > 0).map((p) => ({ ...p, open: p.open }));
      return {
        ...s,
        campus_id,
        items: items.get(s.id).n,
        open_positions: open,
        open_total: open.reduce((a, n) => a + n.open, 0),
        needed,
        filled,
        positions: st.positions.map((p) => ({ name: p.name, needed: p.count, filled: p.filled })),
        pending: st.pending,
        waiting: st.waiting,
        declined: st.declined,
        accepted: st.accepted,
      };
    });

    const today = scopeToday(req.user, campusId);
    const pf = campusFilter(req.user, 'campus_id');
    out.people = db.prepare(`SELECT
        SUM(status = 'member') members, SUM(status = 'regular') regulars, SUM(status = 'guest') guests,
        SUM(status = 'guest' AND created_at >= date(?, '-30 days')) new_guests, COUNT(*) total
      FROM people WHERE archived = 0 AND ${pf.sql}`).get(today, ...pf.args);
    // Away dates: for a leader who isn't staff, only people on teams they lead.
    const led = ledTeamIds(db, req.user);
    const awayLimit = led ? ' AND b.person_id IN (SELECT tm.person_id FROM team_members tm WHERE tm.team_id IN (SELECT team_id FROM team_members WHERE person_id = ? AND is_leader = 1))' : '';
    out.blockouts_this_week = db.prepare(`SELECT b.start_date, b.end_date, b.reason, p.first_name, p.last_name, p.nickname
      FROM blockouts b JOIN people p ON p.id = b.person_id
      WHERE b.start_date <= ? AND b.end_date >= ? AND ${campusFilter(req.user, 'p.campus_id').sql}${awayLimit}
      ORDER BY b.start_date LIMIT 20`).all(addDays(today, 7), today, ...pf.args, ...(led ? [req.user.personId ?? -1] : []));
    out.attention = attention(req.user, campusId);
    out.my_teams = myTeams(req.user, campusId);
    res.json(out);
  });

  return r;
}
