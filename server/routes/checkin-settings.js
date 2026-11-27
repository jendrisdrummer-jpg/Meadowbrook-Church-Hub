// Check-in settings: how this church runs check-in (see server/checkin-settings.js).
// Anyone with check-in access may read them (an iPad needs them, and they are also on its roster). Changing them is for an
// admin who covers every campus, and every change is audited with the old and new values.
import { Router } from 'express';
import { requireRole, requireAllCampuses, canCheckin, rank } from '../auth.js';
import { getSetting, setSetting, tx } from '../db.js';
import { bad, audit } from '../http.js';
import { recordEvent } from '../checkin-events.js';
import { tellLeads } from '../holds.js';
import { weakenedSettings } from '../../public/js/checkin-rules.js';
import { FEATURES_KEY, CHECKOUT_MODES, HOLD_MODES, OVERFLOW_MODES, MAX_AUTO_TEAMS, checkinFeatures, defaultHolds, ipadFeatures } from '../checkin-settings.js';

const KEYS = ['checkout', 'holds', 'medical_tap', 'label_overflow', 'auto_team_ids', 'any_campus'];
const WEAK_WORDS = { holds: 'pickup holds', checkout: 'how children go home', medical_tap: 'care notes on the iPad', auto_team_ids: 'who gets check-in automatically', any_campus: 'families at any campus' };

export default function checkinSettingsRoutes(db) {
  const r = Router();

  const view = (f = checkinFeatures(db)) => ({
    ...f,
    auto_teams: f.auto_team_ids.length
      ? db.prepare(`SELECT id, name, archived FROM teams WHERE id IN (${f.auto_team_ids.map(() => '?').join(',')}) ORDER BY name`).all(...f.auto_team_ids)
      : [],
  });

  r.get('/checkin/settings', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!canCheckin(req.user)) return res.status(403).json({ error: 'Kids’ check-in is for staff and people an admin has authorised. Ask an admin if you need it.' });
    res.set('Cache-Control', 'no-store');
    // Staff in the Hub see everything, including who gets check-in automatically. An iPad, or anyone else with check-in access, sees only what the iPad needs.
    res.json(!req.user.station && rank(req.user.role) >= rank('staff') ? view() : ipadFeatures(checkinFeatures(db)));
  });

  // Body: any of { checkout: 'ipad'|'tag', holds: 'off'|'alert'|'block', medical_tap: boolean,
  //   label_overflow: 'leader'|'desk'|'smaller', auto_team_ids: number[], reason? }. What isn't sent stays as it is.
  // A change that makes check-in less protective (see weakenedSettings) needs a `reason` (1 to 300 characters), kept only in the audit entry.
  r.put('/checkin/settings', requireRole('admin'), requireAllCampuses, (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const sent = Object.keys(b).filter((k) => k !== 'reason');
    if (!sent.length) throw bad('Nothing to change.');
    for (const k of sent) if (!KEYS.includes(k)) throw bad(`“${k.slice(0, 40)}” isn’t a check-in setting.`);
    const from = checkinFeatures(db);
    const to = { ...from };
    if (b.checkout !== undefined) {
      if (!CHECKOUT_MODES.includes(b.checkout)) throw bad('Choose how children go home: parents show their tag, or check out on the iPad.');
      to.checkout = b.checkout;
    }
    if (b.holds !== undefined) {
      if (!HOLD_MODES.includes(b.holds)) throw bad('Choose what pickup holds do: off, warn at check-in, or block check-out.');
      to.holds = b.holds;
    }
    if (b.medical_tap !== undefined) {
      if (typeof b.medical_tap !== 'boolean') throw bad('The care note button is on or off.');
      to.medical_tap = b.medical_tap;
    }
    if (b.label_overflow !== undefined) {
      if (!OVERFLOW_MODES.includes(b.label_overflow)) throw bad('Choose what a name tag says when the allergy details are too long for it.');
      to.label_overflow = b.label_overflow;
    }
    if (b.any_campus !== undefined) {
      if (typeof b.any_campus !== 'boolean') throw bad('Families at any campus is on or off.');
      to.any_campus = b.any_campus;
    }
    if (b.auto_team_ids !== undefined) {
      if (!Array.isArray(b.auto_team_ids) || !b.auto_team_ids.every((x) => Number.isInteger(x) && x > 0)) throw bad('Choose teams from the list.');
      const list = [...new Set(b.auto_team_ids)];
      if (list.length > MAX_AUTO_TEAMS) throw bad(`Choose up to ${MAX_AUTO_TEAMS} teams.`);
      for (const id of list) if (!db.prepare('SELECT 1 FROM teams WHERE id = ? AND archived = 0').get(id)) throw bad('Choose teams from the list. One of those teams is gone or archived.');
      to.auto_team_ids = list.sort((x, y) => x - y);
    }
    // Until holds have been chosen on purpose they follow the default for the way children go home.
    if (b.holds === undefined && !HOLD_MODES.includes(getSetting(db, FEATURES_KEY, {})?.holds)) to.holds = defaultHolds(to.checkout);
    // With matching tags nobody checks a child out on the iPad, so there is nothing for a hold to block.
    if (to.checkout === 'tag' && to.holds === 'block') {
      throw bad('Blocking check-out only works when children are checked out on the iPad. Choose “Warn at check-in” or “Off” for pickup holds.');
    }
    const changed = KEYS.filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]));
    const weakened = weakenedSettings(from, to);
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (weakened.length && (!reason || reason.length > 300)) {
      throw bad('Say why you’re making this change, in up to 300 characters. It’s kept in the audit log, and the safeguarding leads and admins are told that it changed.');
    }
    tx(db, () => {
      setSetting(db, FEATURES_KEY, to);
      if (changed.length) {
        audit(db, req, 'checkin.settings', { from, to, changed, ...(reason ? { reason } : {}) });
        // Who gets check-in access automatically is a permission, so it has an entry of its own.
        if (changed.includes('auto_team_ids')) audit(db, req, 'checkin.settings.auto_teams', { from: from.auto_team_ids, to: to.auto_team_ids });
        recordEvent(db, req, { action: 'safety.settings', detail: { changed, checkout: to.checkout, holds: to.holds, medical_tap: to.medical_tap, label_overflow: to.label_overflow, auto_team_count: to.auto_team_ids.length, any_campus: to.any_campus } });
      }
    });
    // Making check-in less protective is never quiet. The message is generic (no names, no reason); the reason stays in the audit log.
    if (weakened.length) {
      const holds = db.prepare('SELECT COUNT(*) n FROM checkin_holds WHERE lifted_at IS NULL').get().n;
      tellLeads(db, { admins: true, title: 'A check-in safety setting was changed',
        body: `${req.user.name || 'An admin'} changed check-in settings (${weakened.map((k) => WEAK_WORDS[k]).join(', ')}). ${holds} ${holds === 1 ? 'hold is' : 'holds are'} on right now. Open Check-in iPads to see what changed.` });
    }
    res.json(view(to));
  });

  return r;
}
