// SQLite database (Node's built-in node:sqlite, so there is nothing native to compile).
// One file holds everything; back it up by copying it (see scripts/backup.js).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Each entry runs once, in order. Never edit a shipped migration: add a new one.
const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE campuses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    color TEXT NOT NULL DEFAULT '#2f7d4f',
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE households (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    campus_id INTEGER REFERENCES campuses(id) ON DELETE SET NULL,
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
    household_role TEXT NOT NULL DEFAULT 'adult',      -- adult | child
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    birthdate TEXT,                                    -- YYYY-MM-DD
    gender TEXT NOT NULL DEFAULT '',
    grade INTEGER,                                     -- school grade, -1 = pre-K, 0 = K
    campus_id INTEGER REFERENCES campuses(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'guest',              -- guest | regular | member | inactive
    photo TEXT,
    allergies TEXT NOT NULL DEFAULT '',
    medical_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    external_id TEXT,                                  -- id from an import (e.g. Faith Teams)
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX people_household ON people(household_id);
  CREATE INDEX people_campus ON people(campus_id);
  CREATE INDEX people_email ON people(email);

  -- Adults outside the household allowed to pick children up (grandparents, sitters).
  CREATE TABLE household_pickups (
    id INTEGER PRIMARY KEY,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    relationship TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'volunteer',            -- admin | staff | leader | volunteer
    campus_ids TEXT,                                   -- JSON array; NULL = every campus
    active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    campus_id INTEGER REFERENCES campuses(id) ON DELETE CASCADE,   -- NULL = church-wide
    color TEXT NOT NULL DEFAULT '#4f6bed',
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE positions (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position_id INTEGER REFERENCES positions(id) ON DELETE CASCADE,
    is_leader INTEGER NOT NULL DEFAULT 0,
    UNIQUE (team_id, person_id, position_id)
  );

  CREATE TABLE blockouts (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
  );

  -- A kind of service at a campus ("Sunday 9:00 AM"), with the positions it needs.
  CREATE TABLE service_types (
    id INTEGER PRIMARY KEY,
    campus_id INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_of_week INTEGER,                               -- 0 = Sunday
    start_time TEXT NOT NULL DEFAULT '09:00',
    duration_min INTEGER NOT NULL DEFAULT 75,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE service_type_needs (
    service_type_id INTEGER NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (service_type_id, position_id)
  );

  CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    campus_id INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    service_type_id INTEGER REFERENCES service_types(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,                           -- local "YYYY-MM-DDTHH:MM"
    duration_min INTEGER NOT NULL DEFAULT 75,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX services_start ON services(starts_at);

  CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    ccli TEXT NOT NULL DEFAULT '',
    default_key TEXT NOT NULL DEFAULT '',
    bpm INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE plan_items (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'item',                 -- header | song | item
    title TEXT NOT NULL DEFAULT '',
    song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    song_key TEXT NOT NULL DEFAULT '',
    length_sec INTEGER NOT NULL DEFAULT 0,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',            -- pending | accepted | declined
    decline_reason TEXT NOT NULL DEFAULT '',
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (service_id, position_id, person_id)
  );
  CREATE INDEX assignments_person ON assignments(person_id);

  -- Kids' rooms, assigned at check-in by age or grade.
  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    campus_id INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    min_age_months INTEGER,
    max_age_months INTEGER,
    min_grade INTEGER,
    max_grade INTEGER,
    capacity INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE checkins (
    id TEXT PRIMARY KEY,                               -- created by the station, so offline check-ins never collide
    campus_id INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'kid',                  -- kid | adult | volunteer
    security_code TEXT NOT NULL DEFAULT '',
    station TEXT NOT NULL DEFAULT '',
    day TEXT NOT NULL,                                 -- campus-local date, YYYY-MM-DD
    checked_in_at TEXT NOT NULL,                       -- ISO timestamp (UTC)
    checked_out_at TEXT,
    checked_out_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX checkins_day ON checkins(campus_id, day);
  CREATE INDEX checkins_code ON checkins(security_code);

  -- Whole-room counts (sanctuary, overflow, online) for a service.
  CREATE TABLE headcounts (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    area TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (service_id, area)
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 2: each person's light/dark choice.
  `ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'light';`,
  // 3: repeating services. A service type is now a series ("every Sunday 9:00 at North") that
  // creates its services ahead of time; each service keeps its own copy of the positions it
  // needs, so one Sunday can differ without changing the rest.
  `
  ALTER TABLE service_types ADD COLUMN every_weeks INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE service_types ADD COLUMN starts_on TEXT;
  ALTER TABLE service_types ADD COLUMN ends_on TEXT;
  ALTER TABLE service_types ADD COLUMN default_title TEXT NOT NULL DEFAULT '';

  CREATE TABLE service_skips (
    service_type_id INTEGER NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (service_type_id, day)
  );

  CREATE TABLE service_needs (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (service_id, position_id)
  );
  INSERT INTO service_needs (service_id, position_id, count)
    SELECT s.id, n.position_id, n.count FROM services s JOIN service_type_needs n ON n.service_type_id = s.service_type_id;
  `,
  // 4: who was at each service, marked by the attendance team (roll call).
  `
  CREATE TABLE attendance (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    marked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (service_id, person_id)
  );
  CREATE INDEX attendance_person ON attendance(person_id);
  `,
  // 5: order-of-service details (type, who's leading as free text, where the service starts)
  // and a per-service lock.
  `
  ALTER TABLE plan_items ADD COLUMN category TEXT NOT NULL DEFAULT '';
  ALTER TABLE plan_items ADD COLUMN info TEXT NOT NULL DEFAULT '';
  ALTER TABLE plan_items ADD COLUMN is_start INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE services ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
  UPDATE plan_items SET category = 'Song' WHERE kind = 'song';
  `,
];

export function openDb(file = process.env.MB_DB || 'data/meadowbrook.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Runs fn inside a transaction; rolls back if it throws.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// Builds "UPDATE table SET a = ?, b = ? WHERE id = ?" from whichever allowed fields are present.
export function updateFields(db, table, id, body, allowed) {
  const keys = allowed.filter((k) => body[k] !== undefined);
  if (!keys.length) return;
  const extra = ['people', 'households'].includes(table) ? ", updated_at = datetime('now')" : '';
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}${extra} WHERE id = ?`)
    .run(...keys.map((k) => normalize(body[k])), id);
}

export function normalize(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '') return v;
  return v ?? null;
}
