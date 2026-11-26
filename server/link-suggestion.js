// Suggested person for an unlinked account (Settings → Accounts). Nothing is ever linked from
// here: an admin sees the suggestion and chooses to link (the usual PATCH /users/:id, audited).
// Only the email is used (never a phone number or a name), and only when exactly one active
// person has it. See docs/account-links.md.
import { isAdult } from './eligibility.js';

const norm = (e) => String(e || '').trim().toLowerCase();

// Returns {person_id, name, campus_id, campus_short, note} or null. `note` says why linking
// deserves a second look ('' when there is nothing to say). The caller checks the admin's reach.
export function linkSuggestion(db, userRow) {
  const email = norm(userRow.email);
  if (!email) return null;
  const found = db.prepare('SELECT id, first_name, last_name, campus_id, household_role, grade, birthdate FROM people WHERE archived = 0 AND lower(trim(email)) = ? LIMIT 2').all(email);
  if (found.length !== 1) return null;
  const p = found[0];
  // Never suggest linking an account to a child; an admin can still link by hand.
  if (!isAdult(p)) return null;
  const campus = p.campus_id != null ? db.prepare('SELECT short_name, name FROM campuses WHERE id = ?').get(p.campus_id) : null;
  let note = '';
  if (db.prepare('SELECT 1 FROM users WHERE person_id = ?').get(p.id)) note = 'already has an account';
  return { person_id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), campus_id: p.campus_id, campus_short: campus ? (campus.short_name || campus.name) : '', note };
}
