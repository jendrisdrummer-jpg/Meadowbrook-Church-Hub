// Migration 37: accounts on the old 'light' default follow the device, and a saved member app
// Home layout gets the "This week" card at the top once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION, getSetting } from '../server/db.js';

test('migration 37: themes move to device, saved layouts get This week first, once', () => {
  assert.ok(SCHEMA_VERSION >= 37);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-m37-'));
  const file = path.join(dir, 'x.db');
  try {
    let db = openDb(file);
    db.prepare("INSERT INTO users (email, role, theme) VALUES ('a@t.test', 'staff', 'light'), ('b@t.test', 'staff', 'dark'), ('c@t.test', 'volunteer', 'light')").run();
    const saved = { tabs: [{ id: 'home', type: 'home' }], home: [{ id: 'welcome', type: 'welcome', size: 'F' }, { id: 'times', type: 'times', size: 'F' }] };
    db.prepare("INSERT INTO settings (key, value) VALUES ('app_config', ?)").run(JSON.stringify(saved));
    db.exec('ALTER TABLE users DROP COLUMN app_editor; ALTER TABLE users DROP COLUMN home_layout; DROP TABLE checkin_events; ALTER TABLE checkin_devices DROP COLUMN app_version; ALTER TABLE checkin_devices DROP COLUMN app_version_at; DROP TABLE study_pending_people; DROP TABLE study_completions; DROP TABLE study_people; DROP TABLE studies; DROP TABLE study_requests; DROP TABLE study_materials; ALTER TABLE users DROP COLUMN studies; DROP INDEX IF EXISTS checkins_service; DROP INDEX IF EXISTS messages_reply; DROP INDEX IF EXISTS message_files_message; DROP INDEX IF EXISTS push_subscriptions_user; PRAGMA user_version = 36'); // also undo migrations 38 to 43, which run again with 37
    db.close();

    db = openDb(file); // runs 37
    assert.deepEqual(db.prepare('SELECT email, theme FROM users ORDER BY email').all().map((u) => [u.email, u.theme]),
      [['a@t.test', 'device'], ['b@t.test', 'dark'], ['c@t.test', 'device']]);
    const cfg = getSetting(db, 'app_config');
    assert.deepEqual(cfg.home.map((w) => w.type), ['thisweek', 'welcome', 'times']);
    assert.deepEqual(cfg.home[1], saved.home[0], 'existing widgets kept as they were');
    assert.deepEqual(cfg.tabs, saved.tabs);

    // Running it again (e.g. a layout that already has the card) adds nothing.
    db.exec('ALTER TABLE users DROP COLUMN app_editor; ALTER TABLE users DROP COLUMN home_layout; DROP TABLE checkin_events; ALTER TABLE checkin_devices DROP COLUMN app_version; ALTER TABLE checkin_devices DROP COLUMN app_version_at; DROP TABLE study_pending_people; DROP TABLE study_completions; DROP TABLE study_people; DROP TABLE studies; DROP TABLE study_requests; DROP TABLE study_materials; ALTER TABLE users DROP COLUMN studies; DROP INDEX IF EXISTS checkins_service; DROP INDEX IF EXISTS messages_reply; DROP INDEX IF EXISTS message_files_message; DROP INDEX IF EXISTS push_subscriptions_user; PRAGMA user_version = 36'); // also undo migrations 38 to 43, which run again with 37
    db.close();
    db = openDb(file);
    assert.deepEqual(getSetting(db, 'app_config').home.map((w) => w.type), ['thisweek', 'welcome', 'times']);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 37 leaves a church with no saved layout alone', () => {
  const db = openDb(':memory:');
  assert.equal(getSetting(db, 'app_config'), null);
});
