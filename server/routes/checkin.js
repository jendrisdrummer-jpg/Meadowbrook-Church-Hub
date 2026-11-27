// Kids' check-in, check-out, room rosters and attendance counts.
//
// Check-in tablets download a roster of families (GET /checkin/roster) so they keep working
// with no internet. Each check-in gets its id and pickup code on the tablet, and uploads are
// idempotent: re-sending a batch after a dropped connection never double-counts anyone.
import { Router } from 'express';
import { requireRole, requireAllCampuses, requireAttendance, canAttendCampus, canCampus, campusFilter, rank } from '../auth.js';
import { getSetting, setSetting, tx } from '../db.js';
import { bad, notFound, forbidden, int, str, oneOf, isDate, localNow, audit, HttpError } from '../http.js';
import { legalHold, saveHold, HOLD_MSG, HOLD_COOLING_DAYS } from '../history.js';
import { notify } from '../notify.js';
import { roomFor, securityCode, CHECKIN_APP_VERSION } from '../../public/js/checkin-rules.js';
import { ACTIONS, recordEvent, recordedToday, appVersion } from '../checkin-events.js';

// Check-in safety switches live in one settings key with their own admin endpoint, so they never
// appear in GET /settings and can't be changed through PATCH /settings. Later releases add keys here.
const SAFETY_DEFAULTS = { require_current_app: false };
const SAFETY_TYPES = { require_current_app: 'boolean' };
const CODE_MISS_ROWS = 5;
const REFUSED_ROWS = 20;
export const safetySettings = (db) => ({ ...SAFETY_DEFAULTS, ...getSetting(db, 'checkin_safety', {}) });

// Who may use kids' check-in (the family roster with children's allergies and medical notes,
// checking in and out): paired stations, staff and admins, and leader accounts an admin has
// authorised for check-in (Settings → Sign-in & accounts). Interim rule until the check-in access
// flag of the child-safety plan replaces it.
export function canCheckin(db, user) {
  if (!user) return false;
  if (user.station || rank(user.role) >= rank('staff')) return true;
  return rank(user.role) >= rank('leader') && getSetting(db, 'checkin_user_ids', []).includes(user.id);
}

// Takes an account's check-in authorisation away (account deleted or no longer a leader), so a
// grant never lingers to come back silently or pass to a reused account id.
export function revokeCheckin(db, userId) {
  const ids = getSetting(db, 'checkin_user_ids', []);
  if (ids.includes(userId)) setSetting(db, 'checkin_user_ids', ids.filter((id) => id !== userId));
}

export default function checkinRoutes(db) {
  const r = Router();
  const requireCheckin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!canCheckin(db, req.user)) return res.status(403).json({ error: 'Kids’ check-in is for staff and people an admin has authorised. Ask an admin if you need it.' });
    next();
  };

  function campus(req, id) {
    const c = db.prepare('SELECT * FROM campuses WHERE id = ?').get(int(id, 'Campus'));
    if (!c) throw notFound('Campus');
    if (!canCampus(req.user, c.id)) throw forbidden();
    return c;
  }

  // When an admin has turned on "only let iPads with the latest check-in sync", a paired iPad that
  // reports an older version (or none) is turned away with 426 before it can read or change anything.
  // Its queue stays on the iPad, so nothing is lost. Hub users and the pairing routes are never held.
  const currentApp = (req, res, next) => {
    const station = req.user?.station;
    if (!station || !safetySettings(db).require_current_app) return next();
    const sent = appVersion(req);
    if (sent !== '' && Number(sent) >= CHECKIN_APP_VERSION) return next();
    if (!recordedToday(db, req, 'version.refused', station.campus_id)) {
      recordEvent(db, req, { action: 'version.refused', campusId: station.campus_id, detail: { sent: sent === '' ? null : Number(sent), required: CHECKIN_APP_VERSION } });
    }
    res.status(426).json({ error: 'This iPad is running an older check-in. Close the app and open it again, then try once more.', reload: true });
  };

  // The campuses this account may set a station up for (setup lists only these).
  r.get('/checkin/campuses', requireCheckin, (req, res) => {
    res.json(db.prepare('SELECT id, name, short_name, active FROM campuses ORDER BY active DESC, sort, name').all().filter((c) => canCampus(req.user, c.id)));
  });

  // Everything a tablet needs to check families in with no connection.
  r.get('/checkin/roster', requireCheckin, currentApp, (req, res) => {
    const c = campus(req, req.query.campus_id);
    const today = localNow(c.timezone).date;
    // This campus's families, plus families with no campus set. Never a family assigned to another
    // campus, so a campus-limited account never receives another campus's children.
    // Unassigned families are included on purpose: Faith Teams has no campuses, so many imported
    // households have none yet, and leaving them out would hide real children from check-in. Once
    // staff assign a campus (People → household → edit), the family appears only at that campus.
    // A family visiting another campus is looked up online or added as a guest.
    const households = db.prepare('SELECT id, name, phone, campus_id FROM households WHERE campus_id = ? OR campus_id IS NULL').all(c.id);
    const people = db.prepare(`SELECT id, household_id, household_role, first_name, last_name, nickname, birthdate, grade,
        allergies, medical_notes, phone, photo FROM people WHERE archived = 0 AND household_id IS NOT NULL`).all();
    const pickups = db.prepare('SELECT * FROM household_pickups').all();
    const byHousehold = new Map(households.map((h) => [h.id, { ...h, members: [], pickups: [] }]));
    // Check-in needs children's allergies and medical notes; it never needs an adult's.
    for (const p of people) {
      if (p.household_role !== 'child') { p.allergies = null; p.medical_notes = null; }
      byHousehold.get(p.household_id)?.members.push(p);
    }
    for (const p of pickups) byHousehold.get(p.household_id)?.pickups.push(p);
    const shown = [...byHousehold.values()].filter((h) => h.members.some((m) => m.household_role === 'child'));
    // One row per iPad (or account) per campus per day, so a tablet refreshing every ten minutes doesn't fill the record.
    if (!recordedToday(db, req, 'roster.download', c.id)) {
      recordEvent(db, req, { action: 'roster.download', campusId: c.id,
        detail: { households: shown.length, children: shown.reduce((n, h) => n + h.members.filter((m) => m.household_role === 'child').length, 0) } });
    }
    res.json({
      campus: c,
      today,
      generated_at: new Date().toISOString(),
      rooms: db.prepare('SELECT * FROM rooms WHERE campus_id = ? AND archived = 0 ORDER BY sort, name').all(c.id),
      services: db.prepare("SELECT id, title, starts_at, duration_min FROM services WHERE campus_id = ? AND substr(starts_at, 1, 10) = ? ORDER BY starts_at").all(c.id, today),
      households: shown,
      label_size: getSetting(db, 'label_size', 'brother-62x29'),
      print_parent_tag: getSetting(db, 'checkin_print_parent_tag', true),
      church_name: getSetting(db, 'church_name', 'Meadowbrook Church'),
    });
  });

  // Upload check-ins: { campus_id, records: [{ id, person_id, room_id?, service_id?, kind, security_code, station, checked_in_at }] }
  r.post('/checkin/checkins', requireCheckin, currentApp, (req, res) => {
    const c = campus(req, req.body?.campus_id);
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) throw bad('Nothing to check in.');
    if (records.length > 500) throw bad('Too many at once.');
    const rooms = db.prepare('SELECT * FROM rooms WHERE campus_id = ?').all(c.id);
    const ins = db.prepare(`INSERT OR IGNORE INTO checkins (id, campus_id, service_id, person_id, room_id, kind, security_code, station, day, checked_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Children deleted on the server since the tablet's roster was downloaded are skipped, not fatal,
    // so one stale record can't block a tablet's whole offline queue.
    const skips = { other_campus: [], not_found: [] };
    const out = tx(db, () => {
    const done = records.map((rec) => {
      const id = str(rec.id, 64);
      if (!/^[\w-]{8,64}$/.test(id)) throw bad('Each check-in needs an id.');
      const personId = int(rec.person_id, 'Person');
      const person = db.prepare(`SELECT p.id, p.household_id, p.birthdate, p.grade, h.campus_id household_campus
        FROM people p LEFT JOIN households h ON h.id = p.household_id WHERE p.id = ?`).get(personId);
      if (!person) { skips.not_found.push(personId); return null; }
      // Same rule as the roster: never a family assigned to another campus, so check-in can't be used
      // to pull another campus's child into this campus's lists. (Visiting families: later item.)
      if (person.household_campus != null && person.household_campus !== c.id) { skips.other_campus.push(person.id); return null; }
      const at = Number.isNaN(Date.parse(rec.checked_in_at)) ? new Date() : new Date(rec.checked_in_at);
      const day = localNow(c.timezone, at).date;
      const kind = oneOf(rec.kind, ['kid', 'adult', 'volunteer'], 'kid');
      let roomId = int(rec.room_id);
      if (roomId && !rooms.some((rm) => rm.id === roomId)) roomId = null;
      if (!roomId && kind === 'kid') roomId = roomFor(person, rooms, day)?.id ?? null;
      const serviceId = int(rec.service_id);
      const info = ins.run(id, c.id, serviceId && db.prepare('SELECT 1 FROM services WHERE id = ? AND campus_id = ?').get(serviceId, c.id) ? serviceId : null,
        person.id, roomId, kind, str(rec.security_code, 8).toUpperCase() || securityCode(), str(rec.station, 60), day, at.toISOString());
      const saved = db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
      // Only a new row is recorded; re-sending a batch after a dropped connection writes nothing.
      if (info.changes === 1) {
        recordEvent(db, req, { action: 'checkin', campusId: c.id, checkinId: id, personId: person.id, householdId: person.household_id, code: saved.security_code,
          clientAt: rec.checked_in_at, detail: { kind, room_id: saved.room_id, service_id: saved.service_id, station_label: str(rec.station, 60) } });
      }
      return saved;
    }).filter(Boolean);
    // One summary row per reason per request, so a stale queue can't flood the record.
    for (const [reason, list] of Object.entries(skips)) {
      if (list.length) recordEvent(db, req, { action: 'checkin.skipped', campusId: c.id, personId: list[0], detail: { reason, count: list.length, person_ids: list.slice(0, 20) } });
    }
    return done;
    });
    res.status(201).json(out);
  });

  // Who is checked in today (or on ?day=), with rooms; ?room_id narrows to one room.
  r.get('/checkin/active', requireCheckin, currentApp, (req, res) => {
    const c = campus(req, req.query.campus_id);
    const day = isDate(req.query.day) ? req.query.day : localNow(c.timezone).date;
    const args = [c.id, day];
    let extra = '';
    if (req.query.room_id) { extra = ' AND ci.room_id = ?'; args.push(int(req.query.room_id)); }
    // Children's allergies and medical notes are for kids' safety; an adult's (a volunteer or a
    // parent checked in) are never sent.
    res.json(db.prepare(`SELECT ci.id, ci.campus_id, ci.service_id, ci.person_id, ci.room_id, ci.kind, ci.security_code, ci.station, ci.day,
        ci.checked_in_at, ci.checked_out_at, ci.checked_out_by, p.first_name, p.last_name, p.nickname,
        CASE WHEN p.household_role = 'child' THEN p.allergies END allergies,
        CASE WHEN p.household_role = 'child' THEN p.medical_notes END medical_notes, p.photo, p.birthdate, p.grade,
        p.household_id, rm.name room_name, h.name household_name
      FROM checkins ci JOIN people p ON p.id = ci.person_id LEFT JOIN rooms rm ON rm.id = ci.room_id
      LEFT JOIN households h ON h.id = p.household_id
      WHERE ci.campus_id = ? AND ci.day = ? AND ci.voided_at IS NULL AND (h.campus_id IS NULL OR h.campus_id = ci.campus_id)${extra}
      ORDER BY rm.sort, rm.name, p.first_name`).all(...args));
  });

  // Check out. Three shapes:
  //   { campus_id, mode: 'request', household_id?, ids }  a release happening now, online. All the children must be
  //       one family's (a child with no family counts as a family of their own), or nothing is released (409).
  //   { campus_id, mode: 'report', ids, at? }             a release that already happened (an offline iPad catching
  //       up). It is never refused: each child is recorded at the time the iPad says (kept within sane limits), and
  //       a report that spans families is recorded and flagged for a person to look at.
  //   { campus_id, security_code | ids, by? }             the older shape, still accepted. A code that matches more
  //       than one family is refused (a code is only ever typed live); a mixed list of ids is recorded and flagged.
  // Who released is always what the server knows (the iPad's name or the signed-in account), never the `by` text.
  r.post('/checkin/checkout', requireCheckin, currentApp, (req, res) => {
    const c = campus(req, req.body?.campus_id);
    const b = req.body || {};
    const mode = b.mode === undefined ? null : oneOf(b.mode, ['request', 'report'], null);
    if (b.mode !== undefined && !mode) throw bad('That isn’t a kind of check-out.');
    if (mode && b.security_code) throw bad('Choose the children to check out.');
    const day = localNow(c.timezone).date;
    const claimed = str(b.by, 100);
    const station = req.user.station;
    const by = (station ? station.name : req.user.name) || '';
    const actor = { device: station ? station.id : null, user: station ? null : req.user.id ?? null };
    const path = !mode && b.security_code ? 'code' : 'ids';
    const code = path === 'code' ? str(b.security_code, 8).toUpperCase() : '';
    const claimedHousehold = mode === 'request' ? int(b.household_id, 'Family') : null;
    const given = Array.isArray(b.ids) ? b.ids : [];
    if (given.length > 500) throw bad('Too many at once.');
    if (mode === 'request' && !given.length) throw bad('Choose the children to check out.');
    const reportAt = mode === 'report' && typeof b.at === 'string' && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at) : null;
    // How long a reported release waited before it reached the hub (seconds), so a report sent "now" by an online
    // iPad, or one with a made-up time, stands out in the record. No usable time at all is marked no_time.
    const timing = mode !== 'report' ? {} : reportAt ? { lag_s: Math.round((Date.now() - reportAt.getTime()) / 1000) } : { no_time: true };
    const modeDetail = mode ? { mode, ...timing } : {};
    // A few rows per actor per campus per day for the same kind of event, so a loop can't flood the record.
    const todayCount = (action) => {
      const who = station ? ['device_id', station.id] : ['user_id', req.user.id];
      return db.prepare(`SELECT COUNT(*) n FROM checkin_events WHERE campus_id = ? AND day = ? AND action = ? AND ${who[0]} = ?`).get(c.id, day, action, who[1]).n;
    };
    let rows;
    if (path === 'code') {
      rows = db.prepare('SELECT id FROM checkins WHERE campus_id = ? AND day = ? AND security_code = ? AND checked_out_at IS NULL AND voided_at IS NULL')
        .all(c.id, day, code);
      if (!rows.length) {
        const misses = todayCount('checkout.code_miss');
        if (misses < CODE_MISS_ROWS) recordEvent(db, req, { action: 'checkout.code_miss', campusId: c.id, code, detail: { attempt: misses + 1, last_recorded: misses + 1 === CODE_MISS_ROWS } });
        throw notFound('A checked-in child with that code');
      }
    } else {
      rows = [...new Set(given.map((id) => str(id, 64)))].map((id) => ({ id }));
    }
    const upd = db.prepare(`UPDATE checkins SET checked_out_at = ?, checked_out_by = ?, checked_out_device_id = ?, checked_out_user_id = ?, client_checked_out_at = ?
      WHERE id = ? AND campus_id = ? AND checked_out_at IS NULL AND voided_at IS NULL`);
    const find = db.prepare(`SELECT ci.id, ci.person_id, ci.security_code, ci.checked_in_at, ci.checked_out_at, p.household_id, h.name household_name, h.campus_id household_campus
      FROM checkins ci LEFT JOIN people p ON p.id = ci.person_id LEFT JOIN households h ON h.id = p.household_id WHERE ci.id = ? AND ci.campus_id = ? AND ci.voided_at IS NULL`);
    const familyOf = (x) => x.household_id ?? `p${x.person_id}`;
    const nowDate = new Date();
    const now = nowDate.toISOString();
    // When a reported release really happened: the iPad's time, but never in the future and never before the check-in.
    const releasedAt = (ci) => {
      if (!reportAt) return { at: now, clamped: false };
      let t = reportAt.getTime();
      const low = Date.parse(ci.checked_in_at);
      if (t > nowDate.getTime()) t = nowDate.getTime();
      if (!Number.isNaN(low) && t < low) t = low;
      return { at: new Date(t).toISOString(), clamped: t !== reportAt.getTime() };
    };
    let count = 0;
    let refusal = null;
    tx(db, () => {
      const known = [];
      const unknown = [];
      for (const row of rows) {
        const ci = find.get(row.id, c.id);
        if (ci) known.push(ci); else unknown.push(row.id);
      }
      // The guard. A live request, or a typed code, may release one family only.
      if (mode === 'request' || path === 'code') {
        const open = known.filter((x) => x.checked_out_at == null);
        const families = new Map();
        for (const x of open) families.set(familyOf(x), [...(families.get(familyOf(x)) || []), x]);
        const reason = families.size > 1 ? (path === 'code' ? 'code_two_families' : 'two_families')
          : claimedHousehold != null && open.some((x) => x.household_id !== claimedHousehold) ? 'household_mismatch' : null;
        if (reason) {
          // A family that has since moved to another campus is not named here (the same rule as GET /checkin/active);
          // the children are still held back and listed by check-in id.
          const shown = (x) => x.household_campus == null || x.household_campus === c.id;
          refusal = { reason, families: [...families.values()].map((list) => ({ household_id: shown(list[0]) ? list[0].household_id : null, name: shown(list[0]) ? list[0].household_name : null, check_in_ids: list.map((x) => x.id) })) };
          const rows = todayCount('checkout.refused');
          if (rows < REFUSED_ROWS) {
            const households = [...new Set(open.map((x) => x.household_id).filter((h) => h != null))];
            recordEvent(db, req, { action: 'checkout.refused', campusId: c.id, code, detail: { reason, path, ...modeDetail, attempt: rows + 1, last_recorded: rows + 1 === REFUSED_ROWS, count: open.length, family_count: families.size,
              households: households.slice(0, 20), claimed_household: claimedHousehold, checkin_ids: open.slice(0, 20).map((x) => x.id), truncated: open.length > 20 || households.length > 20 } });
            audit(db, req, 'checkin.checkout.refused', { campus_id: c.id, reason, device_id: actor.device, device_name: station?.name ?? '', families: families.size, count: open.length });
          }
          return;
        }
      }
      const released = [];
      const repeats = [];
      for (const ci of known) {
        const when = releasedAt(ci);
        if (Number(upd.run(when.at, by, actor.device, actor.user, reportAt ? reportAt.toISOString() : null, ci.id, c.id).changes) !== 1) {
          repeats.push(ci);
          continue;
        }
        count += 1;
        released.push(ci);
        recordEvent(db, req, { action: 'checkout', campusId: c.id, checkinId: ci.id, personId: ci.person_id, householdId: ci.household_id, code: ci.security_code, clientAt: reportAt?.toISOString(),
          detail: { path, ...modeDetail, ...(mode && !claimed ? {} : { by_claimed: claimed }), ...(when.clamped ? { time_adjusted: true } : {}) } });
      }
      // Children already released: one summary row per request (count and the first 20 ids), like unknown ids.
      if (repeats.length) recordEvent(db, req, { action: 'checkout.repeat', campusId: c.id, checkinId: repeats[0].id, personId: repeats[0].person_id, householdId: repeats[0].household_id,
        detail: { path, ...modeDetail, count: repeats.length, ids: repeats.slice(0, 20).map((x) => x.id) } });
      // Ids not found at this campus: one summary row per request, not one per id.
      if (unknown.length) recordEvent(db, req, { action: 'checkout.unknown', campusId: c.id, checkinId: unknown[0], detail: { path, ...modeDetail, count: unknown.length, ids: unknown.slice(0, 20) } });
      // Children of more than one family released together (an offline report, or the older shape from an old iPad)
      // can't be undone, so it is recorded and flagged for a person to look at.
      const families = new Set(released.map(familyOf));
      if (families.size > 1) {
        const households = [...new Set(released.map((x) => x.household_id).filter((h) => h != null))];
        recordEvent(db, req, { action: 'checkout.mixed', campusId: c.id, code,
          detail: { path, ...modeDetail, count: released.length, household_count: households.length, households: households.slice(0, 20), checkin_ids: released.slice(0, 20).map((x) => x.id), truncated: released.length > 20 || households.length > 20 } });
        audit(db, req, 'checkin.checkout.mixed', { campus_id: c.id, device_id: actor.device, device_name: station?.name ?? '', families: families.size, count: released.length, mode: mode || 'legacy' });
      }
    });
    if (refusal) {
      return res.status(409).json({
        error: refusal.reason === 'household_mismatch' ? 'Those children aren’t all in the same family. Check out one family at a time.'
          : 'This code matches children from more than one family. Check ID and choose one family’s children at a time.',
        reason: refusal.reason, families: refusal.families,
      });
    }
    res.json({ checked_out: count });
  });

  // A check-in is never deleted: the database refuses (migration 42). A mistake is voided, which hides it
  // from every list and keeps it, with who and why, for the record. DELETE says so and points here.
  r.delete('/checkin/checkins/:id', requireCheckin, currentApp, (req, res) => {
    const ci = db.prepare('SELECT campus_id FROM checkins WHERE id = ?').get(req.params.id);
    if (!ci) throw notFound('Check-in');
    if (!canCampus(req.user, ci.campus_id)) throw forbidden();
    res.set('Allow', 'POST').status(405).json({ error: 'A check-in can’t be deleted, because it’s part of the record. Use “Void” instead and say why.' });
  });

  // Void a check-in (body: { reason }). Staff, admins and authorised leaders signed in to the Hub, never an iPad,
  // so the record always names a person. Not allowed while a legal hold is on.
  r.post('/checkin/checkins/:id/void', requireCheckin, (req, res) => {
    if (req.user.station) throw new HttpError(403, 'An iPad can’t void a check-in. Ask a staff member to void it from the Hub.');
    const ci = db.prepare('SELECT ci.*, p.household_id FROM checkins ci LEFT JOIN people p ON p.id = ci.person_id WHERE ci.id = ?').get(req.params.id);
    if (!ci) throw notFound('Check-in');
    if (!canCampus(req.user, ci.campus_id)) throw forbidden();
    const reason = str(req.body?.reason, 300);
    if (!reason) throw bad('Say why you’re voiding this check-in.');
    if (legalHold(db).on) throw new HttpError(409, HOLD_MSG);
    if (ci.voided_at) throw new HttpError(409, 'That check-in is already voided.');
    tx(db, () => {
      db.prepare('UPDATE checkins SET voided_at = ?, voided_by = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL')
        .run(new Date().toISOString(), req.user.id, String(req.user.name || '').slice(0, 100), reason, ci.id);
      // The reason stays on the check-in; the event holds only ids and codes, never free text.
      recordEvent(db, req, { action: 'checkin.void', campusId: ci.campus_id, checkinId: ci.id, personId: ci.person_id, householdId: ci.household_id, code: ci.security_code,
        detail: { kind: ci.kind, room_id: ci.room_id, service_id: ci.service_id, day: ci.day, checked_in_at: ci.checked_in_at, checked_out_at: ci.checked_out_at } });
      audit(db, req, 'checkin.void', { checkin_id: ci.id, campus_id: ci.campus_id, person_id: ci.person_id, day: ci.day });
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- the check-in record and safety switches
  // What happened at one campus on one day, oldest first. Staff and admins only, never a station.
  r.get('/checkin/events', requireRole('staff'), (req, res) => {
    if (req.user.station) throw forbidden();
    const c = campus(req, req.query.campus_id);
    if (!isDate(req.query.day)) throw bad('Pick a day like 2027-02-21.');
    const args = [c.id, req.query.day];
    let extra = '';
    if (req.query.action !== undefined) {
      if (!ACTIONS.includes(req.query.action)) throw bad('That isn’t a kind of check-in event.');
      extra = ' AND e.action = ?';
      args.push(req.query.action);
    }
    const rows = db.prepare(`SELECT e.*, p.first_name, p.last_name FROM checkin_events e LEFT JOIN people p ON p.id = e.person_id
      WHERE e.campus_id = ? AND e.day = ?${extra} ORDER BY e.id LIMIT 5001`).all(...args);
    audit(db, req, 'checkin.events.view', { campus_id: c.id, day: req.query.day });
    // Pickup codes are only live on the day; staff already see today's, so earlier days show them masked.
    const past = req.query.day < localNow(c.timezone).date;
    res.json({ events: rows.slice(0, 5000).map((e) => ({ ...e, security_code: past && e.security_code ? '••••' : e.security_code, detail: JSON.parse(e.detail) })), truncated: rows.length > 5000 });
  });

  const safetyView = () => {
    const h = legalHold(db);
    return { require_current_app: safetySettings(db).require_current_app, current_app_version: CHECKIN_APP_VERSION,
      legal_hold: { on: h.on, reason: h.on ? h.reason : '', set_by_name: h.set_by_name, set_at: h.set_at, released_at: h.released_at, released_by_name: h.released_by_name, cooling_off_days: HOLD_COOLING_DAYS } };
  };
  r.get('/checkin/safety', requireRole('admin'), (_req, res) => res.json(safetyView()));

  // The legal hold: when an allegation, claim or subpoena arrives, an admin who covers every campus sets it first.
  // While it is on, check-ins can't be voided, people can't be merged and no backup copy is deleted. Setting and
  // releasing both need a reason, are audited, and tell every admin.
  const tellAdmins = (title, body) => notify(db, db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id),
    { kind: 'safety', title, body, url: '/#/stations' });
  r.post('/checkin/legal-hold', requireRole('admin'), requireAllCampuses, (req, res) => {
    const reason = str(req.body?.reason, 300);
    if (!reason) throw bad('Say why you’re putting a legal hold on.');
    if (legalHold(db).on) throw new HttpError(409, 'A legal hold is already on.');
    const at = new Date().toISOString();
    tx(db, () => {
      saveHold(db, { on: true, reason, set_by: req.user.id, set_by_name: String(req.user.name || '').slice(0, 100), set_at: at });
      audit(db, req, 'checkin.legal_hold.set', { reason });
      recordEvent(db, req, { action: 'safety.settings', detail: { legal_hold: 'set' } });
    });
    tellAdmins('A legal hold is on', `${req.user.name || 'An admin'} put a legal hold on. Nothing is voided, merged or cleaned up until it’s released.`);
    res.status(201).json(safetyView());
  });

  r.post('/checkin/legal-hold/release', requireRole('admin'), requireAllCampuses, (req, res) => {
    const reason = str(req.body?.reason, 300);
    if (!reason) throw bad('Say why you’re releasing the legal hold.');
    const was = legalHold(db);
    if (!was.on) throw new HttpError(409, 'There’s no legal hold on.');
    tx(db, () => {
      saveHold(db, { ...was, on: false, released_at: new Date().toISOString(), released_by: req.user.id, released_by_name: String(req.user.name || '').slice(0, 100), release_reason: reason });
      audit(db, req, 'checkin.legal_hold.release', { reason, set_at: was.set_at });
      recordEvent(db, req, { action: 'safety.settings', detail: { legal_hold: 'released' } });
    });
    tellAdmins('The legal hold was released', `${req.user.name || 'An admin'} released it. Old backup copies are kept for ${HOLD_COOLING_DAYS} more days.`);
    res.json(safetyView());
  });

  // Body: { require_current_app: boolean }. Stricter than PATCH /settings: unknown keys and wrong types are refused.
  r.patch('/checkin/safety', requireRole('admin'), requireAllCampuses, (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const keys = Object.keys(b);
    if (!keys.length) throw bad('Nothing to change.');
    for (const k of keys) {
      if (!Object.hasOwn(SAFETY_TYPES, k)) throw bad(`“${k.slice(0, 40)}” isn’t a check-in safety setting.`);
      if (typeof b[k] !== SAFETY_TYPES[k]) throw bad(`Invalid value for ${k}.`);
    }
    const from = safetySettings(db);
    const to = { ...from, ...b };
    tx(db, () => {
      setSetting(db, 'checkin_safety', to);
      audit(db, req, 'checkin.safety', { from, to });
      recordEvent(db, req, { action: 'safety.settings', detail: { from, to } });
    });
    res.json(safetyView());
  });

  // ---------------------------------------------------------------- attendance
  r.put('/services/:id/headcounts', requireAttendance, (req, res) => {
    const s = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('Service');
    if (!canAttendCampus(db, req.user, s.campus_id)) throw forbidden();
    const counts = req.body?.counts || {};
    tx(db, () => {
      for (const [area, value] of Object.entries(counts)) {
        const n = int(value, `${area} count`);
        if (n == null) db.prepare('DELETE FROM headcounts WHERE service_id = ? AND area = ?').run(s.id, str(area, 60));
        else if (n < 0) throw bad('Counts can’t be negative.');
        else db.prepare('INSERT INTO headcounts (service_id, area, count) VALUES (?, ?, ?) ON CONFLICT(service_id, area) DO UPDATE SET count = excluded.count').run(s.id, str(area, 60), n);
      }
    });
    // Attendance-only accounts have no time limit, so a change after the service's own date is audited.
    if (rank(req.user.role) < rank('leader')) {
      const tz = db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(s.campus_id)?.timezone || 'UTC';
      if (localNow(tz).date > s.starts_at.slice(0, 10)) audit(db, req, 'headcount.correct', { service_id: s.id, counts });
    }
    res.json(db.prepare('SELECT area, count FROM headcounts WHERE service_id = ?').all(s.id));
  });

  // Weekly totals per campus: counted adults and students (headcount or names) plus kids checked in.
  r.get('/attendance/weekly', requireRole('leader'), (req, res) => {
    const weeks = Math.min(int(req.query.weeks) ?? 12, 104);
    const from = new Date(Date.now() - weeks * 7 * 864e5).toISOString().slice(0, 10);
    const cf = campusFilter(req.user, 's.campus_id');
    // Weeks start on Sunday: the date of that Sunday labels the week.
    const week = (col) => `date(${col}, '-' || strftime('%w', ${col}) || ' days')`;
    // "Counted" per service: the headcount total when one was entered, otherwise the names on the roll
    // minus anyone also checked in as a kid at that service (so no one counts twice). A week's source is
    // 'headcount', 'names' or 'mixed' when some services used each. `adults` keeps its old name for the
    // page: it is the counted total per campus and week.
    const perService = db.prepare(`SELECT s.id, s.campus_id, ${week('substr(s.starts_at, 1, 10)')} week,
        (SELECT COUNT(*) FROM headcounts h WHERE h.service_id = s.id) areas,
        (SELECT COALESCE(SUM(h.count), 0) FROM headcounts h WHERE h.service_id = s.id) headcount,
        (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id
           AND a.person_id NOT IN (SELECT person_id FROM checkins k WHERE k.service_id = s.id AND k.kind = 'kid' AND k.voided_at IS NULL)) names
      FROM services s WHERE s.starts_at >= ? AND ${cf.sql}`).all(from, ...cf.args);
    const byWeek = new Map();
    for (const sv of perService) {
      const key = `${sv.campus_id}|${sv.week}`;
      const w = byWeek.get(key) || { campus_id: sv.campus_id, week: sv.week, total: 0, kinds: new Set() };
      if (sv.areas > 0) { w.total += sv.headcount; w.kinds.add('headcount'); }
      else if (sv.names > 0) { w.total += sv.names; w.kinds.add('names'); }
      byWeek.set(key, w);
    }
    const adults = [...byWeek.values()].filter((w) => w.kinds.size).map((w) => ({ campus_id: w.campus_id, week: w.week, total: w.total }));
    const source = [...byWeek.values()].filter((w) => w.kinds.size).map((w) => ({ campus_id: w.campus_id, week: w.week, source: w.kinds.size > 1 ? 'mixed' : [...w.kinds][0] }));
    const cf2 = campusFilter(req.user, 'ci.campus_id');
    const kids = db.prepare(`SELECT ci.campus_id, ${week('ci.day')} week, COUNT(*) total
      FROM checkins ci WHERE ci.day >= ? AND ci.kind = 'kid' AND ci.voided_at IS NULL AND ${cf2.sql} GROUP BY 1, 2`).all(from, ...cf2.args);
    const volunteers = db.prepare(`SELECT s.campus_id, ${week('substr(s.starts_at, 1, 10)')} week, COUNT(DISTINCT a.person_id) total
      FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.status = 'accepted' AND s.starts_at >= ? AND s.starts_at <= datetime('now') AND ${cf.sql} GROUP BY 1, 2`).all(from, ...cf.args);
    const marked = db.prepare(`SELECT s.campus_id, ${week('substr(s.starts_at, 1, 10)')} week, COUNT(DISTINCT a.person_id) total
      FROM attendance a JOIN services s ON s.id = a.service_id WHERE s.starts_at >= ? AND ${cf.sql} GROUP BY 1, 2`).all(from, ...cf.args);
    res.json({ from, adults, kids, volunteers, marked, source });
  });

  // One attendance number per service, for looking back (the dashboard on the Attendance page).
  // Rule: (sum of the service's headcounts if any were entered, otherwise the distinct people marked
  // present in roll call) + kids checked in. A person marked present who was also checked in as a kid
  // at that service is not counted twice. Weeks start on Sunday. Query: year=YYYY, or weeks=N (default
  // 12, up to 104); optional campus_id and service_time=HH:MM. The same weeks a year earlier come back
  // as prev_week/prev_total (52 weeks before, so Sundays line up).
  r.get('/attendance/summary', requireRole('leader'), (req, res) => {
    const campusId = int(req.query.campus_id);
    if (campusId != null && !canCampus(req.user, campusId)) throw forbidden();
    const time = req.query.service_time ? str(req.query.service_time, 5) : '';
    if (time && !/^\d\d:\d\d$/.test(time)) throw bad('Pick a service time like 10:00.');
    const iso = (d) => d.toISOString().slice(0, 10);
    const addDays = (d, n) => iso(new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5));
    const sundayOf = (d) => addDays(d, -new Date(`${d}T12:00:00Z`).getUTCDay());
    const thisSunday = sundayOf(iso(new Date()));
    const year = int(req.query.year);
    let first; let last; // first and last Sunday shown
    if (year != null) {
      if (year < 2000 || year > 2100) throw bad('Pick a year between 2000 and 2100.');
      const s0 = sundayOf(`${year}-01-01`);
      first = s0 < `${year}-01-01` ? addDays(s0, 7) : s0;
      last = sundayOf(`${year}-12-31`);
      if (last > thisSunday) last = thisSunday;
    } else {
      const weeks = Math.min(Math.max(int(req.query.weeks) ?? 12, 1), 104);
      last = thisSunday;
      first = addDays(last, -(weeks - 1) * 7);
    }
    const weekList = [];
    for (let w = first; w <= last; w = addDays(w, 7)) weekList.push(w);
    const prevOf = (w) => addDays(w, -364);
    const lo = prevOf(first); // the year before starts earlier
    const hi = addDays(last, 6);

    const cf = campusFilter(req.user, 's.campus_id');
    const scope = `${cf.sql}${campusId != null ? ' AND s.campus_id = ?' : ''}`;
    const scopeArgs = [...cf.args, ...(campusId != null ? [campusId] : [])];
    const range = 'substr(s.starts_at, 1, 10) BETWEEN ? AND ?';
    const base = [lo, hi, ...scopeArgs];
    // Four grouped queries for the whole range, joined here by service id.
    const services = db.prepare(`SELECT s.id, s.campus_id, c.name campus, c.short_name campus_short, s.title, s.starts_at
      FROM services s JOIN campuses c ON c.id = s.campus_id WHERE ${range} AND ${scope} ORDER BY s.starts_at, s.id LIMIT 5000`).all(...base);
    const headcounts = new Map(db.prepare(`SELECT h.service_id id, SUM(h.count) total FROM headcounts h JOIN services s ON s.id = h.service_id
      WHERE ${range} AND ${scope} GROUP BY h.service_id`).all(...base).map((x) => [x.id, x.total]));
    const kids = new Map(db.prepare(`SELECT k.service_id id, COUNT(DISTINCT k.person_id) n FROM checkins k JOIN services s ON s.id = k.service_id
      WHERE k.kind = 'kid' AND k.voided_at IS NULL AND ${range} AND ${scope} GROUP BY k.service_id`).all(...base).map((x) => [x.id, x.n]));
    const marked = new Map(db.prepare(`SELECT a.service_id id, COUNT(DISTINCT a.person_id) n FROM attendance a JOIN services s ON s.id = a.service_id
      WHERE ${range} AND ${scope}
        AND NOT EXISTS (SELECT 1 FROM checkins k WHERE k.service_id = a.service_id AND k.person_id = a.person_id AND k.kind = 'kid' AND k.voided_at IS NULL)
      GROUP BY a.service_id`).all(...base).map((x) => [x.id, x.n]));

    const rows = [];
    const times = new Set();
    for (const s of services) {
      const hc = headcounts.get(s.id);
      const m = marked.get(s.id) || 0;
      const k = kids.get(s.id) || 0;
      if (hc == null && !m && !k) continue; // nothing recorded for this service
      const t = s.starts_at.slice(11, 16);
      const date = s.starts_at.slice(0, 10);
      if (date >= first) times.add(t);
      if (time && t !== time) continue;
      rows.push({ id: s.id, date, week: sundayOf(date), time: t, campus_id: s.campus_id, campus: s.campus, campus_short: s.campus_short, title: s.title,
        attendance: (hc ?? m) + k, source: hc != null ? 'headcount' : m ? 'roll' : 'kids', headcount: hc ?? null, marked: m, kids: k });
    }
    const perWeek = new Map();
    for (const x of rows) perWeek.set(x.week, (perWeek.get(x.week) || 0) + x.attendance);
    const weeksOut = weekList.map((w) => ({ week: w, total: perWeek.get(w) ?? null, prev_week: prevOf(w), prev_total: perWeek.get(prevOf(w)) ?? null }));
    const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);
    const have = weeksOut.filter((w) => w.total != null);
    const avgNow = avg(have.map((w) => w.total));
    const avgPrev = avg(weeksOut.filter((w) => w.prev_total != null).map((w) => w.prev_total));
    // "This month" is the calendar month of the latest Sunday that has a number.
    const month = have.length ? have[have.length - 1].week.slice(0, 7) : null;
    const best = have.reduce((b, w) => (!b || w.total > b.total ? w : b), null);
    const stats = {
      average: avgNow, previous_average: avgPrev,
      change_pct: avgNow != null && avgPrev ? Math.round(((avgNow - avgPrev) / avgPrev) * 1000) / 10 : null,
      month, month_average: month ? avg(have.filter((w) => w.week.startsWith(month)).map((w) => w.total)) : null,
      highest: best ? { week: best.week, total: best.total } : null,
      weeks_with_numbers: have.length,
    };
    const years = db.prepare(`SELECT DISTINCT substr(s.starts_at, 1, 4) y FROM services s WHERE ${scope} AND (
        EXISTS (SELECT 1 FROM headcounts h WHERE h.service_id = s.id) OR EXISTS (SELECT 1 FROM attendance a WHERE a.service_id = s.id)
        OR EXISTS (SELECT 1 FROM checkins k WHERE k.service_id = s.id AND k.kind = 'kid' AND k.voided_at IS NULL)) ORDER BY y DESC`).all(...scopeArgs);
    res.json({ from: first, to: last, year: year ?? null, weeks: weeksOut, stats,
      services: rows.filter((x) => x.date >= first).reverse(), service_times: [...times].sort(), years: years.map((x) => Number(x.y)) });
  });

  return r;
}
