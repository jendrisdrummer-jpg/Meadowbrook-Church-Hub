// The signed-in account's notifications: inbox, push devices and which notices they want.
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { bad, str } from '../http.js';
import { vapidKeys } from '../push.js';
import { notify, KINDS, OFF_BY_DEFAULT } from '../notify.js';

// Push messages only go to the browsers' own push services, never to an arbitrary address.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
function validEndpoint(v) {
  let u;
  try { u = new URL(String(v)); } catch { return false; }
  if (process.env.MB_PUSH_ALLOW_LOCAL === '1' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export default function notificationRoutes(db) {
  const r = Router();

  r.get('/notifications', requireRole('volunteer'), (req, res) => {
    const items = db.prepare('SELECT id, kind, title, body, url, data, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(req.user.id)
      .map(({ data, ...n }) => ({ ...n, app_url: JSON.parse(data || '{}').app_url || '' }));
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ unread, items });
  });

  // Body: { ids: [..] } or {} for all.
  r.post('/notifications/read', requireRole('volunteer'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (ids?.length) {
      db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
    } else if (!ids) {
      db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
    }
    res.json({ ok: true });
  });

  // Which notices this account wants pushed (the inbox always keeps them), and its devices.
  r.get('/me/notify', requireRole('volunteer'), (req, res) => {
    const prefs = JSON.parse(db.prepare('SELECT notify FROM users WHERE id = ?').get(req.user.id).notify || '{}');
    res.json({
      prefs: Object.fromEntries(KINDS.map((k) => [k, OFF_BY_DEFAULT.has(k) ? prefs[k] === true : prefs[k] !== false])),
      devices: db.prepare('SELECT id, endpoint, device, created_at, last_used FROM push_subscriptions WHERE user_id = ? ORDER BY id').all(req.user.id),
      public_key: vapidKeys(db).publicKey,
    });
  });

  r.patch('/me/notify', requireRole('volunteer'), (req, res) => {
    const prefs = JSON.parse(db.prepare('SELECT notify FROM users WHERE id = ?').get(req.user.id).notify || '{}');
    for (const k of KINDS) if (typeof req.body?.[k] === 'boolean') prefs[k] = req.body[k];
    db.prepare('UPDATE users SET notify = ? WHERE id = ?').run(JSON.stringify(prefs), req.user.id);
    res.json({ ok: true });
  });

  // Body: the browser's PushSubscription JSON, plus a device label.
  r.post('/push/subscriptions', requireRole('volunteer'), (req, res) => {
    const b = req.body || {};
    if (!validEndpoint(b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) throw bad('That isn’t a push subscription this app can use.');
    if (String(b.keys.p256dh).length > 200 || String(b.keys.auth).length > 100) throw bad('Invalid push keys.');
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device, ui) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, ui = excluded.ui`)
      .run(req.user.id, b.endpoint, b.keys.p256dh, b.keys.auth, str(b.device, 80), b.ui === 'app' ? 'app' : 'hub');
    res.status(201).json({ ok: true });
  });

  r.delete('/push/subscriptions', requireRole('volunteer'), (req, res) => {
    if (req.body?.id) db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?').run(Number(req.body.id), req.user.id);
    else db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  r.post('/push/test', requireRole('volunteer'), (req, res) => {
    notify(db, [req.user.id], { kind: 'test', title: 'Notifications are on', body: 'You’ll hear here when you’re scheduled and before you serve.', url: '/#/my', app_url: '/app/#/serve' });
    res.json({ ok: true });
  });

  return r;
}
