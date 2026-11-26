// Which teams a signed-in person may see in full detail. Staff and admins see every team (campus
// rules still apply separately). A team leader who isn't staff sees full detail (declines and their
// reasons, drafts, contact details, open spots) only for teams they lead; for other teams they see
// what a volunteer sees: people who were asked or accepted, names and photo only.
// This is about visibility only. Who may schedule is still decided by canSchedule in services.js.
import { rank } from './auth.js';

// null = no limit (staff and admins). Otherwise the set of team ids this person leads.
export function ledTeamIds(db, user) {
  if (rank(user.role) >= rank('staff')) return null;
  if (!user.personId) return new Set();
  return new Set(db.prepare('SELECT team_id FROM team_members WHERE person_id = ? AND is_leader = 1').all(user.personId).map((r) => r.team_id));
}

export function seesTeamDetail(db, user, teamId) {
  const led = ledTeamIds(db, user);
  return led === null || led.has(teamId);
}

// SQL limiting a position-id column to positions of led teams. Staff and admins get a no-op.
export function ledPositionsClause(user, col) {
  if (rank(user.role) >= rank('staff')) return { sql: '1 = 1', args: [] };
  return {
    sql: `${col} IN (SELECT ps.id FROM positions ps JOIN team_members tm ON tm.team_id = ps.team_id WHERE tm.person_id = ? AND tm.is_leader = 1)`,
    args: [user.personId ?? -1],
  };
}
