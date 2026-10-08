// Check-in rules shared by the server and the check-in tablets, so a tablet that has
// lost its internet connection still puts every child in the same room the server would.

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
