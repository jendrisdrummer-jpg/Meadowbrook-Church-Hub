// Check-in stations: an iPad opens /checkin, shows a code, and staff type that code into the hub
// (Check-in → Stations) with a name and campus. The iPad then works as a station with no one
// signed in, until it's removed in the hub. A station can only use check-in, at its campus.
import { Router } from 'express';
import { createLimiter, ipAllowed } from '../ratelimit.js';
import crypto from 'node:crypto';
import { requireRole, canCampus } from '../auth.js';
import { HttpError, bad, notFound, forbidden, int, str, required, audit } from '../http.js';
import { tx } from '../db.js';
import { recordEvent, appVersion } from '../checkin-events.js';
import { STATION_LETTERS } from '../../public/js/checkin-rules.js';
import { checkinFeatures, ipadFeatures } from '../checkin-settings.js';

const HEADER = 'x-station';
const PAIR_MIN = 15;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

// What a paired station may do: check-in itself, list campuses, and add a new guest family.
// Express matches routes ignoring case and a trailing slash, so compare the same way.
const stationMay = (req) => {
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  return p.startsWith('/checkin/') || p === '/campuses' || (req.method === 'POST' && p === '/people');
};

// For those requests with no one signed in: a paired station acts as a check-in leader limited
// to its own campus. Everything else stays signed out.
export function stationAuth(db) {
  const find = db.prepare('SELECT d.*, c.name campus_name FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id WHERE d.token_hash = ?');
  const setVersion = db.prepare('UPDATE checkin_devices SET app_version = ?, app_version_at = ? WHERE id = ?');
  const seen = db.prepare("UPDATE checkin_devices SET last_seen = datetime('now') WHERE id = ? AND (last_seen IS NULL OR last_seen < datetime('now', '-5 minutes'))");
  return (req, res, next) => {
    const token = req.get(HEADER);
    // The station token wins over a hub session: an admin's cookie left on a kiosk must not widen what the
    // iPad can do, so with a token the request is the station's (and a removed station is told so).
    if (!token || !stationMay(req)) return next();
    const d = find.get(hash(String(token)));
    if (!d) return res.status(401).json({ error: 'This station was removed. Pair it again.', station_removed: true });
    seen.run(d.id);
    // Remember which check-in app version this iPad runs, so the hub can show who needs to reload.
    const version = appVersion(req);
    if (version !== d.app_version) setVersion.run(version, new Date().toISOString(), d.id);
    req.user = { id: null, role: 'leader', name: d.name, campusIds: [d.campus_id], station: d };
    next();
  };
}

export default function stationRoutes(db) {
  const r = Router();
  // Limits for pairing and pairing-code tries; one limiter per app (IPv6 per /64 and /48).
  const limits = createLimiter();
  const rateLimit = (key, max = 20, windowMs = 10 * 60e3) => limits.hit(key, max, windowMs);
  db.prepare("DELETE FROM device_pairings WHERE expires_at < datetime('now')").run();

  // ---------------------------------------------------------------- the iPad
  // Starts pairing: a code to show, and a secret to collect the result with.
  r.post('/checkin/pair', (req, res) => {
    if (!ipAllowed(limits, 'pair', req.ip, 20, 10 * 60e3, { wide: 8 })) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
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
    const d = db.prepare('SELECT d.id, d.name, d.campus_id, d.print, d.station_letter, c.name campus_name FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id WHERE d.id = ?').get(id);
    // stationLetter starts every pickup code this iPad makes; null (a campus with 21 stations already) means it picks a random one.
    return d && { id: d.id, name: d.name, campusId: d.campus_id, campusName: d.campus_name, print: Boolean(d.print), stationLetter: d.station_letter };
  };
  r.get('/checkin/station', (req, res) => {
    if (!req.user?.station) throw notFound('Station');
    res.set('Cache-Control', 'no-store');
    res.json({ ...station(req.user.station.id), features: ipadFeatures(checkinFeatures(db)) });
  });

  // ---------------------------------------------------------------- the hub
  // A station letter is unique within a campus, so two iPads can never make the same pickup code. A new station gets
  // the first free one; a replacement iPad can be given the letter of the one it replaces.
  const lettersAt = (campusId) => new Map(db.prepare('SELECT station_letter l, name FROM checkin_devices WHERE campus_id = ? AND station_letter IS NOT NULL').all(campusId).map((x) => [x.l, x.name]));
  const freeLetter = (campusId) => [...STATION_LETTERS].find((l) => !lettersAt(campusId).has(l)) ?? null;

  r.get('/checkin/devices', requireRole('staff'), (req, res) => {
    const rows = db.prepare(`SELECT d.id, d.name, d.campus_id, d.print, d.device, d.station_letter, d.created_at, d.last_seen, d.app_version, d.app_version_at, c.name campus_name,
        COALESCE(NULLIF(p.nickname, ''), p.first_name) || ' ' || p.last_name added_by
      FROM checkin_devices d JOIN campuses c ON c.id = d.campus_id LEFT JOIN users u ON u.id = d.created_by LEFT JOIN people p ON p.id = u.person_id
      ORDER BY c.sort, c.name, d.name`).all();
    res.json(rows.filter((d) => canCampus(req.user, d.campus_id)));
  });

  // Body: { code, name, campus_id, print, station_letter? } (the letter defaults to the first free one at that campus)
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
    const asked = str(b.station_letter, 8).toUpperCase();
    if (asked && !(asked.length === 1 && STATION_LETTERS.includes(asked))) throw bad(`A station letter is one letter from ${STATION_LETTERS}.`);
    const taken = asked ? lettersAt(campusId).get(asked) : undefined;
    if (taken !== undefined) throw new HttpError(409, `Letter ${asked} is already used by ${taken} at this campus. Remove that station first if this iPad is replacing it, or pick another letter.`);
    const letter = asked || freeLetter(campusId);
    const token = crypto.randomBytes(32).toString('hex');
    const id = tx(db, () => {
      const newId = db.prepare('INSERT INTO checkin_devices (name, campus_id, print, token_hash, device, created_by, station_letter) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, campusId, b.print === false ? 0 : 1, hash(token), p.device, req.user.id, letter).lastInsertRowid;
      db.prepare('UPDATE device_pairings SET token = ?, device_id = ? WHERE code = ?').run(token, newId, code);
      audit(db, req, 'checkin.device', `${name} (${p.device || 'device'})`);
      recordEvent(db, req, { action: 'device.pair', campusId, deviceId: Number(newId), deviceName: name, detail: { name, station_letter: letter } });
      return newId;
    });
    res.status(201).json({ id: Number(id), station_letter: letter });
  });

  r.patch('/checkin/devices/:id', requireRole('staff'), (req, res) => {
    const d = db.prepare('SELECT * FROM checkin_devices WHERE id = ?').get(int(req.params.id));
    if (!d) throw notFound('Station');
    if (!canCampus(req.user, d.campus_id)) throw forbidden();
    const b = req.body || {};
    const campusId = b.campus_id !== undefined ? int(b.campus_id, 'Campus') : d.campus_id;
    if (!campusId || !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId) || !canCampus(req.user, campusId)) throw bad('Pick a campus.');
    const name = str(b.name ?? d.name, 60) || d.name;
    const print = b.print === undefined ? d.print : b.print ? 1 : 0;
    // A station keeps its letter unless the campus it moves to already uses it, then it takes the first free one there.
    const moved = campusId !== d.campus_id;
    const letter = !moved ? d.station_letter : d.station_letter && !lettersAt(campusId).has(d.station_letter) ? d.station_letter : freeLetter(campusId);
    tx(db, () => {
      db.prepare('UPDATE checkin_devices SET name = ?, campus_id = ?, print = ?, station_letter = ? WHERE id = ?').run(name, campusId, print, letter, d.id);
      const fields = [name !== d.name && 'name', campusId !== d.campus_id && 'campus', print !== d.print && 'print'].filter(Boolean);
      const detail = { fields, from_campus: d.campus_id, to_campus: campusId, ...(letter !== d.station_letter ? { station_letter: letter, from_station_letter: d.station_letter } : {}) };
      recordEvent(db, req, { action: 'device.update', campusId, deviceId: d.id, deviceName: name, detail });
      // A move is also written under the campus it left, so that campus's record shows it went.
      if (campusId !== d.campus_id) recordEvent(db, req, { action: 'device.update', campusId: d.campus_id, deviceId: d.id, deviceName: name, detail });
    });
    res.json({ ok: true });
  });

  // Removing a station signs that iPad out of check-in for good.
  r.delete('/checkin/devices/:id', requireRole('staff'), (req, res) => {
    const d = db.prepare('SELECT * FROM checkin_devices WHERE id = ?').get(int(req.params.id));
    if (!d) throw notFound('Station');
    if (!canCampus(req.user, d.campus_id)) throw forbidden();
    tx(db, () => {
      db.prepare('DELETE FROM checkin_devices WHERE id = ?').run(d.id);
      audit(db, req, 'checkin.device.remove', d.name);
      recordEvent(db, req, { action: 'device.remove', campusId: d.campus_id, deviceId: d.id, deviceName: d.name, detail: { name: d.name } });
    });
    res.json({ ok: true });
  });

  return r;
}
