// Kids' check-in, check-out, room rosters and attendance counts.
//
// Check-in tablets download a roster of families (GET /checkin/roster) so they keep working
// with no internet. Each check-in gets its id and pickup code on the tablet, and uploads are
// idempotent: re-sending a batch after a dropped connection never double-counts anyone.
import { Router } from 'express';
import { requireRole, canCampus, campusFilter } from '../auth.js';
import { getSetting, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, oneOf, isDate, localNow } from '../http.js';
import { roomFor, securityCode } from '../../public/js/checkin-rules.js';

export default function checkinRoutes(db) {
  const r = Router();

  function campus(req, id) {
    const c = db.prepare('SELECT * FROM campuses WHERE id = ?').get(int(id, 'Campus'));
    if (!c) throw notFound('Campus');
    if (!canCampus(req.user, c.id)) throw forbidden();
    return c;
  }

  // Everything a tablet needs to check families in with no connection.
  r.get('/checkin/roster', requireRole('leader'), (req, res) => {
    const c = campus(req, req.query.campus_id);
    const today = localNow(c.timezone).date;
    // Every household is included: families sometimes visit the other campus.
    const households = db.prepare('SELECT id, name, phone, campus_id FROM households').all();
    const people = db.prepare(`SELECT id, household_id, household_role, first_name, last_name, nickname, birthdate, grade,
        allergies, medical_notes, phone, photo FROM people WHERE archived = 0 AND household_id IS NOT NULL`).all();
    const pickups = db.prepare('SELECT * FROM household_pickups').all();
    const byHousehold = new Map(households.map((h) => [h.id, { ...h, members: [], pickups: [] }]));
    for (const p of people) byHousehold.get(p.household_id)?.members.push(p);
    for (const p of pickups) byHousehold.get(p.household_id)?.pickups.push(p);
    res.json({
      campus: c,
      today,
      generated_at: new Date().toISOString(),
      rooms: db.prepare('SELECT * FROM rooms WHERE campus_id = ? AND archived = 0 ORDER BY sort, name').all(c.id),
      services: db.prepare("SELECT id, title, starts_at, duration_min FROM services WHERE campus_id = ? AND substr(starts_at, 1, 10) = ? ORDER BY starts_at").all(c.id, today),
      households: [...byHousehold.values()].filter((h) => h.members.some((m) => m.household_role === 'child')),
      label_size: getSetting(db, 'label_size', 'brother-62x29'),
      print_parent_tag: getSetting(db, 'checkin_print_parent_tag', true),
      church_name: getSetting(db, 'church_name', 'Meadowbrook Church'),
    });
  });

  // Upload check-ins: { campus_id, records: [{ id, person_id, room_id?, service_id?, kind, security_code, station, checked_in_at }] }
  r.post('/checkin/checkins', requireRole('leader'), (req, res) => {
    const c = campus(req, req.body?.campus_id);
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) throw bad('Nothing to check in.');
    if (records.length > 500) throw bad('Too many at once.');
    const rooms = db.prepare('SELECT * FROM rooms WHERE campus_id = ?').all(c.id);
    const ins = db.prepare(`INSERT OR IGNORE INTO checkins (id, campus_id, service_id, person_id, room_id, kind, security_code, station, day, checked_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Children deleted on the server since the tablet's roster was downloaded are skipped, not fatal,
    // so one stale record can't block a tablet's whole offline queue.
    const out = tx(db, () => records.map((rec) => {
      const id = str(rec.id, 64);
      if (!/^[\w-]{8,64}$/.test(id)) throw bad('Each check-in needs an id.');
      const person = db.prepare('SELECT id, birthdate, grade FROM people WHERE id = ?').get(int(rec.person_id, 'Person'));
      if (!person) return null;
      const at = Number.isNaN(Date.parse(rec.checked_in_at)) ? new Date() : new Date(rec.checked_in_at);
      const day = localNow(c.timezone, at).date;
      const kind = oneOf(rec.kind, ['kid', 'adult', 'volunteer'], 'kid');
      let roomId = int(rec.room_id);
      if (roomId && !rooms.some((rm) => rm.id === roomId)) roomId = null;
      if (!roomId && kind === 'kid') roomId = roomFor(person, rooms, day)?.id ?? null;
      const serviceId = int(rec.service_id);
      ins.run(id, c.id, serviceId && db.prepare('SELECT 1 FROM services WHERE id = ? AND campus_id = ?').get(serviceId, c.id) ? serviceId : null,
        person.id, roomId, kind, str(rec.security_code, 8).toUpperCase() || securityCode(), str(rec.station, 60), day, at.toISOString());
      return db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
    })).filter(Boolean);
    res.status(201).json(out);
  });

  // Who is checked in today (or on ?day=), with rooms; ?room_id narrows to one room.
  r.get('/checkin/active', requireRole('leader'), (req, res) => {
    const c = campus(req, req.query.campus_id);
    const day = isDate(req.query.day) ? req.query.day : localNow(c.timezone).date;
    const args = [c.id, day];
    let extra = '';
    if (req.query.room_id) { extra = ' AND ci.room_id = ?'; args.push(int(req.query.room_id)); }
    res.json(db.prepare(`SELECT ci.*, p.first_name, p.last_name, p.nickname, p.allergies, p.medical_notes, p.photo, p.birthdate, p.grade,
        p.household_id, rm.name room_name, h.name household_name
      FROM checkins ci JOIN people p ON p.id = ci.person_id LEFT JOIN rooms rm ON rm.id = ci.room_id
      LEFT JOIN households h ON h.id = p.household_id
      WHERE ci.campus_id = ? AND ci.day = ?${extra} ORDER BY rm.sort, rm.name, p.first_name`).all(...args));
  });

  // Check out by pickup code (every child on that code) or by check-in ids.
  r.post('/checkin/checkout', requireRole('leader'), (req, res) => {
    const c = campus(req, req.body?.campus_id);
    const day = localNow(c.timezone).date;
    const by = str(req.body?.by, 100) || req.user.name;
    let rows;
    if (req.body?.security_code) {
      rows = db.prepare('SELECT id FROM checkins WHERE campus_id = ? AND day = ? AND security_code = ? AND checked_out_at IS NULL')
        .all(c.id, day, str(req.body.security_code, 8).toUpperCase());
      if (!rows.length) throw notFound('A checked-in child with that code');
    } else {
      rows = (req.body?.ids || []).map((id) => ({ id: str(id, 64) }));
    }
    const upd = db.prepare("UPDATE checkins SET checked_out_at = ?, checked_out_by = ? WHERE id = ? AND campus_id = ? AND checked_out_at IS NULL");
    const now = new Date().toISOString();
    let count = 0;
    tx(db, () => rows.forEach((row) => { count += Number(upd.run(now, by, row.id, c.id).changes); }));
    res.json({ checked_out: count });
  });

  // Undo a mistaken check-in.
  r.delete('/checkin/checkins/:id', requireRole('leader'), (req, res) => {
    const ci = db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
    if (!ci) throw notFound('Check-in');
    if (!canCampus(req.user, ci.campus_id)) throw forbidden();
    db.prepare('DELETE FROM checkins WHERE id = ?').run(ci.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- attendance
  r.put('/services/:id/headcounts', requireRole('leader'), (req, res) => {
    const s = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('Service');
    if (!canCampus(req.user, s.campus_id)) throw forbidden();
    const counts = req.body?.counts || {};
    tx(db, () => {
      for (const [area, value] of Object.entries(counts)) {
        const n = int(value, `${area} count`);
        if (n == null) db.prepare('DELETE FROM headcounts WHERE service_id = ? AND area = ?').run(s.id, str(area, 60));
        else if (n < 0) throw bad('Counts can’t be negative.');
        else db.prepare('INSERT INTO headcounts (service_id, area, count) VALUES (?, ?, ?) ON CONFLICT(service_id, area) DO UPDATE SET count = excluded.count').run(s.id, str(area, 60), n);
      }
    });
    res.json(db.prepare('SELECT area, count FROM headcounts WHERE service_id = ?').all(s.id));
  });

  // Weekly totals per campus: headcounts plus kids checked in.
  r.get('/attendance/weekly', requireRole('leader'), (req, res) => {
    const weeks = Math.min(int(req.query.weeks) ?? 12, 104);
    const from = new Date(Date.now() - weeks * 7 * 864e5).toISOString().slice(0, 10);
    const cf = campusFilter(req.user, 's.campus_id');
    // Weeks start on Sunday: the date of that Sunday labels the week.
    const week = (col) => `date(${col}, '-' || strftime('%w', ${col}) || ' days')`;
    const adults = db.prepare(`SELECT s.campus_id, ${week('substr(s.starts_at, 1, 10)')} week, SUM(h.count) total
      FROM headcounts h JOIN services s ON s.id = h.service_id WHERE s.starts_at >= ? AND ${cf.sql} GROUP BY 1, 2`).all(from, ...cf.args);
    const cf2 = campusFilter(req.user, 'ci.campus_id');
    const kids = db.prepare(`SELECT ci.campus_id, ${week('ci.day')} week, COUNT(*) total
      FROM checkins ci WHERE ci.day >= ? AND ci.kind = 'kid' AND ${cf2.sql} GROUP BY 1, 2`).all(from, ...cf2.args);
    const volunteers = db.prepare(`SELECT s.campus_id, ${week('substr(s.starts_at, 1, 10)')} week, COUNT(DISTINCT a.person_id) total
      FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.status = 'accepted' AND s.starts_at >= ? AND s.starts_at <= datetime('now') AND ${cf.sql} GROUP BY 1, 2`).all(from, ...cf.args);
    res.json({ from, adults, kids, volunteers });
  });

  return r;
}
