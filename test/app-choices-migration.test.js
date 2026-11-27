// Migration 37: accounts on the old 'light' default follow the device, and a saved member app
// Home layout gets the "This week" card at the top once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, SCHEMA_VERSION, getSetting } from '../server/db.js';

// Takes a fully migrated database back to what migration 36 left (the triggers of migration 42 go first: they name the columns).
const UNDO_AFTER_36 = `DROP TRIGGER checkins_collector_is_final; DROP TRIGGER people_keep_hold_history; DROP TABLE checkin_holds; ALTER TABLE checkins DROP COLUMN checked_out_to_name; ALTER TABLE checkins DROP COLUMN checked_out_to_relationship; ALTER TABLE checkins DROP COLUMN checked_out_to_kind; ALTER TABLE checkins DROP COLUMN checked_out_id_type; ALTER TABLE checkins DROP COLUMN checked_out_held; DROP TRIGGER checkins_no_delete; DROP TRIGGER checkins_void_is_final; DROP TRIGGER assignments_keep_history; DROP TRIGGER assignments_no_restatus; DROP TRIGGER services_no_retime; DROP TRIGGER services_keep_history;
  DROP TRIGGER positions_keep_history; DROP TRIGGER people_keep_history;
  ALTER TABLE checkins DROP COLUMN voided_at; ALTER TABLE checkins DROP COLUMN voided_by; ALTER TABLE checkins DROP COLUMN voided_by_name; ALTER TABLE checkins DROP COLUMN void_reason;
  ALTER TABLE users DROP COLUMN checkin; ALTER TABLE users DROP COLUMN app_editor; ALTER TABLE users DROP COLUMN home_layout; DROP TABLE checkin_events; ALTER TABLE checkin_devices DROP COLUMN app_version; ALTER TABLE checkin_devices DROP COLUMN app_version_at;
  ALTER TABLE checkins DROP COLUMN checked_out_device_id; ALTER TABLE checkins DROP COLUMN checked_out_user_id; ALTER TABLE checkins DROP COLUMN client_checked_out_at; DROP INDEX checkin_devices_letter; ALTER TABLE checkin_devices DROP COLUMN station_letter; ALTER TABLE people DROP COLUMN allergy_epi; ALTER TABLE people DROP COLUMN allergy_action; ALTER TABLE people DROP COLUMN medical_sorted_at; DROP TABLE person_care_notes; PRAGMA user_version = 36`;

test('migration 37: themes move to device, saved layouts get This week first, once', () => {
  assert.ok(SCHEMA_VERSION >= 37);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-m37-'));
  const file = path.join(dir, 'x.db');
  try {
    let db = openDb(file);
    db.prepare("INSERT INTO users (email, role, theme) VALUES ('a@t.test', 'staff', 'light'), ('b@t.test', 'staff', 'dark'), ('c@t.test', 'volunteer', 'light')").run();
    const saved = { tabs: [{ id: 'home', type: 'home' }], home: [{ id: 'welcome', type: 'welcome', size: 'F' }, { id: 'times', type: 'times', size: 'F' }] };
    db.prepare("INSERT INTO settings (key, value) VALUES ('app_config', ?)").run(JSON.stringify(saved));
    db.exec(UNDO_AFTER_36); // also undo migrations 38 to 45, which run again with 37
    db.close();

    db = openDb(file); // runs 37
    assert.deepEqual(db.prepare('SELECT email, theme FROM users ORDER BY email').all().map((u) => [u.email, u.theme]),
      [['a@t.test', 'device'], ['b@t.test', 'dark'], ['c@t.test', 'device']]);
    const cfg = getSetting(db, 'app_config');
    assert.deepEqual(cfg.home.map((w) => w.type), ['thisweek', 'welcome', 'times']);
    assert.deepEqual(cfg.home[1], saved.home[0], 'existing widgets kept as they were');
    assert.deepEqual(cfg.tabs, saved.tabs);

    // Running it again (e.g. a layout that already has the card) adds nothing.
    db.exec(UNDO_AFTER_36); // also undo migrations 38 to 45, which run again with 37
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
