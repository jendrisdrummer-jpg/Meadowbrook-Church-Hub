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
  // 6: custom profile fields (milestones, classes, leadership track…) grouped into sections.
  `
  CREATE TABLE profile_fields (
    id INTEGER PRIMARY KEY,
    section TEXT NOT NULL DEFAULT 'Other',
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',                -- text | longtext | date | yesno | choice | multi | number
    options TEXT NOT NULL DEFAULT '[]',               -- JSON list, for choice and multi
    visibility TEXT NOT NULL DEFAULT 'leader',        -- leader | staff: lowest role that can see it
    sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE profile_values (
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES profile_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL,                              -- JSON
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (person_id, field_id)
  );
  CREATE INDEX profile_values_field ON profile_values(field_id);
  INSERT INTO profile_fields (section, label, type, options, sort) VALUES
    ('Spiritual journey', 'New birth', 'choice', '["Not started","Repented","Baptized","Received the Holy Ghost"]', 0),
    ('Spiritual journey', 'Baptism date', 'date', '[]', 1),
    ('Spiritual journey', 'Holy Ghost date', 'date', '[]', 2),
    ('Discipleship', 'Classes completed', 'multi', '["New Believers","Foundations","Membership"]', 3),
    ('Leadership', 'Leadership track', 'choice', '["Not started","Serving","In training","Leader","Leader of leaders"]', 4);
  `,
  // 7: service templates. A template is a reusable order of service (with "fill in" slots) and
  // the positions it needs; repeating services can fill each new service from one.
  `
  CREATE TABLE service_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    campus_id INTEGER REFERENCES campuses(id) ON DELETE CASCADE,   -- NULL = every campus
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '10:00',                       -- for showing times while editing
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE template_items (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'item',
    category TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    song_key TEXT NOT NULL DEFAULT '',
    length_sec INTEGER NOT NULL DEFAULT 0,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    info TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    is_start INTEGER NOT NULL DEFAULT 0,
    placeholder INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE template_needs (
    template_id INTEGER NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (template_id, position_id)
  );
  ALTER TABLE service_types ADD COLUMN template_id INTEGER REFERENCES service_templates(id) ON DELETE SET NULL;
  ALTER TABLE plan_items ADD COLUMN placeholder INTEGER NOT NULL DEFAULT 0;
  `,
  // 8: notifications. An inbox per account, the phones/browsers that allowed push, each
  // person's notification choices, and when a serving reminder went out.
  `
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                                -- scheduled | reminder | declined | test
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',                   -- JSON, e.g. { "assignment_ids": [..] }
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  );
  CREATE INDEX notifications_user ON notifications (user_id, created_at);
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT
  );
  ALTER TABLE users ADD COLUMN notify TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE assignments ADD COLUMN reminded_at TEXT;
  `,
  // 9: the member app. Connect cards guests fill in, and which app a push device belongs to
  // (the member app or the staff dashboard), so notification taps open the right one.
  `
  CREATE TABLE connect_cards (
    id INTEGER PRIMARY KEY,
    campus_id INTEGER REFERENCES campuses(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    first_time INTEGER NOT NULL DEFAULT 0,
    interests TEXT NOT NULL DEFAULT '[]',              -- JSON array of what they ticked
    message TEXT NOT NULL DEFAULT '',                  -- prayer request or question
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    done_at TEXT,
    done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE push_subscriptions ADD COLUMN ui TEXT NOT NULL DEFAULT 'hub';
  `,
  // 10: email sign-in. Passwords (scrypt), the one-time codes emailed to prove an address, and
  // people who created their own account in the app (for staff to welcome).
  `
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  CREATE TABLE login_codes (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX login_codes_email ON login_codes (email, created_at);
  ALTER TABLE people ADD COLUMN signed_up_at TEXT;        -- made their own account in the app
  ALTER TABLE people ADD COLUMN welcomed_at TEXT;         -- staff followed up on that
  `,
  // 11: scheduling requests are drafts until the scheduler sends them; leader access that came
  // from leading a team (so it can be taken back when they stop).
  `
  ALTER TABLE assignments ADD COLUMN sent_at TEXT;
  UPDATE assignments SET sent_at = created_at;
  ALTER TABLE users ADD COLUMN role_auto INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET role = 'leader', role_auto = 1
    WHERE role = 'volunteer' AND person_id IN (SELECT person_id FROM team_members WHERE is_leader = 1);
  `,
  // 12: who sent each request, so they hear the reply even if they don't lead that team.
  `
  ALTER TABLE assignments ADD COLUMN sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `,
  // 13: chat. Every team has a chat (members come from the team roster); leaders and staff also
  // make groups. Messages can reply to another, @mention people, carry files and reactions.
  `
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                                -- team | group
    team_id INTEGER UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',                     -- groups only; team chats use the team's name
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT
  );
  CREATE TABLE chat_members (                          -- groups only
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    is_admin INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, person_id)
  );
  CREATE TABLE chat_reads (                            -- what each account has seen, and muting
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL DEFAULT '',
    reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    mentions TEXT NOT NULL DEFAULT '[]',               -- JSON array of person ids
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT,
    deleted_at TEXT
  );
  CREATE INDEX messages_chat ON messages (chat_id, id);
  CREATE TABLE message_files (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,  -- NULL until the message is sent
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    file TEXT NOT NULL,                                -- name on disk, under uploads/chat
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
  `,
  // 14: tasks. A team task can be given to anyone on that team; a personal one is just for you.
  // Due dates bring reminders, a repeating task makes its next one when it's done.
  `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,     -- NULL = personal
    assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date TEXT,                                     -- YYYY-MM-DD
    due_time TEXT,                                     -- HH:MM, optional
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    repeat TEXT NOT NULL DEFAULT '',                   -- '' | daily | weekly | biweekly | monthly
    next_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,  -- the next one, once this repeating task is done
    done_at TEXT,
    done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reminded INTEGER NOT NULL DEFAULT 0,               -- 1 = "due tomorrow" sent, 2 = "due today" sent
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX tasks_assignee ON tasks (assignee_id, done_at);
  CREATE INDEX tasks_team ON tasks (team_id, done_at);
  CREATE TABLE task_items (                            -- the checklist
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 15: tasks inside chats. A group's tasks belong to the group (teams' tasks to the team), and
  // giving one posts a card in the chat that stays up to date.
  `
  ALTER TABLE tasks ADD COLUMN chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE;
  CREATE INDEX tasks_chat ON tasks (chat_id, done_at);
  ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT '';     -- '' | task
  ALTER TABLE messages ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
  CREATE INDEX messages_task ON messages (task_id);
  `,
  // 16: video calls and meetings in chats (Daily rooms are made when the first person joins).
  `
  CREATE TABLE calls (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    starts_at TEXT,                                    -- a scheduled meeting (UTC ISO); NULL = started now
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    room_name TEXT,
    room_url TEXT,
    room_created_at TEXT,                              -- first join
    room_exp INTEGER,                                  -- unix seconds
    empty_since TEXT,
    reminded INTEGER NOT NULL DEFAULT 0,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX calls_chat ON calls (chat_id, ended_at);
  ALTER TABLE messages ADD COLUMN call_id INTEGER REFERENCES calls(id) ON DELETE SET NULL;
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
