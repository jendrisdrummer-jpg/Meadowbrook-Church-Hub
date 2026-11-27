// Check-in holds ("Hold: see coordinator") and who collected a child.
//
// A hold is placed by staff in the Hub (server/routes/checkin-holds.js). While one is on, a child is never
// checked out at an iPad or in the Hub's check-out; staff release a held child in the Hub, with a reason.
// The safeguarding lead is told every time a hold is placed, changed or lifted, and when a held child is
// released or a release is blocked. What a hold is for (its private note) never leaves the Hub: it is not
// on the iPad, not in the check-in record, not in the audit log and not in any notification or email.
import { getSetting } from './db.js';
import { bad, str } from './http.js';
import { notify } from './notify.js';
import { sendMail, mailConfigured, canSendMail } from './mail.js';
import { ID_TYPES, PHOTO_ID_TYPES } from '../public/js/checkin-rules.js';

export const activeHold = (db, personId) => db.prepare('SELECT * FROM checkin_holds WHERE person_id = ? AND lifted_at IS NULL').get(personId);

// Which of these people have a hold on right now (a Set of person ids).
export function heldSet(db, personIds) {
  const ids = [...new Set(personIds.filter(Number.isInteger))];
  if (!ids.length) return new Set();
  return new Set(db.prepare(`SELECT person_id FROM checkin_holds WHERE lifted_at IS NULL AND person_id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => x.person_id));
}

// The hold that was on for this child at a moment in time (ISO), if any: placed by then and not lifted yet.
export const holdAt = (db, personId, atIso) => db.prepare(
  'SELECT * FROM checkin_holds WHERE person_id = ? AND placed_at <= ? AND (lifted_at IS NULL OR lifted_at > ?) ORDER BY id DESC LIMIT 1').get(personId, atIso, atIso);

// ---------------------------------------------------------------- the safeguarding lead
// A per-church setting (`checkin_safeguarding` in settings, set by an admin): the accounts told about every hold, usually
// the safeguarding lead and a backup. Until one is named, every admin is told instead, so a hold is never silent.
export const MAX_LEADS = 5;
export const leadIds = (db) => {
  const ids = getSetting(db, 'checkin_safeguarding', {}).lead_ids;
  return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
};
export function leadAccounts(db) {
  const named = leadIds(db);
  const pick = (where, args = []) => db.prepare(`SELECT id, email, notify FROM users WHERE active = 1 AND ${where}`).all(...args);
  const leads = named.length ? pick(`id IN (${named.map(() => '?').join(',')})`, named) : [];
  return leads.length ? { users: leads, fallback: false } : { users: pick("role = 'admin'"), fallback: true };
}

// Is this account one of the named leads? (They may read holds, but never change them unless they are also staff.)
export const isLead = (db, user) => Boolean(user?.id) && leadIds(db).includes(user.id);

const siteUrl = () => (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

// Tells the safeguarding lead (or every admin until one is named) in the Hub and by email when email is set up.
// `body` names the child and is for the inbox and the phone; the email never names the child and never carries a note,
// it only says to open the Hub. Never throws: a failure to tell must not undo or block the hold itself.
export function tellLeads(db, { title, body, personId = null }) {
  const { users, fallback } = leadAccounts(db);
  const url = personId ? `/#/people/${personId}` : '/#/stations';
  try {
    notify(db, users.map((u) => u.id), { kind: 'safety', title, body: fallback ? `${body} (No safeguarding lead is named yet, so every admin is told.)` : body, url });
  } catch (e) { console.error('Could not tell the safeguarding lead:', e.message); }
  if (mailConfigured() || canSendMail()) {
    for (const u of users) {
      // Email is not switched off by notification settings: this is the one message a lead must not miss.
      sendMail({ to: u.email, subject: title, text: `${title}.\n\nOpen the Hub to see which child and what happened: ${siteUrl()}${url}\n\nThis message doesn’t name the child, on purpose.` })
        .catch((e) => console.error(`Email to ${u.email} failed:`, e.message));
    }
  }
  return { told: users.length, fallback };
}

// ---------------------------------------------------------------- who collected
// What a release records about the person collecting: { kind, name, relationship, id_type }. The iPad sends a choice
// from the family's own list (a household adult by id, or a listed pickup person by id) and the server looks up the
// name, so what is recorded is what is on file, not what an iPad typed. Someone not on the list ("other") can only
// be recorded by staff in the Hub, with a real ID type. The ID's number is never asked for or stored.
export const ID_VALUES = ID_TYPES.map((t) => t.value);

// Throws a 400 with plain words when the choice can't be matched to this child's family.
export function resolveCollector(db, raw, householdId, { allowOther = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Choose who is collecting.');
  const idType = raw.id_type === undefined || raw.id_type === '' || raw.id_type === null ? 'not_checked' : raw.id_type;
  if (!ID_VALUES.includes(idType)) throw bad('Choose a kind of ID from the list.');
  if (raw.kind === 'household_adult') {
    const p = householdId == null ? null : db.prepare("SELECT first_name, last_name, nickname FROM people WHERE id = ? AND household_id = ? AND household_role != 'child' AND archived = 0").get(Number(raw.person_id), householdId);
    if (!p) throw bad('That person isn’t an adult in this child’s family. Choose someone from the list.');
    return { kind: 'household_adult', name: `${p.nickname || p.first_name || ''} ${p.last_name || ''}`.trim().slice(0, 100), relationship: '', id_type: idType };
  }
  if (raw.kind === 'pickup_contact') {
    const p = householdId == null ? null : db.prepare('SELECT name, relationship FROM household_pickups WHERE id = ? AND household_id = ?').get(Number(raw.pickup_id), householdId);
    if (!p) throw bad('That person isn’t on this family’s pickup list. Choose someone from the list.');
    return { kind: 'pickup_contact', name: p.name.slice(0, 100), relationship: p.relationship.slice(0, 60), id_type: idType };
  }
  if (raw.kind === 'other') {
    if (!allowOther) throw bad('Only a staff member can check a child out to someone who isn’t on the list. Please ask one to come to the desk.');
    const name = str(raw.name, 100);
    if (!name) throw bad('Write the name of the person collecting.');
    if (!PHOTO_ID_TYPES.includes(idType)) throw bad('Check their photo ID first, and choose the kind it was.');
    return { kind: 'other', name, relationship: str(raw.relationship, 60), id_type: idType };
  }
  throw bad('Choose who is collecting.');
}

// A release that already happened (an offline iPad catching up) is never refused, so a collector that can't be matched
// is kept as what the iPad said, marked unverified, for someone to look at.
export function unverifiedCollector(raw) {
  const claimed = raw && typeof raw === 'object' ? raw : {};
  const idType = ID_VALUES.includes(claimed.id_type) ? claimed.id_type : 'not_checked';
  return { kind: 'unverified', name: str(claimed.name, 100), relationship: str(claimed.relationship, 60), id_type: idType };
}
