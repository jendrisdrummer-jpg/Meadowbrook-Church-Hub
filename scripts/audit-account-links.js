// Read-only check of how accounts are linked to people. Changes nothing.
//   node scripts/audit-account-links.js          (no emails or names printed)
//   node scripts/audit-account-links.js --show   (adds emails and names; keep the output private)
// Uses MB_DB like the server (default data/meadowbrook.db). See docs/account-links.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dash = (v) => (v == null || v === '' ? '-' : v);

// Returns { lines, duplicates, orphans } for an open database.
export function auditAccountLinks(db, { show = false } = {}) {
  const lines = [];
  const who = (u) => `account ${u.id} (${u.role}, ${u.active ? 'active' : 'disabled'}, last sign-in ${dash(u.last_login)}, created ${dash(u.created_at)})${show ? ` ${u.email}` : ''}`;

  const people = db.prepare('SELECT person_id FROM users WHERE person_id IS NOT NULL GROUP BY person_id HAVING COUNT(*) > 1 ORDER BY person_id').all();
  const forPerson = db.prepare('SELECT id, email, role, active, last_login, created_at FROM users WHERE person_id = ? ORDER BY id');
  const personRow = db.prepare('SELECT first_name, last_name FROM people WHERE id = ?');
  lines.push('People linked to more than one account');
  if (!people.length) lines.push('  none');
  for (const { person_id } of people) {
    const p = personRow.get(person_id);
    lines.push(`  person ${person_id}${show ? ` (${p ? `${p.first_name} ${p.last_name}`.trim() : 'missing'})` : ''}`);
    for (const u of forPerson.all(person_id)) lines.push(`    ${who(u)}`);
  }

  const orphans = db.prepare(`SELECT u.id, u.email, u.role, u.active, u.last_login, u.created_at, u.person_id, p.id found, p.archived
    FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.person_id IS NOT NULL AND (p.id IS NULL OR p.archived = 1) ORDER BY u.id`).all();
  lines.push('', 'Accounts linked to an archived or missing person');
  if (!orphans.length) lines.push('  none');
  for (const u of orphans) lines.push(`  ${who(u)} -> person ${u.person_id} is ${u.found ? 'archived' : 'missing'}`);

  const total = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const unlinked = db.prepare('SELECT COUNT(*) n FROM users WHERE person_id IS NULL AND active = 1').get().n;
  const indexed = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'users_person_unique'").get());
  lines.push('', `Summary: ${people.length} people with more than one account, ${orphans.length} accounts linked to an archived or missing person, `
    + `${unlinked} active accounts not linked to anyone, ${total} accounts in all. One-account rule enforced by the database: ${indexed ? 'yes' : 'no'}.`);
  return { lines, duplicates: people.length, orphans: orphans.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const file = process.env.MB_DB || 'data/meadowbrook.db';
  if (!fs.existsSync(file)) { console.error(`No database at ${file}. Set MB_DB to its path.`); process.exit(2); }
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000'); // wait briefly if the live server is busy; still read-only
  try {
    console.log(auditAccountLinks(db, { show: process.argv.includes('--show') }).lines.join('\n'));
  } finally { db.close(); }
}
