// Protected history: check-ins and past serving records are kept, never deleted (migration 42 makes
// the database itself refuse). This file holds the one definition of "past" and "kept" that the routes
// share with those triggers, so a route can say no politely before the database has to, and the legal
// hold that pauses every clean-up. See docs/database.md → Protected history.
import { getSetting, setSetting } from './db.js';

// A service counts as past when it started up to 14 hours from now (UTC). starts_at is the campus's
// local time, and no time zone is more than 14 hours from UTC, so this is past everywhere. It matches
// the triggers in migration 42 word for word; change one and you must change the other.
export const PAST_CUTOFF = "strftime('%Y-%m-%dT%H:%M', 'now', '+14 hours')";

// Two windows, on purpose. DELETES use "now + 14 hours" (a service that starts within a day is already protected, whatever
// the time zone). UPDATES (retime, change a status) use "now - 14 hours": a service that started at least 14 hours ago is past in
// every US time zone, so leaders can still correct tomorrow's service or a Saturday-night decline without a workaround.
export const PAST_CUTOFF_BACK = "strftime('%Y-%m-%dT%H:%M', 'now', '-14 hours')";

// SQL for "this service has serving, roll-call, headcount or check-in records". `s` is the alias of the services table.
const recordsSql = (s) => `(
    EXISTS (SELECT 1 FROM assignments ka WHERE ka.service_id = ${s}.id AND (ka.status = 'accepted' OR ka.sent_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM attendance kt WHERE kt.service_id = ${s}.id)
    OR EXISTS (SELECT 1 FROM headcounts kh WHERE kh.service_id = ${s}.id)
    OR EXISTS (SELECT 1 FROM checkins kc WHERE kc.service_id = ${s}.id))`;

// SQL for "this service is past and has records" (can't be deleted). `s` is the alias of the services table.
export const serviceKeptSql = (s = 's') => `(${s}.starts_at <= ${PAST_CUTOFF} AND ${recordsSql(s)})`;

// A service that began 14+ hours ago, with records, can't be moved to a later time (it would stop being past, and could then be deleted).
export const serviceRetimeKept = (db, serviceId, newStartsAt) => Boolean(db.prepare(
  `SELECT 1 FROM services s WHERE s.id = ? AND s.starts_at <= ${PAST_CUTOFF_BACK} AND ? > ${PAST_CUTOFF_BACK} AND ${recordsSql('s')}`).get(serviceId, newStartsAt));

// An accepted assignment on a service that began 14+ hours ago: its status is part of the record.
export const assignmentFrozen = (db, assignmentId) => Boolean(db.prepare(
  `SELECT 1 FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.id = ? AND a.status = 'accepted' AND s.starts_at <= ${PAST_CUTOFF_BACK}`).get(assignmentId));

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
  restatus: 'This person already served at that service, so their answer can’t be changed. It’s kept in the record.',
  retime: 'This service has already happened and has records, so it can’t be moved to a later time. It’s kept in the record.',
  // Migration 45: check-in holds and who collected a child.
  holdDelete: 'Holds are kept for the record, so they can’t be deleted. Lift the hold instead.',
  holdOrigin: 'Who a hold is for, where and when it was placed can’t be changed.',
  holdFinal: 'A lifted hold stays lifted. Place a new hold instead.',
  personHold: 'This person has a check-in hold on record, so they’re kept in the record. Archive them instead.',
  collector: 'Who collected a child is part of the record and can’t be changed.',
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
