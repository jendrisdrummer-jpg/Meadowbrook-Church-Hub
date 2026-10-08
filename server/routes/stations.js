// Check-in stations: an iPad opens /checkin, shows a code, and staff type that code into the hub
// (Check-in → Stations) with a name and campus. The iPad then works as a station with no one
// signed in, until it's removed in the hub. A station can only use check-in, at its campus.
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireRole, canCampus } from '../auth.js';
import { HttpError, bad, notFound, forbidden, int, str, required, audit } from '../http.js';

const HEADER = 'x-station';
const PAIR_MIN = 15;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

const recent = new Map();
function rateLimit(key, max = 20, windowMs = 10 * 60e3) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return true;
}

// What a paired station may do: check-in itself, list campuses, and add a new guest family.
const stationMay = (req) => req.path.startsWith('/checkin/') || req.path === '/campuses' || (req.method === 'POST' && req.path === '/people');

// For those requests with no one signed in: a paired station acts as a check-in leader limited
// to its own campus. Everything else stays signed out.
export function stationAuth(db) {
  const find = db.prepare('SELECT d.*, c.name campus_name FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id WHERE d.token_hash = ?');
  const seen = db.prepare("UPDATE checkin_devices SET last_seen = datetime('now') WHERE id = ? AND (last_seen IS NULL OR last_seen < datetime('now', '-5 minutes'))");
  return (req, res, next) => {
    const token = req.get(HEADER);
    if (req.user || !token || !stationMay(req)) return next();
    const d = find.get(hash(String(token)));
    if (!d) return res.status(401).json({ error: 'This station was removed. Pair it again.', station_removed: true });
    seen.run(d.id);
    req.user = { id: null, role: 'leader', name: d.name, campusIds: [d.campus_id], station: d };
    next();
  };
}

export default function stationRoutes(db) {
  const r = Router();
  db.prepare("DELETE FROM device_pairings WHERE expires_at < datetime('now')").run();

  // ---------------------------------------------------------------- the iPad
  // Starts pairing: a code to show, and a secret to collect the result with.
  r.post('/checkin/pair', (req, res) => {
    if (!rateLimit(req.ip)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    db.prepare("DELETE FROM device_pairings WHERE expires_at < datetime('now')").run();
    const secret = crypto.randomBytes(24).toString('hex');
    let code;
    do code = makeCode(); while (db.prepare('SELECT 1 FROM device_pairings WHERE code = ?').get(code));
    db.prepare(`INSERT INTO device_pairings (code, secret, device, expires_at) VALUES (?, ?, ?, datetime('now', '+${PAIR_MIN} minutes'))`)
      .run(code, secret, str(req.body?.device, 80));
    res.status(201).json({ code, secret, expires_in: PAIR_MIN * 60 });
  });

  // The iPad asks every few seconds; once staff enter the code it gets its token (once).
  r.get('/checkin/pair/:secret', (req, res) => {
    const p = db.prepare("SELECT * FROM device_pairings WHERE secret = ? AND expires_at >= datetime('now')").get(String(req.params.secret));
    if (!p) return res.status(404).json({ error: 'This code expired. Start again for a new one.', expired: true });
    if (!p.token) return res.json({ paired: false });
    db.prepare('DELETE FROM device_pairings WHERE code = ?').run(p.code);
    res.json({ paired: true, token: p.token, station: station(p.device_id) });
  });

  // A paired iPad reads its own settings (name, campus, labels) on start.
  const station = (id) => {
    const d = db.prepare('SELECT d.id, d.name, d.campus_id, d.print, c.name campus_name FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id WHERE d.id = ?').get(id);
    return d && { id: d.id, name: d.name, campusId: d.campus_id, campusName: d.campus_name, print: Boolean(d.print) };
  };
  r.get('/checkin/station', (req, res) => {
    if (!req.user?.station) throw notFound('Station');
    res.json(station(req.user.station.id));
  });

  // ---------------------------------------------------------------- the hub
  r.get('/checkin/devices', requireRole('staff'), (req, res) => {
    const rows = db.prepare(`SELECT d.id, d.name, d.campus_id, d.print, d.device, d.created_at, d.last_seen, c.name campus_name,
        COALESCE(NULLIF(p.nickname, ''), p.first_name) || ' ' || p.last_name added_by
      FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id LEFT JOIN users u ON u.id = d.created_by LEFT JOIN people p ON p.id = u.person_id
      ORDER BY c.sort, c.name, d.name`).all();
    res.json(rows.filter((d) => canCampus(req.user, d.campus_id)));
  });

  // Body: { code, name, campus_id, print }
  r.post('/checkin/devices', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    if (!rateLimit(`u${req.user.id}`, 30)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const code = str(b.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const p = db.prepare("SELECT * FROM device_pairings WHERE code = ? AND expires_at >= datetime('now') AND token IS NULL").get(code);
    if (!p) throw bad('That code didn’t match. Check the code on the iPad (it changes every 15 minutes).');
    const campusId = int(b.campus_id, 'Campus');
    if (!campusId || !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId)) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    const name = required(b.name, 'Station name').slice(0, 60);
    const token = crypto.randomBytes(32).toString('hex');
    const id = db.prepare('INSERT INTO checkin_devices (name, campus_id, print, token_hash, device, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, campusId, b.print === false ? 0 : 1, hash(token), p.device, req.user.id).lastInsertRowid;
    db.prepare('UPDATE device_pairings SET token = ?, device_id = ? WHERE code = ?').run(token, id, code);
    audit(db, req, 'checkin.device', `${name} (${p.device || 'device'})`);
    res.status(201).json({ id: Number(id) });
  });

  r.patch('/checkin/devices/:id', requireRole('staff'), (req, res) => {
    const d = db.prepare('SELECT * FROM checkin_devices WHERE id = ?').get(int(req.params.id));
    if (!d) throw notFound('Station');
    if (!canCampus(req.user, d.campus_id)) throw forbidden();
    const b = req.body || {};
    const campusId = b.campus_id !== undefined ? int(b.campus_id, 'Campus') : d.campus_id;
    if (!campusId || !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId) || !canCampus(req.user, campusId)) throw bad('Pick a campus.');
    db.prepare('UPDATE checkin_devices SET name = ?, campus_id = ?, print = ? WHERE id = ?')
      .run(str(b.name ?? d.name, 60) || d.name, campusId, b.print === undefined ? d.print : b.print ? 1 : 0, d.id);
    res.json({ ok: true });
  });

  // Removing a station signs that iPad out of check-in for good.
  r.delete('/checkin/devices/:id', requireRole('staff'), (req, res) => {
    const d = db.prepare('SELECT * FROM checkin_devices WHERE id = ?').get(int(req.params.id));
    if (!d) throw notFound('Station');
    if (!canCampus(req.user, d.campus_id)) throw forbidden();
    db.prepare('DELETE FROM checkin_devices WHERE id = ?').run(d.id);
    audit(db, req, 'checkin.device.remove', d.name);
    res.json({ ok: true });
  });

  return r;
}
