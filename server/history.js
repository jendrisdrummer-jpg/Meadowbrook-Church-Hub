// Protected history: check-ins and past serving records are kept, never deleted (migration 42 makes
// the database itself refuse). This file holds the one definition of "past" and "kept" that the routes
// share with those triggers, so a route can say no politely before the database has to, and the legal
// hold that pauses every clean-up. See docs/database.md → Protected history.
import { getSetting, setSetting } from './db.js';

// A service counts as past when it started up to 14 hours from now (UTC). starts_at is the campus's
// local time, and no time zone is more than 14 hours from UTC, so this is past everywhere. It matches
// the triggers in migration 42 word for word; change one and you must change the other.
export const PAST_CUTOFF = "strftime('%Y-%m-%dT%H:%M', 'now', '+14 hours')";

// SQL for "this service is past and has serving, roll-call, headcount or check-in records". `s` is the
// alias of the services table.
export const serviceKeptSql = (s = 's') => `(${s}.starts_at <= ${PAST_CUTOFF} AND (
    EXISTS (SELECT 1 FROM assignments ka WHERE ka.service_id = ${s}.id AND (ka.status = 'accepted' OR ka.sent_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM attendance kt WHERE kt.service_id = ${s}.id)
    OR EXISTS (SELECT 1 FROM headcounts kh WHERE kh.service_id = ${s}.id)
    OR EXISTS (SELECT 1 FROM checkins kc WHERE kc.service_id = ${s}.id)))`;

// SQL for "this accepted assignment is for a past service". `a` is the assignments alias, `s` the services alias.
export const assignmentKeptSql = (a = 'a', s = 's') => `(${a}.status = 'accepted' AND ${s}.starts_at <= ${PAST_CUTOFF})`;

export const serviceKept = (db, serviceId) => Boolean(db.prepare(`SELECT 1 FROM services s WHERE s.id = ? AND ${serviceKeptSql('s')}`).get(serviceId));

export const assignmentKept = (db, assignmentId) => Boolean(db.prepare(
  `SELECT 1 FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.id = ? AND ${assignmentKeptSql('a', 's')}`).get(assignmentId));

// Anyone has served in this position at a service that is past.
export const positionKept = (db, positionId) => Boolean(db.prepare(
  `SELECT 1 FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.position_id = ? AND s.starts_at <= ${PAST_CUTOFF} LIMIT 1`).get(positionId));

// The words the database's triggers use (migration 42). The error handler turns these into a plain 409
// instead of "something went wrong", so no screen can ever show a raw database error for them.
export const MSG = {
  checkin: 'Check-ins are kept for the record, so they can’t be deleted. Void it instead and say why.',
  voidFinal: 'A voided check-in stays voided.',
  assignment: 'This person already served at that service, so it’s kept in the record.',
  service: 'This service has already happened (or has serving or check-in records), so it’s kept in the record.',
  position: 'People have served in this position, so it’s kept in the record.',
  person: 'This person has check-in or serving records, so they’re kept in the record. Archive them instead.',
};
export const isHistoryError = (err) => err?.code === 'ERR_SQLITE_ERROR' && Object.values(MSG).includes(err.message);

// ---------------------------------------------------------------- legal hold
// One switch for V1, kept in the check-in safety setting: while it is on, a check-in can't be voided,
// people can't be merged, and old backup copies aren't deleted. An admin who covers every campus
// sets and releases it, each time with a reason, and every change is audited. After a release, backup
// copies made during the hold are still kept for 7 more days (a cooling-off, in case it was a mistake).
export const HOLD_COOLING_DAYS = 7;
const empty = { on: false, reason: '', set_by: null, set_by_name: '', set_at: null, released_at: null, released_by: null, released_by_name: '', release_reason: '' };

export const legalHold = (db) => ({ ...empty, ...(getSetting(db, 'checkin_safety', {}).legal_hold || {}) });

// True while a clean-up of backup copies must wait: the hold is on, or was released less than 7 days ago.
export function backupPruningPaused(db, now = new Date()) {
  const h = legalHold(db);
  if (h.on) return true;
  return Boolean(h.released_at) && now.getTime() - Date.parse(h.released_at) < HOLD_COOLING_DAYS * 864e5;
}

export function saveHold(db, hold) {
  const all = getSetting(db, 'checkin_safety', {});
  setSetting(db, 'checkin_safety', { ...all, legal_hold: { ...empty, ...hold } });
}

export const HOLD_MSG = 'A legal hold is on, so this can’t be changed right now. An admin can release the hold under Check-in iPads.';
