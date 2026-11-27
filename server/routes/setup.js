// Campuses, kids' rooms, service types, church settings and user accounts.
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole, requireAllCampuses, accountInReach, canCampus, ROLES, rank, SIGN_IN_POLICIES, wouldBeAdmin } from '../auth.js';
import { getSetting, setSetting, updateFields, ensureAccountLinkIndex, duplicateAccountLinks } from '../db.js';
import { bad, notFound, forbidden, int, str, required, oneOf, audit, HttpError } from '../http.js';
import { notify } from '../notify.js';
import { closeStreams } from '../live.js';
import { revokeCheckin } from './checkin.js';
import { syncLeaderAccessFor } from './teams.js';
import { linkSuggestion } from '../link-suggestion.js';

export default function setupRoutes(db, { uploadDir } = {}) {
  const r = Router();
  const campus = (id) => db.prepare('SELECT * FROM campuses WHERE id = ?').get(id);

  // ---------------------------------------------------------------- app icon
  // The installed app's home-screen icon, one PNG per size (the page resizes the upload).
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  r.post('/app-icon/:size', requireRole('admin'), requireAllCampuses, express.raw({ type: 'image/png', limit: '2mb' }), (req, res) => {
    if (!['180', '192', '512'].includes(req.params.size)) throw bad('Sizes are 180, 192 and 512.');
    if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 4).equals(PNG)) throw bad('Send a PNG image.');
    fs.mkdirSync(path.join(uploadDir, 'app-icon'), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, 'app-icon', `${req.params.size}.png`), req.body);
    setSetting(db, 'app_icon_version', Date.now());
    res.json({ ok: true });
  });
  r.delete('/app-icon', requireRole('admin'), requireAllCampuses, (_req, res) => {
    fs.rmSync(path.join(uploadDir, 'app-icon'), { recursive: true, force: true });
    setSetting(db, 'app_icon_version', Date.now());
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- campuses
  r.get('/campuses', requireRole('volunteer'), (_req, res) => {
    res.json(db.prepare('SELECT * FROM campuses ORDER BY active DESC, sort, name').all());
  });

  r.post('/campuses', requireRole('admin'), requireAllCampuses, (req, res) => {
    const b = req.body || {};
    const info = db.prepare('INSERT INTO campuses (name, short_name, address, timezone, color, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(required(b.name, 'Name'), str(b.short_name, 20), str(b.address), validTz(b.timezone), color(b.color), int(b.sort) ?? 0);
    if (b.attendance_mode !== undefined) db.prepare('UPDATE campuses SET attendance_mode = ? WHERE id = ?').run(oneOf(b.attendance_mode, ['names', 'headcount', 'both'], 'both'), info.lastInsertRowid);
    audit(db, req, 'campus.create', b.name);
    res.status(201).json(campus(info.lastInsertRowid));
  });

  r.patch('/campuses/:id', requireRole('admin'), (req, res) => {
    if (!campus(req.params.id)) throw notFound('Campus');
    if (!canCampus(req.user, req.params.id)) throw forbidden(); // a campus-limited admin edits only their own campuses
    const b = { ...req.body };
    if (b.timezone !== undefined) b.timezone = validTz(b.timezone);
    if (b.color !== undefined) b.color = color(b.color);
    if (b.name !== undefined) b.name = required(b.name, 'Name');
    if (b.attendance_mode !== undefined) b.attendance_mode = oneOf(b.attendance_mode, ['names', 'headcount', 'both'], 'both'); // which screen Take attendance opens first
    updateFields(db, 'campuses', req.params.id, b, ['name', 'short_name', 'address', 'timezone', 'color', 'active', 'sort', 'attendance_mode']);
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
    max_code_emails_per_hour: 200,             // server-wide ceiling on sign-in code emails
    video_minutes_limit: 9000,                 // Daily's free plan is 10,000 participant-minutes a month
  };

  // Only admins see the server-wide code-email cap; knowing it helps no one else.
  const ADMIN_ONLY = ['max_code_emails_per_hour'];
  r.get('/settings', requireRole('volunteer'), (req, res) => {
    res.json({
      ...Object.fromEntries(Object.entries(SETTINGS).filter(([k]) => req.user.role === 'admin' || !ADMIN_ONLY.includes(k)).map(([k, v]) => [k, getSetting(db, k, v)])),
      app_icon_version: getSetting(db, 'app_icon_version', 0),
      custom_app_icon: fs.existsSync(path.join(uploadDir, 'app-icon', '512.png')),
      app_url: `${(process.env.MB_APP_URL || '').trim().replace(/\/+$/, '')}/app/`,
    });
  });

  r.patch('/settings', requireRole('admin'), requireAllCampuses, (req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!(k in SETTINGS)) continue;
      if (typeof v !== typeof SETTINGS[k] || Array.isArray(v) !== Array.isArray(SETTINGS[k])) throw bad(`Invalid value for ${k}.`);
      if (k === 'sign_in_policy' && !SIGN_IN_POLICIES.includes(v)) throw bad('Unknown sign-in option.');
      if (k === 'brand_color' && !/^#[0-9a-f]{6}$/i.test(v)) throw bad('Colours look like #135fd1.');
      if (k === 'plan_edit_role' && !['leader', 'staff', 'admin'].includes(v)) throw bad('Unknown option.');
      if (k === 'reminder_hours' && !(Number.isInteger(v) && v >= 0 && v <= 168)) throw bad('Reminders can go out up to 168 hours (a week) ahead, or 0 for none.');
      if (k === 'schedule_role' && !['team_leaders', 'staff', 'admin'].includes(v)) throw bad('Unknown option.');
      if (k === 'max_code_emails_per_hour' && !(Number.isInteger(v) && v >= 1 && v <= 100_000)) throw bad('Use a whole number from 1 to 100,000.');
      if (k === 'video_minutes_limit' && !(Number.isInteger(v) && v >= 0 && v <= 10_000_000)) throw bad('The limit is a number of minutes (0 turns video calls off).');
      setSetting(db, k, k === 'workspace_domain' ? str(v).toLowerCase().replace(/^@/, '') : v);
    }
    audit(db, req, 'settings.update', Object.keys(req.body || {}).join(','));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- users
  // Campus-limited admins (req.user.campusIds is a list) manage only the accounts in reach (see
  // accountInReach in auth.js) and can't hand out more than they have. The server is the guard;
  // the Settings and person-page dialogs just hide what these rules would refuse.
  const SELF_MSG = 'Ask an admin who covers every campus to change your own access.';
  const OUT_MSG = 'That account is outside your campuses. Ask an admin who covers every campus.';
  const WIDER_MSG = 'That access is for admins who cover every campus. Ask one of them to change it.';
  const loadAccount = (id) => db.prepare('SELECT u.*, p.campus_id person_campus_id FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.id = ?').get(id);
  const within = (list, mine) => list.every((c) => mine.includes(Number(c)));
  // campus lists are stored as JSON text or null; compare them as sets
  const sameCampuses = (a, b) => (a == null || b == null ? a == null && b == null : JSON.stringify([...JSON.parse(a)].sort()) === JSON.stringify([...JSON.parse(b)].sort()));

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

  // An account that isn't linked to a person in People asks the office to link it. Admins are told
  // (at most once a week per account); nothing is ever linked automatically: an admin picks the person.
  r.post('/me/link-request', requireRole('volunteer'), (req, res) => {
    if (req.user.personId) return res.json({ linked: true, notified: false });
    const u = db.prepare('SELECT link_requested_at FROM users WHERE id = ?').get(req.user.id);
    const recent = u?.link_requested_at && Date.parse(`${u.link_requested_at}Z`) > Date.now() - 7 * 864e5;
    if (recent) return res.json({ linked: false, notified: false });
    db.prepare("UPDATE users SET link_requested_at = datetime('now') WHERE id = ?").run(req.user.id);
    const admins = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin'").all().map((a) => a.id);
    notify(db, admins, {
      kind: 'account',
      title: `Account needs linking: ${req.user.email}`,
      body: 'They signed in, but their account isn’t linked to a person in People. Link it in Settings → Sign-in & accounts.',
      url: '/#/settings/accounts',
    });
    audit(db, req, 'user.link_request', req.user.email);
    res.json({ linked: false, notified: true });
  });

  // Accounts with more than volunteer access, or (?q=) anyone matching a search. Everyone in
  // People gets a volunteer account by signing in, so those don't need listing.
  r.get('/users', requireRole('admin'), (req, res) => {
    const limited = Boolean(req.user.campusIds);
    const reach = (u) => !limited || accountInReach(req.user, u);
    const q = str(req.query.q, 100).toLowerCase();
    const rows = db.prepare(`SELECT u.id, u.email, u.role, u.person_id, u.campus_ids, u.active, u.last_login, u.created_at, u.finance, u.announce, u.attendance, u.checkin, u.app_editor,
        u.password_hash IS NOT NULL has_password, u.role_auto, p.first_name, p.last_name, p.campus_id person_campus_id
      FROM users u LEFT JOIN people p ON p.id = u.person_id
      WHERE ${q ? "(lower(u.email) LIKE ? OR lower(p.first_name || ' ' || p.last_name) LIKE ?)" : "(u.role != 'volunteer' OR u.active = 0 OR u.finance = 1 OR u.announce = 1 OR u.attendance = 1 OR u.checkin = 1 OR u.app_editor = 1)"}
      ORDER BY u.role = 'volunteer', u.email LIMIT ${limited ? 5000 : 200}`).all(...(q ? [`%${q}%`, `%${q}%`] : []));
    const volunteers = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'volunteer' AND active = 1").get().n;
    const withEmail = db.prepare("SELECT COUNT(*) n FROM people WHERE archived = 0 AND email != ''").get().n;
    // Active accounts not linked to anyone in People: an admin links each one by hand.
    // (A campus-limited admin sees only the accounts they could manage, in all three lists.)
    const unlinked = db.prepare(`SELECT id, email, role, last_login, created_at, link_requested_at, campus_ids, finance, announce, app_editor FROM users
      WHERE person_id IS NULL AND active = 1 ORDER BY link_requested_at IS NULL, link_requested_at DESC, created_at DESC LIMIT ${limited ? 5000 : 200}`).all()
      .filter((u) => reach(u)).slice(0, 200).map(({ campus_ids: _c, finance: _f, announce: _a, app_editor: _e, ...u }) => {
        // The person with the same email, shown only when this admin could link to them (a hint; an admin always confirms).
        const sg = linkSuggestion(db, u);
        const { campus_id: sgCampus, ...suggestion } = sg || {};
        return { ...u, suggestion: sg && canCampus(req.user, sgCampus) ? suggestion : null };
      });
    // People sharing one email (trimmed, case ignored), to tidy before suggestions work well. A campus-limited
    // admin sees a group only when every person in it is in their reach (checked across the whole group, then the list is trimmed for display).
    const shared = db.prepare(`SELECT lower(trim(email)) e FROM people WHERE archived = 0 AND trim(email) != '' GROUP BY e HAVING COUNT(*) > 1 ORDER BY e LIMIT 300`).all()
      .map(({ e }) => ({ email: e, people: db.prepare(`SELECT p.id, p.first_name, p.last_name, p.campus_id, c.short_name campus_short, c.name campus_name FROM people p LEFT JOIN campuses c ON c.id = p.campus_id
        WHERE p.archived = 0 AND lower(trim(p.email)) = ? ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`).all(e) }))
      .filter((g) => g.people.every((p) => canCampus(req.user, p.campus_id))).slice(0, 100)
      .map((g) => ({ email: g.email, people: g.people.slice(0, 20).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), campus: p.campus_id == null ? '' : (p.campus_short || p.campus_name) })) }));
    const duplicates = duplicateAccountLinks(db).map((d) => ({ ...d, accounts: d.accounts.filter((a) => reach(loadAccount(a.id))) })).filter((d) => !limited || d.accounts.length > 1);
    res.json({
      users: rows.filter((u) => reach({ ...u, person_campus_id: u.person_campus_id })).slice(0, 200)
        .map(({ person_campus_id: _p, ...u }) => ({ ...u, attendance: Boolean(u.attendance), checkin: Boolean(u.checkin), has_password: Boolean(u.has_password), campus_ids: u.campus_ids ? JSON.parse(u.campus_ids) : null })),
      volunteers, people_with_email: withEmail, unlinked, shared_emails: shared, duplicate_links: duplicates,
    });
  });

  // Removes the sign-in (and its sessions and devices). The person stays in People.
  r.delete('/users/:id', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound('Account');
    if (req.user.campusIds) {
      if (u.id === req.user.id) throw new HttpError(403, SELF_MSG);
      if (!accountInReach(req.user, loadAccount(u.id))) throw new HttpError(403, OUT_MSG);
      // Its next sign-in would make it an admin again (MB_ADMIN_EMAILS): leave that to an admin who covers every campus.
      if (wouldBeAdmin(db, u.email)) throw new HttpError(403, OUT_MSG);
    }
    if (u.id === req.user.id) throw bad('You can’t delete your own account. Ask another admin.');
    if (u.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1) {
      throw bad('This is the only admin. Make someone else an admin first.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    closeStreams({ userId: u.id });
    audit(db, req, 'user.delete', u.email);
    ensureAccountLinkIndex(db); // a duplicate may just have been resolved
    res.json({ ok: true });
  });

  // The Attendance switch lets a volunteer-level account take attendance at its campuses. On a church with
  // more than one campus the account must have a campus list (no list would mean every campus), and a
  // campus-limited admin may only use campuses of their own. `list` is the stored JSON text or null.
  function checkAttendanceCampuses(req, list) {
    if (db.prepare('SELECT COUNT(*) n FROM campuses').get().n <= 1) return;
    if (list == null) throw bad('Choose which campuses this person takes attendance at.');
    if (req.user.campusIds && !within(JSON.parse(list), req.user.campusIds)) throw new HttpError(403, WIDER_MSG);
  }

  // The person an admin chose to link an account to: must exist, not be archived, and not already
  // have another account (one person, one sign-in). null unlinks. Every write that sets a user's
  // person goes through this (or the merge check in people.js), so the rule holds on every path.
  function linkablePerson(value, userId, req) {
    const pid = int(value);
    if (pid == null) return null;
    const p = db.prepare('SELECT campus_id FROM people WHERE id = ? AND archived = 0').get(pid);
    if (!p) throw notFound('Person');
    if (!canCampus(req.user, p.campus_id)) throw forbidden(); // a campus-limited admin links only their campuses' people
    if (db.prepare('SELECT 1 FROM users WHERE person_id = ? AND id != ?').get(pid, userId ?? 0)) throw new HttpError(409, 'That person already has an account. Unlink it there first.');
    return pid;
  }

  // The Kids' check-in switch is for accounts below staff (staff, admins and paired iPads always have
  // check-in). A volunteer-level account must have a campus list on a church with several campuses (no
  // list would mean every campus, and check-in fails closed instead); a campus-limited admin may only
  // use campuses of their own. `list` is the stored JSON text or null.
  function checkCheckinCampuses(req, role, list) {
    if (rank(role) >= rank('staff')) return;
    if (db.prepare('SELECT COUNT(*) n FROM campuses').get().n <= 1) return;
    if (list == null && rank(role) < rank('leader')) throw bad('Choose which campuses this person runs check-in at.');
    if (req.user.campusIds && (list == null || !within(JSON.parse(list), req.user.campusIds))) throw new HttpError(403, WIDER_MSG);
  }

  r.post('/users', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const email = required(b.email, 'Email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('That email doesn’t look right.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('There is already an account for that email.');
    // Only the person the admin chose, checked like any link. Never guessed from the email.
    const role = oneOf(b.role, ROLES, 'volunteer');
    let campusIds = b.campus_ids;
    if (req.user.campusIds) {
      // A campus-limited admin can't make an admin or grant church-wide flags, and the new account
      // stays inside their campuses (it defaults to all of theirs).
      if (role === 'admin' || b.finance || b.announce || b.app_editor) throw new HttpError(403, WIDER_MSG);
      if (campusIds === undefined) campusIds = [...req.user.campusIds];
      else {
        const l = campusList(campusIds);
        if (l === null || !within(JSON.parse(l), req.user.campusIds)) throw new HttpError(403, WIDER_MSG);
      }
    }
    const person = b.person_id != null && b.person_id !== '' ? linkablePerson(b.person_id, null, req) : null;
    if (b.attendance) checkAttendanceCampuses(req, campusList(campusIds));
    // Checked against the role chosen here, linked or not: linking to a team leader can raise the role later,
    // and a leader with no list means every campus.
    if (b.checkin) checkCheckinCampuses(req, role, campusList(campusIds));
    const info = db.prepare("INSERT INTO users (email, role, person_id, campus_ids, finance, announce, attendance, checkin, app_editor, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'device')")
      .run(email, role, person, campusList(campusIds), b.finance ? 1 : 0, b.announce ? 1 : 0, b.attendance ? 1 : 0, b.checkin ? 1 : 0, b.app_editor ? 1 : 0);
    audit(db, req, 'user.create', `${email} as ${b.role}${b.checkin ? ' + check-in' : ''}${b.attendance ? ' + attendance' : ''}${b.app_editor ? ' + edit the app' : ''}`);
    if (person) {
      audit(db, req, 'user.link', { user_id: Number(info.lastInsertRowid), person_id: person });
      // The dialogs always send a role; Volunteer (the default) isn't a hand choice of more access.
      if (b.role === undefined || b.role === 'volunteer') syncLeaderAccessFor(db, person, req); // a team leader gets leader access, as always
    }
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // The rules for a campus-limited admin editing an account. Fields the dialog re-sends unchanged are
  // dropped (so they never error and never write); anything that would change is checked.
  function dropUnchanged(b, changed, keepCampus) {
    for (const k of ['finance', 'announce', 'attendance', 'app_editor', 'active', 'checkin', 'person_id']) if (!changed[k]) delete b[k];
    if (!changed.campus_ids && !keepCampus) delete b.campus_ids;
  }
  function scopePatch(req, u, b) {
    const C = req.user.campusIds;
    const wantCampus = b.campus_ids !== undefined ? campusList(b.campus_ids) : undefined;
    const changed = {
      campus_ids: wantCampus !== undefined && !sameCampuses(wantCampus, u.campus_ids),
      finance: b.finance !== undefined && Boolean(b.finance) !== Boolean(u.finance),
      announce: b.announce !== undefined && Boolean(b.announce) !== Boolean(u.announce),
      app_editor: b.app_editor !== undefined && Boolean(b.app_editor) !== Boolean(u.app_editor),
      attendance: b.attendance !== undefined && Boolean(b.attendance) !== Boolean(u.attendance), // allowed inside their campuses; checked in PATCH
      active: b.active !== undefined && Boolean(b.active) !== Boolean(u.active),
      checkin: b.checkin !== undefined && Boolean(b.checkin) !== Boolean(u.checkin), // allowed inside their campuses; checked in PATCH
      person_id: b.person_id !== undefined && int(b.person_id) !== u.person_id,
    };
    if (b.role !== undefined) changed.role = true; // an unchanged role was already dropped
    if (u.id === req.user.id) {
      if (Object.values(changed).some(Boolean)) throw new HttpError(403, SELF_MSG);
    } else {
      if (!accountInReach(req.user, loadAccount(u.id))) throw new HttpError(403, OUT_MSG);
      if (b.role === 'admin' || changed.finance || changed.announce || changed.app_editor) throw new HttpError(403, WIDER_MSG);
      if (changed.campus_ids && (wantCampus === null || !within(JSON.parse(wantCampus), C))) throw new HttpError(403, WIDER_MSG);
      if (['leader', 'staff'].includes(b.role ?? u.role)) {
        const ids = changed.campus_ids ? JSON.parse(wantCampus) : u.campus_ids ? JSON.parse(u.campus_ids) : null;
        if (ids == null) { b.campus_ids = [...C]; return dropUnchanged(b, changed, true); } // no list means every campus: give them the admin's own
        if (!within(ids, C)) throw new HttpError(403, WIDER_MSG);
      }
    }
    dropUnchanged(b, changed, false);
  }

  r.patch('/users/:id', requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound('Account');
    const b = { ...req.body };
    if (b.role !== undefined) b.role = oneOf(b.role, ROLES, u.role);
    // The account dialog always sends the current role: an unchanged role isn't a hand change, so
    // automatic (team-leader) access stays automatic and can still be taken back on unlink.
    if (b.role !== undefined && b.role === u.role) delete b.role;
    if (req.user.campusIds) scopePatch(req, u, b);
    if (b.campus_ids !== undefined) b.campus_ids = campusList(b.campus_ids);
    // Only a changed person is checked, so an account that already shares a person (see docs/account-links.md)
    // can still be edited, and unlinked.
    if (b.person_id !== undefined) b.person_id = int(b.person_id) === u.person_id ? u.person_id : linkablePerson(b.person_id, u.id, req);
    // Never let the last admin lock everyone out.
    if (u.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === false || b.active === 0)) {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw bad('This is the only admin. Make someone else an admin first.');
    }
    // Finance (who gave what) is its own permission, separate from staff/admin.
    if (b.finance !== undefined) b.finance = Boolean(b.finance);
    if (b.announce !== undefined) b.announce = Boolean(b.announce);
    if (b.attendance !== undefined) b.attendance = Boolean(b.attendance);
    if (b.checkin !== undefined) b.checkin = Boolean(b.checkin);
    if (b.app_editor !== undefined) b.app_editor = Boolean(b.app_editor);
    // Attendance needs a campus list (more than one campus); checked against the list the account will have.
    const willAttend = b.attendance !== undefined ? b.attendance : Boolean(u.attendance);
    if (willAttend && (b.attendance === true && !u.attendance || b.campus_ids !== undefined)) checkAttendanceCampuses(req, b.campus_ids !== undefined ? b.campus_ids : u.campus_ids);
    // Kids' check-in: checked against the role and campus list the account will have.
    const willCheckin = b.checkin !== undefined ? b.checkin : Boolean(u.checkin);
    if (willCheckin && (b.checkin === true && !u.checkin || b.campus_ids !== undefined || b.role !== undefined)) checkCheckinCampuses(req, b.role ?? u.role, b.campus_ids !== undefined ? b.campus_ids : u.campus_ids);
    updateFields(db, 'users', u.id, b, ['role', 'campus_ids', 'person_id', 'active', 'finance', 'announce', 'attendance', 'checkin', 'app_editor']);
    if (b.checkin !== undefined && b.checkin !== Boolean(u.checkin)) audit(db, req, 'user.checkin', { user_id: u.id, granted: b.checkin });
    if (b.person_id !== undefined && b.person_id !== u.person_id) {
      audit(db, req, b.person_id == null ? 'user.unlink' : 'user.link', { user_id: u.id, person_id: b.person_id, from_person_id: u.person_id });
    }
    // Access chosen by hand is never changed automatically by team leadership.
    if (b.role !== undefined) db.prepare('UPDATE users SET role_auto = 0 WHERE id = ?').run(u.id);
    // Linking (an admin's choice): a team leader gets leader access, the usual team-leader rule.
    // Unlinking: leader access that came only from leading a team goes with it.
    if (b.role === undefined && b.person_id !== undefined && b.person_id !== u.person_id) {
      if (b.person_id != null) syncLeaderAccessFor(db, b.person_id, req);
      else if (u.role_auto && u.role === 'leader') {
        db.prepare("UPDATE users SET role = 'volunteer', role_auto = 0 WHERE id = ?").run(u.id);
        revokeCheckin(db, u.id);
        audit(db, req, 'user.leader_auto', { user_id: u.id, person_id: u.person_id, granted: false });
      }
    }
    // A link moved off a person can resolve a duplicate, so try the one-account rule again.
    if (b.person_id !== undefined && b.person_id !== u.person_id && u.person_id != null) ensureAccountLinkIndex(db);
    if (b.active === false || b.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    // Open live pages end now; they reconnect with the new access, or fail if signed out.
    if (['role', 'campus_ids', 'person_id', 'active'].some((k) => b[k] !== undefined)) closeStreams({ userId: u.id });
    audit(db, req, 'user.update', { id: u.id, ...req.body });
    res.json({ ok: true });
  });

  return r;
}

function campusList(v) {
  if (v == null || v === 'all') return null;
  if (!Array.isArray(v)) throw bad('campus_ids must be a list or "all".');
  // "All campuses" is the string 'all', never a list. A list is the exact campuses; an empty one would
  // save an account that can reach none, which is never what the dialog shows, so it's refused.
  const ids = [...new Set(v.map((x) => int(x, 'Campus')))];
  if (!ids.length || ids.includes(null)) throw bad('Choose All campuses, or at least one campus.');
  return JSON.stringify(ids);
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
