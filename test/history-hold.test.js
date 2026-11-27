// Protected history, the legal hold (child-safety V1, PR 3): an admin who covers every campus puts it on and
// releases it, each time with a reason, audited and told to every admin. While it is on a check-in can't be
// voided, people can't be merged, Google Drive stays connected, and no backup copy is deleted (nor for 7 days
// after it is released). Dates are fixed or relative to the call, never today's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { makeApp } from './helpers/history-app.js';
import { connectDrive } from '../server/backup.js';
import { backupPruningPaused, legalHold, saveHold, HOLD_MSG } from '../server/history.js';
import { getSetting } from '../server/db.js';

let app, db, call, ids, google;
const calls = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hold-'));
const P = {};

before(async () => {
  app = await makeApp();
  ({ db, call, ids } = app);
  app.make('admin', 'admin', null, 'Ada Admin');
  app.make('admin2', 'admin', null, 'Bo Admin');
  app.make('northadmin', 'admin', '[1]', 'Nora North');
  app.make('staff', 'staff');
  const hh = app.add.household('Aldrin');
  P.kid = app.add.person('Abe', 'Aldrin', hh, 'child');
  P.keep = app.add.person('Kay', 'Keep');
  P.dup = app.add.person('Kay', 'Keepe');
  app.add.checkin('ci-hold-0001', P.kid);
  google = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url });
      const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.url === '/token') return send({ access_token: 'at-1' });
      if (req.method === 'DELETE') return res.writeHead(204).end();
      if (req.method === 'GET') return send({ id: req.url.split('/').pop().split('?')[0], trashed: false });
      send({ id: `f${calls.length}` });
    });
  }).listen(0);
  await new Promise((r) => google.once('listening', r));
  Object.assign(process.env, { MB_BACKUP_PASSWORD: 'hold-test-password', MB_BACKUP_DIR: path.join(dir, 'backups'),
    MB_GOOGLE_API: `http://127.0.0.1:${google.address().port}`, MB_GOOGLE_TOKEN_URL: `http://127.0.0.1:${google.address().port}/token`, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' });
});
after(() => { google.closeAllConnections(); google.close(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('who may set and release it, and what it needs', async () => {
  const off = (await call('admin', 'GET', '/checkin/safety')).data.legal_hold;
  assert.equal(off.on, false);
  assert.equal((await call('northadmin', 'POST', '/checkin/legal-hold', { reason: 'x' })).status, 403, 'an admin limited to one campus');
  assert.equal((await call('staff', 'POST', '/checkin/legal-hold', { reason: 'x' })).status, 403);
  assert.equal((await call(null, 'POST', '/checkin/legal-hold', { reason: 'x' })).status, 401);
  assert.equal((await call('admin', 'POST', '/checkin/legal-hold', {})).status, 400);
  assert.equal((await call('admin', 'POST', '/checkin/legal-hold/release', { reason: 'x' })).status, 409, 'nothing to release yet');
  assert.equal(legalHold(db).on, false);

  const set = await call('admin', 'POST', '/checkin/legal-hold', { reason: 'A claim arrived' });
  assert.equal(set.status, 201);
  assert.deepEqual([set.data.legal_hold.on, set.data.legal_hold.reason, set.data.legal_hold.set_by_name], [true, 'A claim arrived', 'Ada Admin']);
  assert.equal((await call('admin2', 'POST', '/checkin/legal-hold', { reason: 'again' })).status, 409, 'already on');
  // Audited, in the check-in record, and every admin is told.
  assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.legal_hold.set'").get().detail).reason, 'A claim arrived');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM checkin_events WHERE action = 'safety.settings' AND detail LIKE '%set%'").get().n, 1);
  const told = db.prepare("SELECT user_id FROM notifications WHERE kind = 'safety' ORDER BY user_id").all().map((n) => n.user_id);
  assert.deepEqual(told, [ids.admin, ids.admin2, ids.northadmin].sort((a, b) => a - b));
  // Admins limited to a campus can read it but not change it; it isn't in /settings and PATCH /checkin/safety can't touch it.
  assert.equal((await call('northadmin', 'GET', '/checkin/safety')).data.legal_hold.on, true);
  assert.equal((await call('northadmin', 'POST', '/checkin/legal-hold/release', { reason: 'x' })).status, 403);
  assert.equal((await call('admin', 'PATCH', '/checkin/safety', { legal_hold: null })).status, 400);
  assert.ok(!JSON.stringify((await call('admin', 'GET', '/settings')).data).includes('A claim arrived'));
  assert.equal((await call('admin', 'PATCH', '/checkin/safety', { require_current_app: false })).data.legal_hold.on, true, 'other switches leave the hold alone');
});

test('while it is on: no void, no merge, Google Drive stays connected', async () => {
  const voided = await call('staff', 'POST', '/checkin/checkins/ci-hold-0001/void', { reason: 'Mistake' });
  assert.equal(voided.status, 409);
  assert.equal(voided.data.error, HOLD_MSG);
  assert.equal(db.prepare("SELECT voided_at FROM checkins WHERE id = 'ci-hold-0001'").get().voided_at, null);
  const merged = await call('admin', 'POST', `/people/${P.keep}/merge`, { duplicate_id: P.dup });
  assert.equal(merged.status, 409);
  assert.equal(merged.data.error, HOLD_MSG);
  assert.equal(db.prepare('SELECT archived FROM people WHERE id = ?').get(P.dup).archived, 0);
  connectDrive(db, { refresh_token: 'rt-good', email: 'office@church.org' });
  const disconnect = await call('admin', 'DELETE', '/backups/drive');
  assert.equal(disconnect.status, 409);
  assert.match(disconnect.data.error, /legal hold/);
  assert.ok(getSetting(db, 'backup_drive').refresh_token, 'still connected');
});

test('while it is on: backup copies are never deleted, in Drive or on this server', async () => {
  const ins = db.prepare("INSERT INTO backups (name, size, status, drive_id, created_at) VALUES (?, 1, 'ok', ?, ?)");
  for (let d = 1; d <= 30; d++) ins.run(`old-${d}`, `old-${d}`, new Date(Date.now() - d * 864e5).toISOString().replace('T', ' ').slice(0, 19));
  const driveCopies = () => db.prepare("SELECT COUNT(*) n FROM backups WHERE status = 'ok' AND drive_id IS NOT NULL").get().n;
  const before = driveCopies();
  const from = calls.length;
  for (let i = 0; i < 2; i++) assert.equal((await call('admin', 'POST', '/backups/run', {})).status, 201);
  assert.equal(calls.slice(from).filter((c) => c.method === 'DELETE').length, 0, 'nothing removed from Drive');
  assert.equal(driveCopies(), before + 2);
  // Without Google Drive, nothing is deleted from this server's disk either (the hold is what the copies are for).
  db.prepare("UPDATE backups SET drive_id = NULL").run();
  for (let i = 0; i < 3; i++) assert.equal((await call('admin', 'POST', '/backups/run', {})).status, 201);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM backups WHERE local = 1').get().n >= 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM backups WHERE local = 1').get().n, fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('.enc')).length);
});

test('release: needs a reason, is audited, and the 7-day wait keeps copies a little longer', async () => {
  assert.equal((await call('admin', 'POST', '/checkin/legal-hold/release', {})).status, 400);
  const out = await call('admin2', 'POST', '/checkin/legal-hold/release', { reason: 'Matter closed' });
  assert.equal(out.status, 200);
  assert.deepEqual([out.data.legal_hold.on, out.data.legal_hold.released_by_name], [false, 'Bo Admin']);
  assert.equal(legalHold(db).release_reason, 'Matter closed');
  assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_log WHERE action = 'checkin.legal_hold.release'").get().detail).reason, 'Matter closed');
  const released = Date.parse(legalHold(db).released_at);
  assert.equal(backupPruningPaused(db, new Date(released + 6 * 864e5)), true, 'day 6: still kept');
  assert.equal(backupPruningPaused(db, new Date(released + 8 * 864e5)), false, 'day 8: back to normal');
  assert.equal((await call('admin', 'POST', '/checkin/legal-hold/release', { reason: 'again' })).status, 409);
  // Voiding and merging work again straight away; Drive can be disconnected.
  assert.equal((await call('staff', 'POST', '/checkin/checkins/ci-hold-0001/void', { reason: 'Mistake' })).status, 200);
  assert.equal((await call('admin', 'POST', `/people/${P.keep}/merge`, { duplicate_id: P.dup })).status, 200);
});

test('after the wait, old copies are cleaned up as before', async () => {
  // Day 8 after release.
  saveHold(db, { ...legalHold(db), released_at: new Date(Date.now() - 8 * 864e5).toISOString() });
  assert.equal(backupPruningPaused(db), false);
  connectDrive(db, { refresh_token: 'rt-good', email: 'office@church.org' });
  const ins = db.prepare("INSERT INTO backups (name, size, status, drive_id, created_at) VALUES (?, 1, 'ok', ?, ?)");
  for (let d = 40; d <= 70; d++) ins.run(`older-${d}`, `older-${d}`, new Date(Date.now() - d * 864e5).toISOString().replace('T', ' ').slice(0, 19));
  const from = calls.length;
  assert.equal((await call('admin', 'POST', '/backups/run', {})).status, 201);
  assert.ok(calls.slice(from).some((c) => c.method === 'DELETE'), 'normal clean-up resumed');
  assert.equal((await call('admin', 'DELETE', '/backups/drive')).status, 200);
});
