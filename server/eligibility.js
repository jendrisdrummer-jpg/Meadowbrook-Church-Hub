// Which campuses a person can serve at. Teams may be shared across campuses, but each volunteer
// has their own list (serving_campuses). Rules:
//   - a list of campuses  -> exactly those
//   - no list             -> their home campus only (people.campus_id)
//   - no list, no home    -> any campus (null). Faith Teams had no campuses, so many people have no
//                            home campus; excluding them would leave autofill with nobody.
//                            The UI shows "campus not set" so staff can fix it.
export function eligibleCampuses(db, personId) {
  const list = db.prepare('SELECT campus_id FROM serving_campuses WHERE person_id = ? ORDER BY campus_id').all(personId).map((r) => r.campus_id);
  if (list.length) return list;
  const p = db.prepare('SELECT campus_id FROM people WHERE id = ?').get(personId);
  return p?.campus_id != null ? [p.campus_id] : null;
}

// Can this person serve at this campus? { eligible, reason } where reason is short, plain text
// ('' when there is nothing to say).
export function campusEligibility(db, personId, campusId) {
  const ids = eligibleCampuses(db, personId);
  if (ids === null) return { eligible: true, reason: 'Campus not set' };
  if (ids.includes(Number(campusId))) return { eligible: true, reason: '' };
  const names = ids.map((id) => {
    const c = db.prepare('SELECT name, short_name FROM campuses WHERE id = ?').get(id);
    return c ? (c.short_name || c.name) : null;
  }).filter(Boolean);
  return { eligible: false, reason: `Serves at ${names.join(' and ') || 'another campus'} only` };
}

// Adults only: not marked a child, no school grade, and (if we know it) at least 18. Small groups
// and account-link suggestions share this rule. ADULT_SQL is the same rule for queries on `p`.
export const ADULT_SQL = "p.household_role != 'child' AND p.grade IS NULL AND (p.birthdate IS NULL OR p.birthdate <= date('now', '-18 years'))";
export function isAdult(p) {
  if (p.household_role === 'child' || p.grade != null) return false;
  if (!p.birthdate) return true;
  const cut = new Date(); cut.setUTCFullYear(cut.getUTCFullYear() - 18);
  return p.birthdate <= cut.toISOString().slice(0, 10);
}
