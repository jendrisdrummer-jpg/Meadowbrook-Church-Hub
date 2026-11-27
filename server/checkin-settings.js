// Check-in settings: how this church runs check-in. One settings key (`checkin_features`), read by the check-in
// routes, the iPad (through the roster) and the Hub. Nothing here is church-specific: the defaults are the public
// product's (check out on the iPad, block a held child), and each church switches what doesn't fit its process.
import { getSetting } from './db.js';

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
    auto_team_ids: ids(s.auto_team_ids),
  };
}

// What an iPad needs (no team ids: those are about permissions, not about how the iPad behaves).
export const ipadFeatures = (f) => ({ checkout: f.checkout, holds: f.holds, medical_tap: f.medical_tap, label_overflow: f.label_overflow });

export const autoTeamIds = (db) => checkinFeatures(db).auto_team_ids;

// Does this person lead one of the teams an admin chose for automatic check-in access? Worked out on each request, never
// stored, so it stops the moment they stop leading the team (or the team is archived or taken off the list).
export function leadsAutoTeam(db, personId) {
  if (!personId) return false;
  const teams = autoTeamIds(db);
  if (!teams.length) return false;
  return Boolean(db.prepare(`SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.person_id = ? AND m.is_leader = 1 AND t.archived = 0 AND m.team_id IN (${teams.map(() => '?').join(',')}) LIMIT 1`).get(personId, ...teams));
}
