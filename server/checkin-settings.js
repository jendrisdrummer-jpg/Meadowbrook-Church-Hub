// Check-in settings: how this church runs check-in. One settings key (`checkin_features`), read by the check-in
// routes, the iPad (through the roster) and the Hub. Nothing here is church-specific: the defaults are the public
// product's (check out on the iPad, block a held child), and each church switches what doesn't fit its process.
import { getSetting, setSetting } from './db.js';
import { audit } from './http.js';

export const FEATURES_KEY = 'checkin_features';
export const CHECKOUT_MODES = ['ipad', 'tag'];
export const HOLD_MODES = ['off', 'alert', 'block'];
export const OVERFLOW_MODES = ['leader', 'desk', 'smaller'];
export const MAX_AUTO_TEAMS = 100;

// With check-out on the iPad a hold is enforced there; with matching tags there is nothing to block, so it warns.
export const defaultHolds = (checkout) => (checkout === 'tag' ? 'alert' : 'block');

const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => Number.isInteger(x) && x > 0))] : []);

// The settings as they apply right now, always complete and always valid, whatever is stored: a missing or odd value
// falls back to the default, and a stored "block" next to "tag" is read as "alert" (it can't be saved that way).
export function checkinFeatures(db) {
  const s = getSetting(db, FEATURES_KEY, {}) || {};
  const checkout = CHECKOUT_MODES.includes(s.checkout) ? s.checkout : 'ipad';
  let holds = HOLD_MODES.includes(s.holds) ? s.holds : defaultHolds(checkout);
  if (checkout === 'tag' && holds === 'block') holds = 'alert';
  return {
    checkout,
    holds,
    medical_tap: s.medical_tap !== false,
    label_overflow: OVERFLOW_MODES.includes(s.label_overflow) ? s.label_overflow : 'leader',
    // Families can be checked in at any campus: the roster carries every family, whatever their campus. Off unless an admin turns it on.
    any_campus: s.any_campus === true,
    auto_team_ids: liveTeams(db, ids(s.auto_team_ids)),
  };
}

// Only teams that still exist and aren't archived count, so a deleted team (or a deleted campus, which takes its teams with it) is never a grant.
function liveTeams(db, list) {
  if (!list.length) return list;
  const live = new Set(db.prepare(`SELECT id FROM teams WHERE archived = 0 AND id IN (${list.map(() => '?').join(',')})`).all(...list).map((t) => t.id));
  return list.filter((x) => live.has(x));
}

// What an iPad needs (no team ids: those are about permissions, not about how the iPad behaves).
export const ipadFeatures = (f) => ({ checkout: f.checkout, holds: f.holds, medical_tap: f.medical_tap, label_overflow: f.label_overflow });

export const autoTeamIds = (db) => checkinFeatures(db).auto_team_ids;

// Which campuses automatic check-in covers for this person: the campus of each ticked team they lead, and for a ticked team with no
// campus, the campus list the account itself has. Worked out on each request, never stored, so it stops the moment they stop
// leading the team, the team is archived or taken off the list, or their person record is archived.
// Returns null when they lead none, else { ids: [campus ids of the teams they lead], churchWide: leads a team with no campus }.
export function autoCheckinScope(db, personId) {
  if (!personId) return null;
  const teams = autoTeamIds(db);
  if (!teams.length) return null;
  const rows = db.prepare(`SELECT DISTINCT t.campus_id FROM team_members m JOIN teams t ON t.id = m.team_id JOIN people p ON p.id = m.person_id
    WHERE m.person_id = ? AND m.is_leader = 1 AND t.archived = 0 AND p.archived = 0 AND m.team_id IN (${teams.map(() => '?').join(',')})`).all(personId, ...teams);
  if (!rows.length) return null;
  return { ids: rows.map((r) => r.campus_id).filter((x) => x != null), churchWide: rows.some((r) => r.campus_id == null) };
}

// Takes teams that are gone or archived off the automatic list (so unarchiving a team never brings access back), with an audit entry.
// Called when a team is archived, and whenever the settings are saved. Returns the ids it removed.
export function pruneAutoTeams(db, req, why) {
  const stored = getSetting(db, FEATURES_KEY, null);
  const before = ids(stored?.auto_team_ids);
  if (!before.length) return [];
  const keep = new Set(db.prepare(`SELECT id FROM teams WHERE archived = 0 AND id IN (${before.map(() => '?').join(',')})`).all(...before).map((t) => t.id));
  const gone = before.filter((x) => !keep.has(x));
  if (!gone.length) return [];
  setSetting(db, FEATURES_KEY, { ...stored, auto_team_ids: before.filter((x) => keep.has(x)) });
  audit(db, req, 'checkin.settings.auto_teams', { from: before, to: before.filter((x) => keep.has(x)), removed: gone, why });
  return gone;
}
