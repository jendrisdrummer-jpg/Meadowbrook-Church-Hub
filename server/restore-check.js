// Checks an unlocked database backup without changing it: is the file whole, which schema version
// is it, and how much is in it. Used by `npm run restore -- <file> --check` and the restore drill
// (docs/restore-drill.md). Opens the copy read-only, so it never alters what it checks.
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './db.js';

// The tables a church would notice first if they came back empty.
const KEY_TABLES = ['people', 'households', 'users', 'teams', 'team_members', 'services', 'assignments',
  'chats', 'messages', 'checkins', 'events', 'gifts', 'audit_log'];

export function checkRestored(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (e) {
    return { ok: false, problems: [`Can’t open it as a database: ${e.message}`] };
  }
  try {
    const problems = [];
    let integrity;
    try {
      integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    } catch (e) {
      return { ok: false, problems: [`Can’t read it as a database: ${e.message}`] };
    }
    if (!(integrity.length === 1 && integrity[0] === 'ok')) problems.push(`Integrity check: ${integrity.slice(0, 5).join('; ')}`);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) problems.push(`It’s from a newer version of the hub (schema ${version}; this code knows ${SCHEMA_VERSION}). Restore it with that version.`);
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const counts = {};
    for (const t of KEY_TABLES) counts[t] = have.has(t) ? db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n : null;
    if (!counts.people) problems.push('There are no people in it.');
    return { ok: problems.length === 0, integrity: integrity.join('; '), version, expected_version: SCHEMA_VERSION,
      needs_migrations: version < SCHEMA_VERSION, counts, problems };
  } finally {
    db.close();
  }
}
