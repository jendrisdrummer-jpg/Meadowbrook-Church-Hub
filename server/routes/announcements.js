// Announcements: a push notification (and inbox item) to the congregation or part of it, sent
// now or at a set time. Only accounts with the Announcements permission (and admins) send them.
// Phones can get announcements without an account: the app's More tab offers that to guests.
import { Router } from 'express';
import { getSetting } from '../db.js';
import { HttpError, bad, notFound, int, str, audit } from '../http.js';
import { notify, pushGuests } from '../notify.js';
import { vapidKeys } from '../push.js';
import { validEndpoint } from './notifications.js';

const TYPES = ['everyone', 'campus', 'team', 'volunteers', 'staff'];
const utcNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function requireAnnounce(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!req.user.announce) return res.status(403).json({ error: 'Sending announcements needs the Announcements permission.' });
  next();
}

const recent = new Map();
function rateLimit(key, max = 10, windowMs = 10 * 60e3) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return true;
}

// Who an audience reaches: accounts, and phones without an account (everyone or a campus).
export function reach(db, audience) {
  const ids = (audience.ids || []).map(Number).filter(Number.isInteger);
  const list = (sql, args = []) => db.prepare(sql).all(...args).map((r) => r.id);
  const inIds = ids.map(() => '?').join(',') || 'NULL';
  let users = [];
  let guests = [];
  switch (audience.type) {
    case 'everyone':
      users = list('SELECT id FROM users WHERE active = 1');
      guests = db.prepare('SELECT * FROM guest_push').all();
      break;
    case 'campus':
      users = list(`SELECT u.id FROM users u JOIN people p ON p.id = u.person_id WHERE u.active = 1 AND p.campus_id IN (${inIds})`, ids);
      guests = db.prepare(`SELECT * FROM guest_push WHERE campus_id IN (${inIds}) OR campus_id IS NULL`).all(...ids);
      break;
    case 'team':
      users = list(`SELECT DISTINCT u.id FROM users u JOIN team_members tm ON tm.person_id = u.person_id WHERE u.active = 1 AND tm.team_id IN (${inIds})`, ids);
      break;
    case 'volunteers':
      users = list('SELECT DISTINCT u.id FROM users u JOIN team_members tm ON tm.person_id = u.person_id WHERE u.active = 1');
      break;
    case 'staff':
      users = list("SELECT id FROM users WHERE active = 1 AND role IN ('staff', 'admin')");
      break;
    default:
  }
  const devices = users.length ? db.prepare(`SELECT COUNT(*) n FROM push_subscriptions WHERE user_id IN (${users.map(() => '?').join(',')})`).get(...users).n : 0;
  return { users, guests, devices: devices + guests.length };
}

function describe(db, audience) {
  const names = (table, ids) => (ids?.length ? db.prepare(`SELECT name FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids).map((r) => r.name).join(', ') : '');
  switch (audience.type) {
    case 'campus': return `People at ${names('campuses', audience.ids) || 'no campus'}`;
    case 'team': return `Team: ${names('teams', audience.ids) || 'no team'}`;
    case 'volunteers': return 'Everyone on a team';
    case 'staff': return 'Staff';
    default: return 'Everyone';
  }
}

// Sends one announcement: an inbox item and push for each account, and a push to guest phones.
export function deliver(db, a) {
  const audience = JSON.parse(a.audience);
  const { users, guests, devices } = reach(db, audience);
  const church = getSetting(db, 'church_name', 'Church');
  const link = a.link || '';
  const appUrl = link.startsWith('#') ? `/app/${link}` : link || '/app/#/inbox';
  const msg = { kind: 'announcement', title: a.title, body: a.body, url: link.startsWith('http') ? link : '/', app_url: appUrl, data: { announcement: a.id, from: church } };
  notify(db, users, msg);
  // Guests have no inbox, so with no link a tap just opens the app.
  pushGuests(db, guests, { ...msg, app_url: link ? appUrl : '/app/' });
  db.prepare("UPDATE announcements SET status = 'sent', sent_at = datetime('now'), people = ?, devices = ? WHERE id = ?").run(users.length, devices, a.id);
}

// Every minute: send what's due.
export function sendDueAnnouncements(db) {
  const due = db.prepare("SELECT * FROM announcements WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at").all(utcNow());
  for (const a of due) {
    try { deliver(db, a); } catch (e) { console.error('Announcement failed:', e.message); }
  }
  return due.length;
}

export default function announcementRoutes(db) {
  const r = Router();

  function clean(b) {
    const title = str(b.title, 80);
    if (!title) throw bad('Give the announcement a title.');
    const body = str(b.body, 400);
    let link = str(b.link, 500);
    if (link && !/^#\/[\w/?=&-]*$/.test(link) && !/^https:\/\//i.test(link)) throw bad('Links are a page in the app or start with https://');
    const type = TYPES.includes(b.audience?.type) ? b.audience.type : 'everyone';
    const ids = ['campus', 'team'].includes(type) ? [...new Set((Array.isArray(b.audience.ids) ? b.audience.ids : []).map(Number).filter(Number.isInteger))] : [];
    if (['campus', 'team'].includes(type) && !ids.length) throw bad(`Pick at least one ${type}.`);
    let sendAt = utcNow();
    if (b.send_at) {
      const t = new Date(b.send_at);
      if (Number.isNaN(t.getTime())) throw bad('Pick when to send it.');
      if (t.getTime() < Date.now() - 60e3) throw bad('That time has already passed.');
      if (t.getTime() > Date.now() + 366 * 864e5) throw bad('Schedule it within the next year.');
      sendAt = t.toISOString().replace('T', ' ').slice(0, 19);
    }
    return { title, body, link, audience: JSON.stringify({ type, ids }), send_at: sendAt };
  }

  const row = (a) => ({ ...a, audience: JSON.parse(a.audience), audience_label: describe(db, JSON.parse(a.audience)) });

  r.get('/announcements', requireAnnounce, (req, res) => {
    const rows = db.prepare(`SELECT a.*, COALESCE(NULLIF(p.nickname, ''), p.first_name) || ' ' || p.last_name sender, u.email sender_email FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by LEFT JOIN people p ON p.id = u.person_id ORDER BY a.status != 'scheduled', a.send_at DESC LIMIT 100`).all();
    res.json(rows.map((a) => ({ ...row(a), sender: a.sender || a.sender_email || '' })));
  });

  // How many people and phones an audience reaches, before sending.
  r.post('/announcements/reach', requireAnnounce, (req, res) => {
    const a = req.body?.audience || {};
    const { users, devices } = reach(db, { type: TYPES.includes(a.type) ? a.type : 'everyone', ids: Array.isArray(a.ids) ? a.ids : [] });
    res.json({ people: users.length, devices });
  });

  r.post('/announcements', requireAnnounce, (req, res) => {
    if (!rateLimit(`a${req.user.id}`)) throw new HttpError(429, 'That’s a lot of announcements. Please wait a few minutes.');
    const a = clean(req.body || {});
    const id = db.prepare('INSERT INTO announcements (title, body, link, audience, send_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a.title, a.body, a.link, a.audience, a.send_at, req.user.id).lastInsertRowid;
    audit(db, req, 'announcement', a.title);
    const made = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (made.send_at <= utcNow()) deliver(db, made);
    res.status(201).json(row(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)));
  });

  // Change or cancel one that hasn't gone out yet.
  r.patch('/announcements/:id', requireAnnounce, (req, res) => {
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(int(req.params.id));
    if (!a) throw notFound('Announcement');
    if (a.status !== 'scheduled') throw bad('This one has already gone out.');
    if (req.body?.canceled) {
      db.prepare("UPDATE announcements SET status = 'canceled' WHERE id = ?").run(a.id);
    } else {
      const c = clean({ ...row(a), ...req.body });
      db.prepare('UPDATE announcements SET title = ?, body = ?, link = ?, audience = ?, send_at = ? WHERE id = ?').run(c.title, c.body, c.link, c.audience, c.send_at, a.id);
    }
    res.json(row(db.prepare('SELECT * FROM announcements WHERE id = ?').get(a.id)));
  });

  // ---------------------------------------------------------------- guest phones
  r.get('/push/key', (_req, res) => res.json({ public_key: vapidKeys(db).publicKey }));
  r.post('/push/guest', (req, res) => {
    if (!rateLimit(`g${req.ip}`, 20)) throw new HttpError(429, 'Please try again in a few minutes.');
    const b = req.body || {};
    if (!validEndpoint(b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) throw bad('That isn’t a push subscription this app can use.');
    if (String(b.keys.p256dh).length > 200 || String(b.keys.auth).length > 100) throw bad('Invalid push keys.');
    const campus = int(b.campus_id);
    db.prepare(`INSERT INTO guest_push (endpoint, p256dh, auth, campus_id, device) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, campus_id = excluded.campus_id, device = excluded.device`)
      .run(b.endpoint, b.keys.p256dh, b.keys.auth, campus && db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campus) ? campus : null, str(b.device, 80));
    res.status(201).json({ ok: true });
  });
  r.delete('/push/guest', (req, res) => {
    db.prepare('DELETE FROM guest_push WHERE endpoint = ?').run(String(req.body?.endpoint || ''));
    res.json({ ok: true });
  });

  return r;
}
