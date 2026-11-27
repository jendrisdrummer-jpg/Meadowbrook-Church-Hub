// "Who have we been missing?": regulars who haven't been marked present lately.
//
// A regular came at least 3 times in the 12 weeks before today. Their streak is the number of
// recent Sundays they missed, counting only Sundays when attendance was actually taken at their
// campus (a service there has someone marked present or checked in), so a Sunday nobody recorded
// never makes everyone look absent. Every leader, staff member and admin sees everyone at the
// campuses they can reach (the owner's decision: many people don't serve on a team).
import { campusFilter } from './auth.js';

const PRESENT_SQL = `SELECT service_id, person_id FROM attendance
  UNION SELECT service_id, person_id FROM checkins WHERE service_id IS NOT NULL`;

// `today` is 'YYYY-MM-DD' (the church's local date), passed in so tests can fix it.
export function missingPeople(db, user, { today, campusId = null, minWeeks = 2 } = {}) {
  const from = shiftDays(today, -84);
  const cf = campusFilter(user, 's.campus_id');
  const campusArgs = campusId ? [campusId] : [];
  // Sundays (week starts) with attendance taken, per campus, newest first.
  const week = `date(substr(s.starts_at, 1, 10), '-' || strftime('%w', substr(s.starts_at, 1, 10)) || ' days')`;
  const taken = db.prepare(`SELECT DISTINCT s.campus_id, ${week} week FROM services s
      WHERE substr(s.starts_at, 1, 10) >= ? AND substr(s.starts_at, 1, 10) <= ? AND ${cf.sql}${campusId ? ' AND s.campus_id = ?' : ''}
        AND EXISTS (SELECT 1 FROM (${PRESENT_SQL}) x WHERE x.service_id = s.id)
      ORDER BY week DESC`).all(from, today, ...cf.args, ...campusArgs);
  const weeksAt = new Map();
  for (const t of taken) {
    if (!weeksAt.has(t.campus_id)) weeksAt.set(t.campus_id, []);
    weeksAt.get(t.campus_id).push(t.week);
  }
  // Everyone marked present in the window, with how often and when last, at the campuses they can see.
  const pf = campusFilter(user, 'p.campus_id');
  const rows = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo, p.status, p.campus_id, p.household_role,
        COUNT(DISTINCT ${week}) times, MAX(substr(s.starts_at, 1, 10)) last_at
      FROM (${PRESENT_SQL}) a JOIN services s ON s.id = a.service_id JOIN people p ON p.id = a.person_id
      WHERE p.archived = 0 AND p.status != 'inactive' AND substr(s.starts_at, 1, 10) >= ? AND substr(s.starts_at, 1, 10) <= ?
        AND ${pf.sql}${campusId ? ' AND p.campus_id = ?' : ''}
      GROUP BY p.id`).all(from, today, ...pf.args, ...campusArgs);
  const allWeeks = [...new Set(taken.map((t) => t.week))].sort().reverse();
  const out = [];
  for (const p of rows) {
    if (p.times < 3) continue;
    // Sundays at their campus (any campus if they have none) since they were last here.
    const weeks = p.campus_id != null ? (weeksAt.get(p.campus_id) || []) : allWeeks;
    const lastWeek = sundayOf(p.last_at);
    const missed = weeks.filter((w) => w > lastWeek).length;
    if (missed >= minWeeks) out.push({ ...p, missed });
  }
  return out.sort((a, b) => b.missed - a.missed || a.last_at.localeCompare(b.last_at));
}

function shiftDays(day, n) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}
function sundayOf(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return shiftDays(day, -d.getUTCDay());
}
