// The kids' check-in record: an append-only log of what happened at check-in (who was checked in
// and out, by which iPad or account, on what day). It holds plain ids and name snapshots, never
// medical text, phone numbers, addresses or birthdates, so it can outlive the people it mentions.
// Call recordEvent inside the same tx() as the change it records, so both are stored or neither.
import { bad, localNow } from './http.js';

export const ACTIONS = [
  'checkin', 'checkin.skipped', 'checkin.delete',
  'checkout', 'checkout.mixed', 'checkout.repeat', 'checkout.unknown', 'checkout.code_miss',
  'roster.download',
  'device.pair', 'device.update', 'device.remove',
  'version.refused', 'safety.settings',
];

const DETAIL_MAX = 2000;
// The only free text a client may supply, with its length limits. Everything else in `detail` is
// written by the server from ids and codes.
const CLIENT_TEXT = { by_claimed: 100, station_label: 60 };

// The check-in app version an iPad reports in x-checkin-version: whole numbers only, else ''.
export function appVersion(req) {
  const v = req.get?.('x-checkin-version');
  return typeof v === 'string' && /^\d{1,6}$/.test(v) ? v : '';
}

const iso = (v) => {
  if (typeof v !== 'string' || !v || Number.isNaN(Date.parse(v))) return null;
  return new Date(v).toISOString();
};

// opts: { action, campusId, checkinId, personId, householdId, code, clientAt, detail, deviceId, deviceName }
// deviceId/deviceName name the station an event is about when the actor is a staff member (pairing).
export function recordEvent(db, req, opts) {
  const { action } = opts;
  if (!ACTIONS.includes(action)) throw new Error(`Unknown check-in event: ${action}`);
  const detail = { ...(opts.detail || {}) };
  for (const [k, max] of Object.entries(CLIENT_TEXT)) if (typeof detail[k] === 'string') detail[k] = detail[k].slice(0, max);
  const json = JSON.stringify(detail);
  if (json.length > DETAIL_MAX) throw bad('That check-in record is too long.');
  const now = new Date();
  const campusId = opts.campusId ?? null;
  let day = null;
  if (campusId != null) {
    const c = db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(campusId);
    day = localNow(c?.timezone || 'UTC', now).date;
  }
  const station = req.user?.station;
  const hubUser = !station && req.user?.id != null ? req.user : null;
  const deviceId = opts.deviceId ?? station?.id ?? null;
  const deviceName = opts.deviceName ?? station?.name ?? '';
  const info = db.prepare(`INSERT INTO checkin_events
      (at, day, client_at, campus_id, action, checkin_id, person_id, household_id, security_code, device_id, device_name, user_id, user_name, app_version, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(now.toISOString(), day, iso(opts.clientAt), campusId, action, opts.checkinId ?? null, opts.personId ?? null, opts.householdId ?? null,
      String(opts.code || '').slice(0, 8), deviceId, String(deviceName).slice(0, 60), hubUser?.id ?? null, hubUser ? String(hubUser.name || '').slice(0, 100) : '',
      appVersion(req), json);
  return Number(info.lastInsertRowid);
}

// True when this actor (the station, or the signed-in account) already has a row for the action at
// this campus today. Used to write roster downloads and refused versions once a day, not on every poll.
export function recordedToday(db, req, action, campusId) {
  const c = db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(campusId);
  const day = localNow(c?.timezone || 'UTC').date;
  const station = req.user?.station;
  return Boolean(db.prepare(`SELECT 1 FROM checkin_events WHERE campus_id = ? AND day = ? AND action = ? AND ${station ? 'device_id' : 'user_id'} = ?`)
    .get(campusId, day, action, station ? station.id : req.user.id));
}
