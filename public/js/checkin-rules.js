// Check-in rules shared by the server and the check-in tablets, so a tablet that has
// lost its internet connection still puts every child in the same room the server would.

// The version of the check-in app on the iPads. It is a whole number, sent with every request in
// x-checkin-version and compared by the server. Raise it in any change that alters what the iPad
// sends or how it releases children, so the hub can tell which iPads still need to be reopened.
export const CHECKIN_APP_VERSION = 2; // 2: check-out is child by child, one family at a time, with a per-release outbox

// Age in whole months on a given date (both YYYY-MM-DD).
export function ageMonths(birthdate, onDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate || '')) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let months = (y - by) * 12 + (m - bm);
  if (d < bd) months--;
  return months;
}

// Picks a room: by grade first (school-age kids), then by age. Returns null if none fits.
export function roomFor(person, rooms, onDate) {
  const open = rooms.filter((r) => !r.archived);
  if (person.grade != null) {
    const byGrade = open.find((r) => r.min_grade != null && r.max_grade != null && person.grade >= r.min_grade && person.grade <= r.max_grade);
    if (byGrade) return byGrade;
  }
  const months = ageMonths(person.birthdate, onDate);
  if (months == null) return null;
  return open.find((r) => r.min_age_months != null && r.max_age_months != null && months >= r.min_age_months && months <= r.max_age_months) || null;
}

// Pickup codes avoid letters and digits that are easy to confuse (0/O, 1/I/L, 5/S, 2/Z).
const CODE_CHARS = '346789ABCDEFGHJKMNPQRTUVWXY';

export function securityCode(random = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}

export function gradeLabel(g) {
  if (g == null) return '';
  if (g === -1) return 'Pre-K';
  if (g === 0) return 'K';
  return `${g}${['th', 'st', 'nd', 'rd'][(g % 100 > 10 && g % 100 < 14) || g % 10 > 3 ? 0 : g % 10]} grade`;
}

export function ageLabel(birthdate, onDate) {
  const m = ageMonths(birthdate, onDate);
  if (m == null) return '';
  if (m < 24) return `${m} mo`;
  return `${Math.floor(m / 12)} yr`;
}

export function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

// ---------------------------------------------------------------- check-out
// A child with no household counts as a family of their own, so a code can never release them together
// with someone else's children. Items are today's check-ins ({ household_id, person_id, ... }).
export const familyKey = (c) => (c.household_id != null ? `h${c.household_id}` : `p${c.person_id}`);

// Groups check-ins into families, keeping the order they first appear in.
export function groupFamilies(items) {
  const groups = new Map();
  for (const c of items) {
    const key = familyKey(c);
    if (!groups.has(key)) groups.set(key, { key, household_id: c.household_id ?? null, items: [] });
    groups.get(key).items.push(c);
  }
  return [...groups.values()];
}

// Each release made while offline is one outbox entry, so it keeps its own real time:
// { id, campus_id, ids, household_id, at, legacy? }. `at` is when the volunteer released the children.
export function newRelease({ id, campusId, ids, householdId, at }) {
  return { id, campus_id: campusId, ids: [...new Set(ids)], household_id: householdId ?? null, at };
}

// The outbox an older check-in app left behind was a flat list of ids with no times. It becomes
// legacy entries with no time (the server then uses the sync time, as it always did). The list is
// kept together, not split, so a list that held two families is still seen as one release.
export function upgradeOutbox(stored, campusId, newId) {
  if (!Array.isArray(stored)) return [];
  const entries = stored.filter((e) => e && typeof e === 'object' && Array.isArray(e.ids));
  const flat = [...new Set(stored.filter((e) => typeof e === 'string' && e))];
  for (let i = 0; i < flat.length; i += 500) entries.push({ id: newId(), campus_id: campusId, ids: flat.slice(i, i + 500), household_id: null, at: null, legacy: true });
  return entries;
}

// ---------------------------------------------------------------- labels and tags
// What is printed where other families can see it: a first name and a last-name initial, never the
// family name. If two children who could be in the same room share a first name and last initial, the
// label shows two letters of the last name, and if they still match (twins) the age too.
const firstOf = (p) => (p.nickname || p.first_name || '').trim();
const letters = (p, n) => {
  const t = (p.last_name || '').trim();
  return t ? `${t.slice(0, n).charAt(0).toUpperCase()}${t.slice(1, n).toLowerCase()}.` : '';
};
export function labelName(kid, eligible, onDate) {
  const same = eligible.filter((o) => o.id !== kid.id && firstOf(o).toLowerCase() === firstOf(kid).toLowerCase());
  const clash1 = same.filter((o) => letters(o, 1) === letters(kid, 1));
  const clash2 = clash1.filter((o) => letters(o, 2) === letters(kid, 2));
  return { first: firstOf(kid), last: clash1.length ? letters(kid, 2) : letters(kid, 1), age: clash2.length ? ageLabel(kid.birthdate, onDate) : '' };
}
export const labelText = (n) => [n.first, n.last, n.age ? `(${n.age})` : ''].filter(Boolean).join(' ');

// The parent tag shows how many children and their initials (first name initial, last name initial).
export const tagInitials = (kid) => `${firstOf(kid).charAt(0).toUpperCase()}.${letters(kid, 1)}`;
