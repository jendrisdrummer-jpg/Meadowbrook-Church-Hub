// The warning rule for a new service: another service at the same campus that starts at the same
// time (to the minute). Different campuses, or different times on the same day, are fine.
// `existing` is the list GET /services returns for that day; the person can still go ahead.
export function findClash(existing, campusId, startsAt) {
  const at = String(startsAt || '').slice(0, 16);
  return (existing || []).find((s) => Number(s.campus_id) === Number(campusId) && String(s.starts_at || '').slice(0, 16) === at) || null;
}
