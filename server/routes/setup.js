// Campuses, kids' rooms, service types, church settings and user accounts.
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole, canCampus, ROLES, SIGN_IN_POLICIES } from '../auth.js';
import { getSetting, setSetting, updateFields } from '../db.js';
import { bad, notFound, forbidden, int, str, required, oneOf, audit } from '../http.js';

export default function setupRoutes(db, { uploadDir } = {}) {
  const r = Router();
  const campus = (id) => db.prepare('SELECT * FROM campuses WHERE id = ?').get(id);

  // ---------------------------------------------------------------- app icon
  // The installed app's home-screen icon, one PNG per size (the page resizes the upload).
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  r.post('/app-icon/:size', requireRole('admin'), express.raw({ type: 'image/png', limit: '2mb' }), (req, res) => {
    if (!['180', '192', '512'].includes(req.params.size)) throw bad('Sizes are 180, 192 and 512.');
    if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 4).equals(PNG)) throw bad('Send a PNG image.');
    fs.mkdirSync(path.join(uploadDir, 'app-icon'), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, 'app-icon', `${req.params.size}.png`), req.body);
    setSetting(db, 'app_icon_version', Date.now());
    res.json({ ok: true });
  });
  r.delete('/app-icon', requireRole('admin'), (_req, res) => {
    fs.rmSync(path.join(uploadDir, 'app-icon'), { recursive: true, force: true });
    setSetting(db, 'app_icon_version', Date.now());
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- campuses
  r.get('/campuses', requireRole('volunteer'), (_req, res) => {
    res.json(db.prepare('SELECT * FROM campuses ORDER BY active DESC, sort, name').all());
  });

  r.post('/campuses', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const info = db.prepare('INSERT INTO campuses (name, short_name, address, timezone, color, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(required(b.name, 'Name'), str(b.short_name, 20), str(b.address), validTz(b.timezone), color(b.color), int(b.sort) ?? 0);
    audit(db, req, 'campus.create', b.name);
    res.status(201).json(campus(info.lastInsertRowid));
  });

  r.patch('/campuses/:id', requireRole('admin'), (req, res) => {
    if (!campus(req.params.id)) throw notFound('Campus');
    const b = { ...req.body };
    if (b.timezone !== undefined) b.timezone = validTz(b.timezone);
    if (b.color !== undefined) b.color = color(b.color);
    if (b.name !== undefined) b.name = required(b.name, 'Name');
    updateFields(db, 'campuses', req.params.id, b, ['name', 'short_name', 'address', 'timezone', 'color', 'active', 'sort']);
    res.json(campus(req.params.id));
  });

  // ---------------------------------------------------------------- rooms
  r.get('/rooms', requireRole('volunteer'), (req, res) => {
    const id = int(req.query.campus_id);
    const rows = id
      ? db.prepare('SELECT * FROM rooms WHERE campus_id = ? AND archived = 0 ORDER BY sort, name').all(id)
      : db.prepare('SELECT * FROM rooms WHERE archived = 0 ORDER BY campus_id, sort, name').all();
    res.json(rows);
  });

  const roomFields = (b) => ({
    name: b.name !== undefined ? required(b.name, 'Room name') : undefined,
    min_age_months: b.min_age_months !== undefined ? int(b.min_age_months, 'Minimum age') : undefined,
    max_age_months: b.max_age_months !== undefined ? int(b.max_age_months, 'Maximum age') : undefined,
    min_grade: b.min_grade !== undefined ? int(b.min_grade, 'Minimum grade') : undefined,
    max_grade: b.max_grade !== undefined ? int(b.max_grade, 'Maximum grade') : undefined,
    capacity: b.capacity !== undefined ? int(b.capacity, 'Capacity') : undefined,
    sort: b.sort !== undefined ? int(b.sort) ?? 0 : undefined,
    archived: b.archived,
  });

  r.post('/rooms', requireRole('staff'), (req, res) => {
    const campusId = int(req.body?.campus_id, 'Campus');
    if (!campus(campusId)) throw bad('Pick a campus.');
    if (!canCampus(req.user, campusId)) throw forbidden();
    const f = roomFields({ sort: 0, ...req.body });
    const info = db.prepare(`INSERT INTO rooms (campus_id, name, min_age_months, max_age_months, min_grade, max_grade, capacity, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(campusId, required(f.name, 'Room name'), f.min_age_months ?? null, f.max_age_months ?? null, f.min_grade ?? null, f.max_grade ?? null, f.capacity ?? null, f.sort ?? 0);
    res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid));
  });

  r.patch('/rooms/:id', requireRole('staff'), (req, res) => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) throw notFound('Room');
    if (!canCampus(req.user, room.campus_id)) throw forbidden();
    updateFields(db, 'rooms', room.id, roomFields(req.body || {}), ['name', 'min_age_months', 'max_age_months', 'min_grade', 'max_grade', 'capacity', 'sort', 'archived']);
    res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id));
  });

  // ---------------------------------------------------------------- settings
  const SETTINGS = {
    church_name: 'Meadowbrook Church',
    brand_color: '#135fd1',
    workspace_domain: '',
    sign_in_policy: 'anyone',
    plan_edit_role: 'leader',
    schedule_role: 'team_leaders',
    label_size: 'brother-62x29',
    checkin_print_parent_tag: true,
    headcount_areas: ['Auditorium', 'Overflow', 'Online'],
    reminder_hours: 48,
    app_short_name: '',
  };

  r.get('/settings', requireRole('volunteer'), (_req, res) => {
    res.json({
      ...Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, getSetting(db, k, v)])),
      app_icon_version: getSetting(db, 'app_icon_version', 0),
      custom_app_icon: fs.existsSync(path.join(uploadDir, 'app-icon', '512.png')),
      app_url: `${(process.env.MB_APP_URL || '').trim().replace(/\/+$/, '')}/app/`,
    });
  });

  r.patch('/settings', requireRole('admin'), (req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!(k in SETTINGS)) continue;
      if (typeof v !== typeof SETTINGS[k] || Array.isArray(v) !== Array.isArray(SETTINGS[k])) throw bad(`Invalid value for ${k}.`);
      if (k === 'sign_in_policy' && !SIGN_IN_POLICIES.includes(v)) throw bad('Unknown sign-in option.');
      if (k === 'brand_color' && !/^#[0-9a-f]{6}$/i.test(v)) throw bad('Colours look like #135fd1.');
      if (k === 'plan_edit_role' && !['leader', 'staff', 'admin'].includes(v)) throw bad('Unknown option.');
      if (k === 'reminder_hours' && !(Number.isInteger(v) && v >= 0 && v <= 168)) throw bad('Reminders can go out up to 168 hours (a week) ahead, or 0 for none.');
      if (k === 'schedule_role' && !['team_leaders', 'staff', 'admin'].includes(v)) throw bad('Unknown option.');
      setSetting(db, k, k === 'workspace_domain' ? str(v).toLowerCase().replace(/^@/, '') : v);
    }
    audit(db, req, 'settings.update', Object.keys(req.body || {}).join(','));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- users
  r.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    res.json(req.user);
  });

  // Personal preferences anyone can change for themselves.
  r.patch('/me', requireRole('volunteer'), (req, res) => {
    if (req.body?.theme !== undefined) {
      db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(oneOf(req.body.theme, ['light', 'dark', 'device'], 'light'), req.user.id);
    }
    res.json({ ok: true });
  });

  // Accounts with more than volunteer access, or (?q=) anyone matching a search. Everyone in
  // People gets a volunteer account by signing in, so those don't need listing.
  r.get('/users', requireRole('admin'), (req, res) => {
    const q = str(req.query.q, 100).toLowerCase();
    const rows = db.prepare(`SELECT u.id, u.email, u.role, u.person_id, u.campus_ids, u.active, u.last_login, u.created_at,
        u.password_hash IS NOT NULL has_password, p.first_name, p.last_name
      FROM users u LEFT JOIN people p ON p.id = u.person_id
      WHERE ${q ? "(lower(u.email) LIKE ? OR lower(p.first_name || ' ' || p.last_name) LIKE ?)" : "(u.role != 'volunteer' OR u.active = 0)"}
      ORDER BY u.role = 'volunteer', u.email LIMIT 200`).all(...(q ? [`%${q}%`, `%${q}%`] : []));
    const volunteers = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'volunteer' AND active = 1").get().n;
    const withEmail = db.prepare("SELECT COUNT(*) n FROM people WHERE archived = 0 AND email != ''").get().n;
    res.json({ users: rows.map((u) => ({ ...u, has_password: Boolean(u.has_password), campus_ids: u.campus_ids ? JSON.parse(u.campus_ids) : null })), volunteers, people_with_email: withEmail });
  });

  // Removes the sign-in (and its sessions and devices). The person stays in People.
  r.delete('/users/:id', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound('Account');
    if (u.id === req.user.id) throw bad('You can’t delete your own account. Ask another admin.');
    if (u.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1) {
      throw bad('This is the only admin. Make someone else an admin first.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    audit(db, req, 'user.delete', u.email);
    res.json({ ok: true });
  });

  r.post('/users', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const email = required(b.email, 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('That email doesn’t look right.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('There is already an account for that email.');
    const person = int(b.person_id) ?? db.prepare("SELECT id FROM people WHERE lower(email) = ? AND archived = 0 LIMIT 1").get(email)?.id ?? null;
    const info = db.prepare('INSERT INTO users (email, role, person_id, campus_ids) VALUES (?, ?, ?, ?)')
      .run(email, oneOf(b.role, ROLES, 'volunteer'), person, campusList(b.campus_ids));
    audit(db, req, 'user.create', `${email} as ${b.role}`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/users/:id', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound('Account');
    const b = { ...req.body };
    if (b.role !== undefined) b.role = oneOf(b.role, ROLES, u.role);
    if (b.campus_ids !== undefined) b.campus_ids = campusList(b.campus_ids);
    if (b.person_id !== undefined) b.person_id = int(b.person_id);
    // Never let the last admin lock everyone out.
    if (u.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === false || b.active === 0)) {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw bad('This is the only admin. Make someone else an admin first.');
    }
    updateFields(db, 'users', u.id, b, ['role', 'campus_ids', 'person_id', 'active']);
    if (b.active === false || b.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, req, 'user.update', { id: u.id, ...req.body });
    res.json({ ok: true });
  });

  return r;
}

function campusList(v) {
  if (v == null || v === 'all') return null;
  if (!Array.isArray(v)) throw bad('campus_ids must be a list or "all".');
  return JSON.stringify(v.map((x) => int(x, 'Campus')));
}

function validTz(tz) {
  tz = str(tz) || 'America/Chicago';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    throw bad('Unknown time zone.');
  }
}

function color(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#2f7d4f';
}
