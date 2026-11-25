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
