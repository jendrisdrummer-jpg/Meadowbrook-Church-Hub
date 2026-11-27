// Check-in rules shared by the server and the check-in tablets, so a tablet that has
// lost its internet connection still puts every child in the same room the server would.

// The version of the check-in app on the iPads. It is a whole number, sent with every request in
// x-checkin-version and compared by the server. Raise it in any change that alters what the iPad
// sends or how it releases children, so the hub can tell which iPads still need to be reopened.
export const CHECKIN_APP_VERSION = 5; // 2: check-out is child by child, one family at a time, with a per-release outbox
// 3: pickup codes are a station letter plus four characters; medical details come in levels (Level 1 on the iPad and label)
// 4: a child with a hold is never checked out on the iPad (online or off), and check-out records who is collecting
// 5: the iPad follows the church's Check-in settings (no Check out screen when parents show a tag, a warning at check-in for a held
//    child, the Care note button, and what a name tag says when allergy details are too long)

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

// ---------------------------------------------------------------- check-in settings
// How this church runs check-in (Check-in iPads, in the Hub). The roster carries them to the iPad (`roster.features`); an
// iPad with an older copy, or none, behaves as it always did.
export const DEFAULT_FEATURES = { checkout: 'ipad', holds: 'block', medical_tap: true, label_overflow: 'leader' };
export function featuresOf(roster) {
  const f = roster?.features && typeof roster.features === 'object' ? roster.features : {};
  const checkout = f.checkout === 'tag' ? 'tag' : 'ipad';
  const holds = ['off', 'alert', 'block'].includes(f.holds) ? f.holds : checkout === 'tag' ? 'alert' : 'block';
  return {
    checkout,
    holds: checkout === 'tag' && holds === 'block' ? 'alert' : holds,
    medical_tap: f.medical_tap !== false,
    label_overflow: ['leader', 'desk', 'smaller'].includes(f.label_overflow) ? f.label_overflow : 'leader',
  };
}

// What the volunteer sees when a child with a hold is checked in (holds set to "Warn at check-in"). The child's first name only:
// never the note, the reason or who placed the hold.
const joinNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const cleanNames = (names) => names.map((n) => String(n || '').trim()).filter(Boolean);
export function holdAlertText(names) {
  const list = cleanNames(names);
  if (!list.length) return 'Before this child goes to their room, please ask the children’s ministry leader or a staff member to come to the desk.';
  return `Before ${joinNames(list)} ${list.length === 1 ? 'goes to their room' : 'go to their rooms'}, please ask the children’s ministry leader or a staff member to come to the desk.`;
}
// The same, when a held child is about to be checked out (holds that only warn, with check-out on the iPad).
export function holdLeaveText(names) {
  const list = cleanNames(names);
  return `Before ${list.length ? joinNames(list) : 'this child'} ${list.length > 1 ? 'leave' : 'leaves'}, please ask the children’s ministry leader or a staff member to come to the desk.`;
}

// ---------------------------------------------------------------- medical levels
// Level 1 is what every volunteer must see, on the iPad and on the label: the allergen words, an EpiPen yes/no and a
// one-line action. It is never cut short: if it doesn't fit it says where to go instead (the room leader, or the check-in desk,
// or it is printed smaller; the church chooses, `label_overflow`).
// Level 2 (the longer medical note) is fetched on tap and never printed. Level 3 stays in the Hub.
export const SEE_LEADER = 'ALLERGIES: SEVERAL, SEE ROOM LEADER';
export const SEE_DESK_ALLERGIES = 'ALLERGIES: SEVERAL, SEE CHECK-IN DESK';
export const SEE_ROOM_LEADER = 'SEE ROOM LEADER';
export const SEE_DESK = 'SEE CHECK-IN DESK';
// "smaller" prints the words at a reduced size, never below this fraction of the normal one; past that it says to see the desk.
export const SMALLEST_SCALE = 0.7;
const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export const hasEpi = (p) => Number(p?.allergy_epi) === 1;
const seeWords = (overflow) => (overflow === 'leader' ? SEE_ROOM_LEADER : SEE_DESK);

// { allergy, epi, action }: the lines to print. `max` is how many characters fit on one line of this label.
export function level1(p, max = 40, overflow = 'leader') {
  const words = oneLine(p.allergies);
  const action = oneLine(p.allergy_action);
  return {
    allergy: !words ? '' : `ALLERGY: ${words}`.length > max ? (overflow === 'leader' ? SEE_LEADER : SEE_DESK_ALLERGIES) : `ALLERGY: ${words}`,
    epi: hasEpi(p),
    action: !action ? '' : action.length > max ? seeWords(overflow) : action,
  };
}

// The same safety line as plain text, for an iPad that doesn't know the newer fields (the hub folds them into
// `allergies` for it, so an old label still says EPI: YES).
export function level1Text(p) {
  return [hasEpi(p) ? 'EPI: YES' : '', oneLine(p.allergies), oneLine(p.allergy_action)].filter(Boolean).join(' · ');
}

// The size (a fraction of normal) that makes `len` characters fit a line that holds `max` at full size, or null when even the
// smallest allowed size can't. Rounded down so a measured fit is never exceeded.
const scaleFor = (len, max) => {
  if (len <= max) return 1;
  const s = Math.floor((max / len) * 100) / 100;
  return s >= SMALLEST_SCALE ? s : null;
};

// The safety strips to print on a name tag, top to bottom, each with the size to print it at (1 is the label's normal small
// size): [{ text, scale }], empty when the child has none. A roomy tag prints the Level 1 lines as they are: "EPI: YES", the
// allergens, the action. A small tag (`compact`) has room for one strip, so it joins them ("EPI: YES · Peanuts").
// "EPI: YES" is always printed when true. When something doesn't fit one line, `overflow` decides:
//   leader   says "SEE ROOM LEADER" instead
//   desk     says "SEE CHECK-IN DESK" instead
//   smaller  prints it smaller (down to SMALLEST_SCALE) so it can all be read, and only says "SEE CHECK-IN DESK" when even that can't fit
// `max` is how many characters fit on one line at full size. Nothing here touches the name, room or pickup code.
export function labelStrips(p, { max = 40, compact = false, overflow = 'leader' } = {}) {
  const mode = ['leader', 'desk', 'smaller'].includes(overflow) ? overflow : 'leader';
  const epi = hasEpi(p) ? 'EPI: YES' : '';
  const words = oneLine(p.allergies);
  const action = oneLine(p.allergy_action);
  const one = (text, scale = 1) => ({ text, scale });
  if (!compact) {
    const out = [];
    if (epi) out.push(one(epi));
    if (words) {
      const line = `ALLERGY: ${words}`;
      const s = mode === 'smaller' ? scaleFor(line.length, max) : line.length <= max ? 1 : null;
      out.push(s ? one(line, s) : one(mode === 'leader' ? SEE_LEADER : SEE_DESK_ALLERGIES));
    }
    if (action) {
      const s = mode === 'smaller' ? scaleFor(action.length, max) : action.length <= max ? 1 : null;
      out.push(s ? one(action, s) : one(seeWords(mode)));
    }
    return out;
  }
  const see = seeWords(mode);
  if (mode !== 'smaller') {
    // The one-line action doesn't fit a small tag, so a child who has one gets the "see" words in its place.
    const joined = [epi, words, action ? see : ''].filter(Boolean).join(' · ');
    return [joined.length > max ? [epi, see].filter(Boolean).join(' · ') : joined].filter(Boolean).map((t) => one(t));
  }
  const full = [epi, words, action].filter(Boolean).join(' · ');
  if (!full) return [];
  const sFull = scaleFor(full.length, max);
  if (sFull) return [one(full, sFull)];
  const mid = [epi, words, action ? see : ''].filter(Boolean).join(' · ');
  const sMid = scaleFor(mid.length, max);
  if (sMid) return [one(mid, sMid)];
  return [one([epi, see].filter(Boolean).join(' · '))];
}

// Just the words of the strips (for callers that only need the text).
export const labelSafety = (p, opts = {}) => labelStrips(p, opts).map((s) => s.text);

// ---------------------------------------------------------------- the printed name tag
// The tag sizes, and the markup for a child's name tag and the parent's pickup tag. The iPad prints exactly this, and the
// print measurements run it too, so what is measured is what is printed.
// `fit` is how many characters of the safety line fit on one line at the small size; `nameFit` is how many characters of name fit
// at full size (a longer name is shrunk, never cut); `compact` is a small tag with one joined safety strip.
export const LABELS = {
  'brother-62x29': { w: '62mm', h: '29mm', pad: '1.5mm 2.5mm', name: '20pt', small: '8pt', code: '14pt', fit: 30, nameFit: 10, compact: true },
  'brother-62x100': { w: '62mm', h: '100mm', pad: '4mm', name: '30pt', small: '11pt', code: '22pt', fit: 70, nameFit: 8 },
  'dymo-30252': { w: '3.5in', h: '1.125in', pad: '0.06in 0.12in', name: '20pt', small: '8pt', code: '14pt', fit: 36, nameFit: 14, compact: true },
  'dymo-30256': { w: '4in', h: '2.3125in', pad: '0.12in', name: '30pt', small: '11pt', code: '22pt', fit: 60, nameFit: 12 },
  letter: { w: '3.5in', h: '2in', pad: '0.15in', name: '26pt', small: '10pt', code: '18pt', page: 'letter', fit: 50, nameFit: 12 },
};
const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const scaled = (size, scale) => {
  const m = /^([\d.]+)(.*)$/.exec(size);
  return m ? `${Math.round(parseFloat(m[1]) * scale * 100) / 100}${m[2]}` : size;
};

// `name` is labelName(...); `room` is { name } or null; `date` and `time` are already formatted.
export function kidLabelHtml({ kid, name: n, room, code, date, time, size, overflow = 'leader' }) {
  const strips = labelStrips(kid, { max: size.fit, compact: size.compact, overflow });
  // The name, room, time and pickup code come first and are never clipped; a long first name is shrunk to fit.
  const last = [n.last, n.age ? `(${n.age})` : ''].filter(Boolean).join(' ');
  const namePt = Math.min(parseFloat(size.name), (parseFloat(size.name) * size.nameFit) / Math.max(n.first.length + last.length * 0.6, 1));
  return `<div class="label">
      <div class="name" style="font-size:${namePt}pt">${escapeHtml(n.first)} <span class="last" style="font-size:${size.small}">${escapeHtml(last)}</span></div>
      <div class="meta" style="font-size:${size.small}"><span>${escapeHtml(room?.name || '')}</span><span>${escapeHtml(date)} ${escapeHtml(time)}</span><span class="code" style="font-size:${size.code}">${escapeHtml(showCode(code))}</span></div>
      ${strips.map((t) => `<div class="alert-strip" style="font-size:${scaled(size.small, t.scale)}">${escapeHtml(t.text)}</div>`).join('')}
    </div>`;
}

export function parentTagHtml({ kids, code, date, time, size }) {
  return `<div class="label">
      <div style="font-size:${size.small}">PARENT PICKUP TAG</div>
      <div class="code" style="font-size:${size.name}">${escapeHtml(showCode(code))}</div>
      <div style="font-size:${size.small}">${kids.length} ${kids.length === 1 ? 'child' : 'children'}: ${kids.map((k) => escapeHtml(tagInitials(k))).join(' · ')} · ${escapeHtml(date)} ${escapeHtml(time)}</div>
      <div style="font-size:${size.small}">Keep this tag. You hand it over at pickup. We may ask for ID.</div>
    </div>`;
}

export function labelCss(size) {
  return `<style>@page { size: ${size.page || `${size.w} ${size.h}`}; margin: ${size.page ? '0.5in' : '0'}; }
    .label { width: ${size.w}; height: ${size.h}; padding: ${size.pad}; box-sizing: border-box; ${size.page ? 'border: 1px dashed #999; margin-bottom: 0.2in;' : ''} }</style>`;
}
