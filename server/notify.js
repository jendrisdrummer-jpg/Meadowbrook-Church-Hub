// Notifications: an in-app inbox for every account, plus a push to each phone or browser that
// allowed it. Volunteers hear when they're scheduled and before they serve; team leaders hear
// when someone can't make it.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { vapidKeys, sendPush } from './push.js';
import { sendMail, mailConfigured, canSendMail } from './mail.js';

export const KINDS = ['announcement', 'scheduled', 'reminder', 'declined', 'accepted', 'connect', 'chat', 'task', 'call', 'email'];
// Notices that stay off until someone turns them on.
export const OFF_BY_DEFAULT = new Set(['accepted']);

// Staff pages opened from the member app go to the dashboard's own address.
const hub = (path) => `${(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')}${path}`;

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
    const id = Number(ins.run(u.id, msg.kind, msg.title, msg.body || '', msg.url || '', JSON.stringify({ ...msg.data, app_url: msg.app_url })).lastInsertRowid);
    made.push(id);
    if (prefs(u)[msg.kind] === false) continue;
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(u.id);
    if (subs.length) pushAll(db, subs, { ...msg, id });
  }
  return made;
}

// A push only, with no inbox item: chat messages have their own unread counts.
export function pushOnly(db, userIds, msg) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const users = db.prepare(`SELECT id, notify FROM users WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  for (const u of users) {
    if (prefs(u)[msg.kind] === false) continue;
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(u.id);
    if (subs.length) pushAll(db, subs, msg);
  }
}

function pushAll(db, subs, msg) {
  const keys = vapidKeys(db);
  for (const sub of subs) {
    // Taps open the app the device signed up from: the member app or the dashboard.
    const url = sub.ui === 'app' ? msg.app_url || '/app/' : msg.url || '/';
    const payload = { id: msg.id, kind: msg.kind, title: msg.title, body: msg.body || '', url, tag: msg.tag, renotify: msg.renotify, actions: msg.actions, data: msg.data || {} };
    sendPush(sub, payload, keys, subject(), { urgency: msg.kind === 'reminder' ? 'high' : 'normal' })
      .then((status) => {
        // The person uninstalled the app or turned notifications off: forget that device.
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        else if (status < 300) db.prepare("UPDATE push_subscriptions SET last_used = datetime('now') WHERE id = ?").run(sub.id);
      })
      .catch(() => {});
  }
}

// Announcements to phones that signed up without an account (they always open the member app).
export function pushGuests(db, rows, msg) {
  const keys = vapidKeys(db);
  for (const sub of rows) {
    sendPush(sub, { id: msg.id, kind: msg.kind, title: msg.title, body: msg.body || '', url: msg.app_url || '/app/', data: {} }, keys, subject())
      .then((status) => {
        if (status === 404 || status === 410) db.prepare('DELETE FROM guest_push WHERE id = ?').run(sub.id);
        else if (status < 300) db.prepare("UPDATE guest_push SET last_used = datetime('now') WHERE id = ?").run(sub.id);
      })
      .catch(() => {});
  }
}

const usersOf = (db, personIds) => (personIds.length
  ? db.prepare(`SELECT id, person_id FROM users WHERE active = 1 AND person_id IN (${personIds.map(() => '?').join(',')})`).all(...personIds)
  : []);

const assignmentRows = (db, ids) => (ids.length ? db.prepare(`SELECT a.id, a.person_id, a.status, a.decline_reason, a.sent_at, a.service_id, s.starts_at,
    ps.name position, ps.team_id, t.name team, c.short_name campus_short, c.name campus, p.first_name, p.last_name, p.nickname
  FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id JOIN teams t ON t.id = ps.team_id
  JOIN campuses c ON c.id = s.campus_id JOIN people p ON p.id = a.person_id
  WHERE a.id IN (${ids.map(() => '?').join(',')}) ORDER BY s.starts_at`).all(...ids) : []);

// ---------------------------------------------------------------- email
// Accept/decline links in emails work without signing in: each is signed for one assignment.
function linkSecret(db) {
  let secret = getSetting(db, 'link_secret', '');
  if (!secret) { secret = crypto.randomBytes(32).toString('base64url'); setSetting(db, 'link_secret', secret); }
  return secret;
}
export const assignmentSig = (db, assignmentId, personId) => crypto.createHmac('sha256', linkSecret(db)).update(`${assignmentId}:${personId}`).digest('base64url').slice(0, 24);
const siteUrl = () => ((process.env.MB_APP_URL || process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''));
const appUrl = () => (process.env.MB_APP_URL ? siteUrl() : `${siteUrl()}/app`) + '/';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Who gets an email: the person's address (or their account's), unless they turned emails off.
function emailTargets(db, personIds) {
  if (!personIds.length || !(mailConfigured() || canSendMail())) return new Map();
  const rows = db.prepare(`SELECT p.id, p.email, u.email user_email, u.notify FROM people p LEFT JOIN users u ON u.person_id = p.id AND u.active = 1
    WHERE p.id IN (${personIds.map(() => '?').join(',')})`).all(...personIds);
  return new Map(rows.filter((r) => prefs(r).email !== false && (r.email || r.user_email)).map((r) => [r.id, r.email || r.user_email]));
}

function mail(db, to, subject, lines, { spots = [], footer = true } = {}) {
  const church = getSetting(db, 'church_name', 'Church');
  const color = getSetting(db, 'brand_color', '#135fd1');
  const respond = (a) => `${siteUrl()}/r/${a.id}/${assignmentSig(db, a.id, a.person_id)}`;
  const text = [...lines, '', ...spots.map((a) => `${when(a.starts_at)} · ${a.position} (${a.team}) · ${a.campus}\n  Reply: ${respond(a)}`),
    '', footer ? `See your schedule in the ${church} app: ${appUrl()}` : ''].join('\n').trim();
  const btn = (href, label, primary) => `<a href="${esc(href)}" style="display:inline-block;padding:9px 14px;border-radius:9px;text-decoration:none;font-weight:600;${primary ? `background:${color};color:#fff` : 'border:1px solid #ccc;color:#111'}">${label}</a>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#111">
    <p style="font-weight:700;color:${color};margin:0 0 12px">${esc(church)}</p>
    ${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}
    ${spots.map((a) => `<div style="border:1px solid #e2e5ea;border-radius:12px;padding:12px 14px;margin:12px 0">
      <div style="font-weight:700">${esc(when(a.starts_at))}</div>
      <div style="color:#4a5160;margin:2px 0 10px">${esc(a.position)} · ${esc(a.team)} · ${esc(a.campus)}</div>
      ${btn(`${respond(a)}?do=accept`, 'Accept', true)} &nbsp; ${btn(`${respond(a)}?do=decline`, 'Can’t make it')}</div>`).join('')}
    ${footer ? `<p style="color:#7b8494;font-size:13px;margin-top:18px">See everything you’re on in the <a href="${esc(appUrl())}">${esc(church)} app</a>.</p>` : ''}</div>`;
  sendMail({ to, subject, text, html }).catch((e) => console.error(`Email to ${to} failed:`, e.message));
}

// ---------------------------------------------------------------- scheduling notices
// "You're scheduled": one message per person (app and email), however many spots they got.
export function notifyScheduled(db, assignmentIds) {
  const rows = assignmentRows(db, assignmentIds).filter((a) => a.status !== 'declined');
  const byPerson = Map.groupBy(rows, (a) => a.person_id);
  const users = new Map(usersOf(db, [...byPerson.keys()]).map((u) => [u.person_id, u.id]));
  const emails = emailTargets(db, [...byPerson.keys()]);
  for (const [personId, list] of byPerson) {
    const one = list.length === 1 ? list[0] : null;
    const title = one ? `You’re scheduled: ${one.position}` : `You’re scheduled ${list.length} times`;
    if (users.get(personId)) {
      notify(db, [users.get(personId)], {
        kind: 'scheduled',
        title,
        body: one ? `${when(one.starts_at)} · ${one.campus_short || one.campus}. Can you make it?`
          : `${list.map((a) => `${when(a.starts_at).split(' at ')[0]} (${a.position})`).join(', ')}. Please accept or decline each one.`,
        url: '/#/my',
        app_url: '/app/#/serve',
        tag: one ? `assignment-${one.id}` : undefined,
        actions: one ? [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Can’t make it' }] : undefined,
        data: { assignment_ids: list.map((a) => a.id) },
      });
    }
    if (emails.has(personId)) {
      mail(db, emails.get(personId), one ? `${title} on ${when(one.starts_at).split(' at ')[0]}` : title,
        [`Hi ${list[0].nickname || list[0].first_name},`, one ? 'You’ve been scheduled to serve. Can you make it?' : `You’ve been scheduled to serve ${list.length} times. Please let us know about each one.`],
        { spots: list });
    }
  }
}

// "You're no longer needed": for someone taken off a spot after they were told about it.
export function notifyUnscheduled(db, a) {
  if (!a?.sent_at || a.status === 'declined') return;
  const [u] = usersOf(db, [a.person_id]);
  const day = when(a.starts_at).split(' at ')[0];
  if (u) notify(db, [u.id], { kind: 'scheduled', title: `No longer needed ${day}`, body: `You’ve been taken off ${a.position} at ${when(a.starts_at).split(' at ')[1]}. Thank you!`, url: '/#/my', app_url: '/app/#/serve' });
  const emails = emailTargets(db, [a.person_id]);
  if (emails.has(a.person_id)) mail(db, emails.get(a.person_id), `Schedule change: ${day}`, [`Hi ${a.nickname || a.first_name},`, `You’re no longer needed for ${a.position} on ${when(a.starts_at)} at ${a.campus}. Thank you for being willing to serve!`]);
}

export const assignmentRow = (db, id) => assignmentRows(db, [id])[0];

// A reply to a request: the team's leaders and whoever sent the request hear about it.
// "Can't make it" comes by app and email; "accepted" only to those who turned it on.
export function notifyResponse(db, assignmentId, status) {
  const [a] = assignmentRows(db, [assignmentId]);
  if (!a) return;
  const leaderPeople = db.prepare('SELECT DISTINCT person_id FROM team_members WHERE team_id = ? AND is_leader = 1').all(a.team_id).map((r) => r.person_id);
  const ids = new Set(usersOf(db, leaderPeople).map((u) => u.id));
  const sender = db.prepare('SELECT sent_by FROM assignments WHERE id = ?').get(a.id)?.sent_by;
  if (sender) ids.add(sender);
  // Not the person replying, and only active accounts.
  const users = ids.size ? db.prepare(`SELECT id, email, person_id, notify FROM users WHERE active = 1 AND id IN (${[...ids].map(() => '?').join(',')})`).all(...ids)
    .filter((u) => u.person_id !== a.person_id) : [];
  const declined = status === 'declined';
  const kind = declined ? 'declined' : 'accepted';
  const wanted = users.filter((u) => (OFF_BY_DEFAULT.has(kind) ? prefs(u)[kind] === true : prefs(u)[kind] !== false));
  if (!wanted.length) return;
  notify(db, wanted.map((u) => u.id), {
    kind,
    title: declined ? `${name(a)} can’t make it` : `${name(a)} accepted`,
    body: `${a.position} · ${when(a.starts_at)} · ${a.campus_short || a.campus}${declined && a.decline_reason ? ` — “${a.decline_reason}”` : ''}`,
    url: `/#/services/${a.service_id}`,
    app_url: hub(`/#/services/${a.service_id}`),
    tag: `${kind}-${a.id}`,
  });
  if (!declined || !(mailConfigured() || canSendMail())) return;
  for (const u of wanted) {
    if (prefs(u).email === false) continue;
    const to = (u.person_id && db.prepare("SELECT email FROM people WHERE id = ? AND email != ''").get(u.person_id)?.email) || u.email;
    mail(db, to, `${name(a)} can’t make it ${when(a.starts_at).split(' at ')[0]}`,
      [`${name(a)} can’t serve as ${a.position} (${a.team}) on ${when(a.starts_at)} at ${a.campus}.`,
        a.decline_reason ? `Their note: “${a.decline_reason}”` : 'They didn’t leave a note.',
        `Find someone else: ${hub(`/#/services/${a.service_id}`) || `/#/services/${a.service_id}`}`], { footer: false });
  }
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
    const due = db.prepare(`SELECT a.id, a.sent_at FROM assignments a JOIN services s ON s.id = a.service_id
      WHERE s.campus_id = ? AND a.status != 'declined' AND a.sent_at IS NOT NULL AND a.reminded_at IS NULL AND s.starts_at > ? AND s.starts_at <= ?`)
      .all(c.id, localNow(c.timezone), localNow(c.timezone, hours));
    if (!due.length) continue;
    db.prepare(`UPDATE assignments SET reminded_at = datetime('now') WHERE id IN (${due.map(() => '?').join(',')})`).run(...due.map((a) => a.id));
    // Someone scheduled in the last few hours just got "you're scheduled"; skip the reminder.
    const fresh = new Set(due.filter((a) => Date.parse(`${a.sent_at.replace(' ', 'T')}Z`) > Date.now() - 6 * 3600e3).map((a) => a.id));
    const rows = assignmentRows(db, due.map((a) => a.id).filter((id) => !fresh.has(id)));
    const users = new Map(usersOf(db, [...new Set(rows.map((a) => a.person_id))]).map((u) => [u.person_id, u.id]));
    const emails = emailTargets(db, [...new Set(rows.map((a) => a.person_id))]);
    for (const a of rows) {
      const uid = users.get(a.person_id);
      const pending = a.status === 'pending';
      if (emails.has(a.person_id)) {
        mail(db, emails.get(a.person_id), pending ? `Can you serve ${when(a.starts_at).split(' at ')[0]}?` : `Reminder: you’re serving ${when(a.starts_at).split(' at ')[0]}`,
          [`Hi ${a.nickname || a.first_name},`, pending ? 'We haven’t heard back yet. Can you make it?' : `Thanks for serving! ${a.position} at ${when(a.starts_at)}, ${a.campus}.`], { spots: pending ? [a] : [] });
      }
      if (emails.has(a.person_id) || uid) sent++;
      if (!uid) continue;
      notify(db, [uid], {
        kind: 'reminder',
        title: pending ? `Can you serve ${when(a.starts_at).split(' at ')[0]}?` : `You’re serving ${when(a.starts_at).split(' at ')[0]}`,
        body: `${a.position} at ${when(a.starts_at).split(' at ')[1]} · ${a.campus_short || a.campus}.${pending ? ' Please accept or decline.' : ' Thank you!'}`,
        url: pending ? '/#/my' : `/#/services/${a.service_id}`,
        app_url: pending ? '/app/#/serve' : `/app/#/plan/${a.service_id}`,
        tag: `assignment-${a.id}`,
        actions: pending ? [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Can’t make it' }] : undefined,
        data: { assignment_ids: [a.id] },
      });
    }
  }
  return sent;
}
