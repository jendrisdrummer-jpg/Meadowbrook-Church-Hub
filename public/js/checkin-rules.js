// Check-in rules shared by the server and the check-in tablets, so a tablet that has
// lost its internet connection still puts every child in the same room the server would.

// The version of the check-in app on the iPads. It is a whole number, sent with every request in
// x-checkin-version and compared by the server. Raise it in any change that alters what the iPad
// sends or how it releases children, so the hub can tell which iPads still need to be reopened.
export const CHECKIN_APP_VERSION = 4; // 2: check-out is child by child, one family at a time, with a per-release outbox
// 3: pickup codes are a station letter plus four characters; medical details come in levels (Level 1 on the iPad and label)
// 4: a child with a hold is never checked out on the iPad (online or off), and check-out records who is collecting

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
export const CODE_CHARS = '346789ABCDEFGHJKMNPQRTUVWXY';
// A station letter is one of the letters in that alphabet, so a code can never start with a digit.
export const STATION_LETTERS = 'ABCDEFGHJKMNPQRTUVWXY';

// Four random characters. The server and the iPad both build codes from this.
export function securityCode(random = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}

// A pickup code is the station's letter plus four random characters. `taken` is every code already used today
// (a Set or array), so the iPad never repeats one; it gives up avoiding after 300 tries, which only happens if
// the day is nearly full, and the hub flags any clash it still sees. A station with no letter (a browser that
// is signed in rather than paired) takes a random one.
export function pickupCode({ letter, taken = [], random = Math.random } = {}) {
  const used = taken instanceof Set ? taken : new Set(taken);
  const lead = STATION_LETTERS.includes(letter) && letter.length === 1 ? letter : STATION_LETTERS[Math.floor(random() * STATION_LETTERS.length)];
  let code;
  for (let i = 0; i < 300; i++) {
    code = lead + securityCode(random);
    if (!used.has(code)) break;
  }
  return code;
}

// What a person types or reads back: capitals only, no spaces or dashes ("k 7q3m" and "K-7Q3M" are K7Q3M).
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// For reading aloud and on screen: the station letter, then the four characters.
export const showCode = (c) => (c && c.length === 5 ? `${c[0]} ${c.slice(1)}` : c || '');

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
// { id, campus_id, ids, household_id, at, collector?, legacy? }. `at` is when the volunteer released the children.
export function newRelease({ id, campusId, ids, householdId, at, collector }) {
  return { id, campus_id: campusId, ids: [...new Set(ids)], household_id: householdId ?? null, at, ...(collector ? { collector } : {}) };
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

// ---------------------------------------------------------------- holds and who collected
// A hold ("see coordinator") is placed by staff in the Hub. The iPad only ever learns that a child has one (`on_hold`,
// on the roster and the active list), never why. A held child is never checked out on an iPad, online or off.
export const HOLD_MESSAGE = 'A staff member needs to help with this child. Please ask one to come to the desk before anyone leaves with them.';
export const STALE_MESSAGE = 'This iPad hasn’t been updated today and has no connection, so it can’t check children out. Use the paper sign-out sheet and ask a coordinator.';

// The kind of ID a collector showed (never the number). `not_checked` is an honest answer.
export const ID_TYPES = [
  { value: 'drivers_license', label: 'Driver’s license' },
  { value: 'passport', label: 'Passport' },
  { value: 'other_photo_id', label: 'Other photo ID' },
  { value: 'known', label: 'Known to me' },
  { value: 'not_checked', label: 'Not checked' },
];
// Someone who isn't a household adult or a listed pickup person must have shown real ID.
export const PHOTO_ID_TYPES = ['drivers_license', 'passport', 'other_photo_id'];

// The people with a hold, from the iPad's copies: the roster (children flagged `on_hold`) and today's check-ins.
export function heldPeople(roster, todays = []) {
  const held = new Set();
  for (const h of roster?.households || []) for (const m of h.members || []) if (m.on_hold) held.add(m.id);
  for (const c of todays) if (c.on_hold) held.add(c.person_id);
  return held;
}

// Is the iPad's family list from today at this campus? An iPad with no connection may only check children out when it is,
// so a hold placed overnight is on it. `now` is a Date; the campus's own time zone decides what "today" is.
export function rosterIsToday(roster, now = new Date()) {
  if (!roster?.today) return false;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: roster.campus?.timezone || 'UTC' }).format(now) === roster.today;
  } catch { return false; }
}

// The collector the iPad sends with a release: a household adult or a listed pickup person, and the ID shown.
export function collectorChoice(value, idType) {
  const [kind, id] = String(value || '').split(':');
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const out = kind === 'adult' ? { kind: 'household_adult', person_id: n } : kind === 'pickup' ? { kind: 'pickup_contact', pickup_id: n } : null;
  // The ID shown is chosen on purpose: nothing chosen (or something unknown) is no choice, never "Not checked" by default.
  return out && ID_TYPES.some((t) => t.value === idType) ? { ...out, id_type: idType } : null;
}

// The rows of the safeguarding lead picker: every active account the Hub lists, plus any named lead it doesn't list (for example a
// volunteer account with no flags), so saving never drops a lead by accident and they can be unticked deliberately.
export function leadRows(accounts, lead) {
  const rows = accounts.map((u) => ({ id: u.id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email, role: u.role }));
  const seen = new Set(rows.map((r) => r.id));
  for (const l of lead.leads || []) if (!seen.has(l.id)) rows.push({ id: l.id, name: l.name, role: '' });
  return rows.map((r) => ({ ...r, checked: (lead.lead_ids || []).includes(r.id) }));
}

// A release the hub refuses every time (for example the iPad moved campus) is parked, with only its ids, times and
// the answer's status, so it stops blocking the clean-up of old family lists. A coordinator sees it counted.
export function parkEntry(outbox, stuck, id, status) {
  const entry = outbox.find((e) => e.id === id);
  if (!entry) return { outbox, stuck };
  return { outbox: outbox.filter((e) => e.id !== id), stuck: [...stuck, { id: entry.id, campus_id: entry.campus_id, ids: entry.ids, at: entry.at, status }] };
}

// Old lists and rosters may be cleared only when nothing is still waiting to be sent (parked entries don't wait).
export const canTidy = (queue, outbox) => queue.length === 0 && outbox.length === 0;

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

// ---------------------------------------------------------------- medical levels
// Level 1 is what every volunteer must see, on the iPad and on the label: the allergen words, an EpiPen yes/no and a
// one-line action. It is never cut short: if it doesn't fit it says to see the room leader instead.
// Level 2 (the longer medical note) is fetched on tap and never printed. Level 3 stays in the Hub.
export const SEE_LEADER = 'ALLERGIES: SEVERAL, SEE ROOM LEADER';
const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export const hasEpi = (p) => Number(p?.allergy_epi) === 1;

// { allergy, epi, action }: the lines to print. `max` is how many characters fit on one line of this label.
export function level1(p, max = 40) {
  const words = oneLine(p.allergies);
  const action = oneLine(p.allergy_action);
  return {
    allergy: !words ? '' : `ALLERGY: ${words}`.length > max ? SEE_LEADER : `ALLERGY: ${words}`,
    epi: hasEpi(p),
    action: !action ? '' : action.length > max ? 'SEE ROOM LEADER' : action,
  };
}

// The same safety line as plain text, for an iPad that doesn't know the newer fields (the hub folds them into
// `allergies` for it, so an old label still says EPI: YES).
export function level1Text(p) {
  return [hasEpi(p) ? 'EPI: YES' : '', oneLine(p.allergies), oneLine(p.allergy_action)].filter(Boolean).join(' · ');
}

// The safety strips to print on a name tag, top to bottom (an empty list when the child has none). A roomy tag prints
// the Level 1 lines as they are: "EPI: YES", the allergens, the action. A small tag (`compact`) has room for one strip,
// so it joins them ("EPI: YES · Peanuts"); the one-line action doesn't fit there, so a child who has one gets
// "SEE ROOM LEADER" in its place. Either way "EPI: YES" is always printed when true, and whatever can't fit says
// "see room leader" instead of being lost. `max` is how many characters fit on one line.
export function labelSafety(p, { max = 40, compact = false } = {}) {
  const l1 = level1(p, max);
  if (!compact) return [l1.epi ? 'EPI: YES' : '', l1.allergy, l1.action].filter(Boolean);
  const epi = l1.epi ? 'EPI: YES' : '';
  const words = oneLine(p.allergies);
  const joined = [epi, words, oneLine(p.allergy_action) ? 'SEE ROOM LEADER' : ''].filter(Boolean).join(' · ');
  return [joined.length > max ? [epi, 'SEE ROOM LEADER'].filter(Boolean).join(' · ') : joined].filter(Boolean);
}
