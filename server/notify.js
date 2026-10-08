// Notifications: an in-app inbox for every account, plus a push to each phone or browser that
// allowed it. Volunteers hear when they're scheduled and before they serve; team leaders hear
// when someone can't make it.
import { getSetting } from './db.js';
import { vapidKeys, sendPush } from './push.js';

export const KINDS = ['scheduled', 'reminder', 'declined'];

const name = (p) => `${p.nickname || p.first_name} ${p.last_name}`.trim();
const when = (starts) => {
  const d = new Date(`${starts}:00`);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

// Who push messages say they're from (the push services require a contact).
function subject() {
  const url = (process.env.PUBLIC_URL || '').trim();
  if (/^https:\/\//.test(url)) return url;
  const email = (process.env.MB_ADMIN_EMAILS || '').split(',')[0]?.trim();
  return `mailto:${email || 'admin@localhost'}`;
}

const prefs = (u) => {
  try { return JSON.parse(u.notify || '{}'); } catch { return {}; }
};

// Adds an inbox item for each account and pushes it to their devices (unless they turned
// that kind off). Pushes go out in the background; failures never break the request.
export function notify(db, userIds, msg) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const users = db.prepare(`SELECT id, notify FROM users WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const ins = db.prepare('INSERT INTO notifications (user_id, kind, title, body, url, data) VALUES (?, ?, ?, ?, ?, ?)');
  const made = [];
  for (const u of users) {
    const id = Number(ins.run(u.id, msg.kind, msg.title, msg.body || '', msg.url || '', JSON.stringify(msg.data || {})).lastInsertRowid);
    made.push(id);
    if (prefs(u)[msg.kind] === false) continue;
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(u.id);
    if (subs.length) pushAll(db, subs, { ...msg, id });
  }
  return made;
}

function pushAll(db, subs, msg) {
  const keys = vapidKeys(db);
  const payload = { id: msg.id, kind: msg.kind, title: msg.title, body: msg.body || '', url: msg.url || '/', tag: msg.tag, actions: msg.actions, data: msg.data || {} };
  for (const sub of subs) {
    sendPush(sub, payload, keys, subject(), { urgency: msg.kind === 'reminder' ? 'high' : 'normal' })
      .then((status) => {
        // The person uninstalled the app or turned notifications off: forget that device.
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        else if (status < 300) db.prepare("UPDATE push_subscriptions SET last_used = datetime('now') WHERE id = ?").run(sub.id);
      })
      .catch(() => {});
  }
}

const usersOf = (db, personIds) => (personIds.length
  ? db.prepare(`SELECT id, person_id FROM users WHERE active = 1 AND person_id IN (${personIds.map(() => '?').join(',')})`).all(...personIds)
  : []);

const assignmentRows = (db, ids) => (ids.length ? db.prepare(`SELECT a.id, a.person_id, a.status, a.decline_reason, a.service_id, s.starts_at,
    ps.name position, ps.team_id, t.name team, c.short_name campus_short, c.name campus, p.first_name, p.last_name, p.nickname
  FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id JOIN teams t ON t.id = ps.team_id
  JOIN campuses c ON c.id = s.campus_id JOIN people p ON p.id = a.person_id
  WHERE a.id IN (${ids.map(() => '?').join(',')}) ORDER BY s.starts_at`).all(...ids) : []);

// "You're scheduled": one message per person, however many spots they were given at once.
export function notifyScheduled(db, assignmentIds, { byUserId } = {}) {
  const rows = assignmentRows(db, assignmentIds).filter((a) => a.status !== 'declined');
  const byPerson = Map.groupBy(rows, (a) => a.person_id);
  for (const u of usersOf(db, [...byPerson.keys()])) {
    if (u.id === byUserId) continue; // scheduling yourself needs no notice
    const list = byPerson.get(u.person_id);
    const one = list.length === 1 ? list[0] : null;
    notify(db, [u.id], {
      kind: 'scheduled',
      title: one ? `You’re scheduled: ${one.position}` : `You’re scheduled ${list.length} times`,
      body: one ? `${when(one.starts_at)} · ${one.campus_short || one.campus}. Can you make it?`
        : `${list.map((a) => `${when(a.starts_at).split(' at ')[0]} (${a.position})`).join(', ')}. Please accept or decline each one.`,
      url: '/#/my',
      tag: one ? `assignment-${one.id}` : undefined,
      actions: one ? [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Can’t make it' }] : undefined,
      data: { assignment_ids: list.map((a) => a.id) },
    });
  }
}

// "Can't make it": tells the team's leaders (not the person who declined).
export function notifyDeclined(db, assignmentId) {
  const [a] = assignmentRows(db, [assignmentId]);
  if (!a) return;
  const leaders = db.prepare('SELECT DISTINCT person_id FROM team_members WHERE team_id = ? AND is_leader = 1 AND person_id != ?').all(a.team_id, a.person_id).map((r) => r.person_id);
  notify(db, usersOf(db, leaders).map((u) => u.id), {
    kind: 'declined',
    title: `${name(a)} can’t make it`,
    body: `${a.position} · ${when(a.starts_at)}${a.decline_reason ? ` — “${a.decline_reason}”` : ''}`,
    url: `/#/services/${a.service_id}`,
    tag: `declined-${a.id}`,
  });
}

// The campus's local time as "YYYY-MM-DDTHH:MM", matching how services store their start.
function localNow(tz, plusHours = 0) {
  const d = new Date(Date.now() + plusHours * 3600e3);
  try {
    return d.toLocaleString('sv-SE', { timeZone: tz || 'UTC', hour12: false }).replace(' ', 'T').slice(0, 16);
  } catch {
    return d.toISOString().slice(0, 16);
  }
}

// Reminds people a day or two before they serve (Settings: reminder_hours; 0 = off).
// Pending ones are asked to reply; accepted ones get a heads-up.
export function sendReminders(db) {
  const hours = getSetting(db, 'reminder_hours', 48);
  if (!hours) return 0;
  let sent = 0;
  for (const c of db.prepare('SELECT id, timezone FROM campuses').all()) {
    const due = db.prepare(`SELECT a.id, a.created_at FROM assignments a JOIN services s ON s.id = a.service_id
      WHERE s.campus_id = ? AND a.status != 'declined' AND a.reminded_at IS NULL AND s.starts_at > ? AND s.starts_at <= ?`)
      .all(c.id, localNow(c.timezone), localNow(c.timezone, hours));
    if (!due.length) continue;
    db.prepare(`UPDATE assignments SET reminded_at = datetime('now') WHERE id IN (${due.map(() => '?').join(',')})`).run(...due.map((a) => a.id));
    // Someone scheduled in the last few hours just got "you're scheduled"; skip the reminder.
    const fresh = new Set(due.filter((a) => Date.parse(`${a.created_at.replace(' ', 'T')}Z`) > Date.now() - 6 * 3600e3).map((a) => a.id));
    const rows = assignmentRows(db, due.map((a) => a.id).filter((id) => !fresh.has(id)));
    const users = new Map(usersOf(db, [...new Set(rows.map((a) => a.person_id))]).map((u) => [u.person_id, u.id]));
    for (const a of rows) {
      const uid = users.get(a.person_id);
      if (!uid) continue;
      const pending = a.status === 'pending';
      notify(db, [uid], {
        kind: 'reminder',
        title: pending ? `Can you serve ${when(a.starts_at).split(' at ')[0]}?` : `You’re serving ${when(a.starts_at).split(' at ')[0]}`,
        body: `${a.position} at ${when(a.starts_at).split(' at ')[1]} · ${a.campus_short || a.campus}.${pending ? ' Please accept or decline.' : ' Thank you!'}`,
        url: pending ? '/#/my' : `/#/services/${a.service_id}`,
        tag: `assignment-${a.id}`,
        actions: pending ? [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Can’t make it' }] : undefined,
        data: { assignment_ids: [a.id] },
      });
      sent++;
    }
  }
  return sent;
}
