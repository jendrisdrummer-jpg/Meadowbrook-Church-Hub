// Sign-in with the church's Google Workspace accounts, plus sessions and permissions.
//
// Roles, from least to most access:
//   volunteer – their own schedule, blockouts and the plans they serve on
//   leader    – also people, teams, scheduling and check-in at their campuses
//   staff     – also edits people, services, songs and rooms at their campuses
//   admin     – everything, including campuses, accounts and imports
// A user's campus_ids limits them to some campuses; NULL means every campus.
import { createLimiter, ipAllowed } from './ratelimit.js';
import crypto from 'node:crypto';
import { getSetting, hashToken, tx } from './db.js';
import { closeStreams } from './live.js';
import { notify } from './notify.js';
import { sendMail, canSendMail } from './mail.js';
import { connectDrive, DRIVE_SCOPE } from './backup.js';

export const ROLES = ['volunteer', 'leader', 'staff', 'admin'];
const SESSION_DAYS = 30;
const COOKIE = 'mb_session';

export function rank(role) {
  return ROLES.indexOf(role);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieFlags(req) {
  return `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;
}

export function startSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  // Only the hash is stored; the cookie keeps the raw token.
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(req)}`);
}

export function endSession(db, req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
    closeStreams({ token: hashToken(token) });
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
}

export function loadUser(db) {
  const find = db.prepare(`
    SELECT u.*, p.first_name, p.last_name, p.nickname, p.photo
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN people p ON p.id = u.person_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = parseCookies(req)[COOKIE];
    const hash = token ? hashToken(token) : null;
    const row = hash && find.get(hash, new Date().toISOString());
    req.user = row ? toUser(row) : null;
    req.sessionHash = row ? hash : null;
    next();
  };
}

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    personId: row.person_id,
    campusIds: row.campus_ids ? JSON.parse(row.campus_ids) : null,
    name: row.first_name ? `${row.nickname || row.first_name} ${row.last_name}`.trim() : row.email,
    theme: row.theme || 'light',
    photo: row.photo || null,
    finance: Boolean(row.finance),
    attendance: Boolean(row.attendance),
    studies: Boolean(row.studies),
    announce: Boolean(row.announce) || row.role === 'admin',
    appEditor: Boolean(row.app_editor) || row.role === 'admin',
    homeLayout: parseLayout(row.home_layout),
  };
}

// A saved Home layout, or null (the standard Home) if there is none or it can't be read.
function parseLayout(text) {
  try { const v = text ? JSON.parse(text) : null; return v && Array.isArray(v.order) && Array.isArray(v.hidden) ? v : null; } catch { return null; }
}

// The public address of this request's site: PUBLIC_URL (dashboard) or MB_APP_URL (member
// app) when the request came in on that host, otherwise the request's own origin.
export function siteOrigin(req) {
  const clean = (v) => (v || '').trim().replace(/\/+$/, '');
  const known = [clean(process.env.PUBLIC_URL), clean(process.env.MB_APP_URL)].filter(Boolean);
  const host = req.get('host');
  const match = known.find((u) => { try { return new URL(u).host === host; } catch { return false; } });
  return match || known[0] || `${req.protocol}://${host}`;
}

export function requireRole(min) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (rank(req.user.role) < rank(min)) return res.status(403).json({ error: 'You don’t have access to that.' });
    next();
  };
}

// Editing the member app (App Builder, its pictures and saved layout): admins always, plus any active
// account an admin gave the "Edit the app" switch, whatever its role. Reading the app's public
// config stays open to everyone; only the writes use this guard.
export const canEditApp = (user) => Boolean(user) && Boolean(user.appEditor);
export function requireAppEditor(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!canEditApp(req.user)) return res.status(403).json({ error: 'You don’t have access to that.' });
  next();
}

// Taking attendance (roll call, families, new guests, headcounts): leaders and above as before,
// plus any account an admin gave the Attendance switch. The switch is for volunteer-level accounts
// and opens nothing else: every other route keeps its own guard. canCheckin (kids' check-in) is a
// separate rule and is not affected.
export const canTakeAttendance = (user) => Boolean(user) && (rank(user.role) >= rank('leader') || Boolean(user.attendance));
export function requireAttendance(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!canTakeAttendance(req.user)) return res.status(403).json({ error: 'You don’t have access to that.' });
  next();
}
// Bible studies: staff and admins, plus any account an admin gave the Bible studies coordinator switch
// (users.studies), whatever its role. Leaders and volunteers get nothing extra. Studies belong to the
// whole church, so the switch is not campus-limited; lists still follow campusFilter on a study's
// optional campus (a study with no campus is open to everyone who passes this guard). Teachers and
// students reach only their own studies, by their linked person, inside the routes themselves.
export const canStudies = (user) => Boolean(user) && (rank(user.role) >= rank('staff') || Boolean(user.studies));
export function requireStudies(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!canStudies(req.user)) return res.status(403).json({ error: 'You don’t have access to that.' });
  next();
}
// Is this campus one the account may take attendance at? Leaders: as canCampus. A switch-only
// account must have a campus list when the church has more than one campus (the account dialog
// requires one); with no list on a multi-campus church it fails closed rather than meaning "all".
export function canAttendCampus(db, user, campusId) {
  if (!user) return false;
  if (rank(user.role) < rank('leader') && !user.campusIds && db.prepare('SELECT COUNT(*) n FROM campuses').get().n > 1) return false;
  return canCampus(user, campusId);
}

// True when the user may work with this campus. A null campus (church-wide) is open to all.
export function canCampus(user, campusId) {
  if (!user) return false;
  if (!user.campusIds || campusId == null) return true;
  return user.campusIds.includes(Number(campusId));
}

// A campus-limited admin (campusIds is a list, not null) may run their own campuses but must not
// reach across the church. Church-wide admin routes use this guard after requireRole('admin').
export const ALL_CAMPUSES_MESSAGE = 'That’s for admins who cover every campus. Ask one of them to make this change.';
export function requireAllCampuses(req, res, next) {
  if (req.user?.campusIds) return res.status(403).json({ error: ALL_CAMPUSES_MESSAGE });
  next();
}

// Can this campus-limited admin manage this account? `t` is a users row plus person_campus_id (the
// campus of the person it's linked to, or null). Never themselves, never an admin. A volunteer is in
// reach when linked to a person at one of their campuses, or not linked at all. A leader or staff
// account is in reach only when its own campus list is set and sits wholly inside theirs.
// Unrestricted admins (campusIds null) reach every account.
export function accountInReach(user, t) {
  if (!user.campusIds) return true;
  if (t.id === user.id || t.role === 'admin') return false;
  // Finance, Announcements, Edit the app and Bible studies are church-wide, so accounts holding them are for unrestricted admins.
  if (t.finance || t.announce || t.app_editor || t.studies) return false;
  // Volunteers: unlinked, or linked to someone at their campuses or with no campus yet (as canCampus treats
  // unassigned people); giving them more access still needs campus_ids inside the admin's campuses.
  // A volunteer's own campus list, if set (e.g. staff who stepped down), must also sit inside theirs.
  if (t.role === 'volunteer') {
    const own = typeof t.campus_ids === 'string' ? JSON.parse(t.campus_ids) : t.campus_ids;
    if (Array.isArray(own) && !own.every((c) => user.campusIds.includes(Number(c)))) return false;
    return t.person_id == null || t.person_campus_id == null || user.campusIds.includes(Number(t.person_campus_id));
  }
  const ids = typeof t.campus_ids === 'string' ? JSON.parse(t.campus_ids) : t.campus_ids;
  return Array.isArray(ids) && ids.every((c) => user.campusIds.includes(Number(c)));
}

// SQL fragment limiting a campus column to the user's campuses.
export function campusFilter(user, column) {
  if (!user.campusIds) return { sql: '1 = 1', args: [] };
  if (!user.campusIds.length) return { sql: '0 = 1', args: [] };
  return { sql: `(${column} IS NULL OR ${column} IN (${user.campusIds.map(() => '?').join(',')}))`, args: user.campusIds };
}

// Browsers can't send this header cross-site without a CORS preflight we never allow,
// so requiring it on every change blocks cross-site request forgery.
export function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-mb') === '1') return next();
  res.status(403).json({ error: 'Missing app header.' });
}

// What a new sign-in for this email would be: the role it would get (null: not allowed to create an
// account) and whether that email is already in People (only to decide whether sign-in is allowed, and
// to avoid adding a second person; never to link). userForEmail and the code route share it.
// True when signing in with this email would make an admin (MB_ADMIN_EMAILS, or a brand-new install).
export const wouldBeAdmin = (db, email) => signUpRole(db, String(email).trim().toLowerCase()).role === 'admin';

function signUpRole(db, email) {
  const adminEmails = (process.env.MB_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const noUsers = db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;
  const domain = getSetting(db, 'workspace_domain', process.env.GOOGLE_WORKSPACE_DOMAIN || '');
  const policy = getSetting(db, 'sign_in_policy', 'anyone');
  const inDirectory = Boolean(db.prepare("SELECT 1 FROM people WHERE lower(trim(email)) = ? AND archived = 0 LIMIT 1").get(email));

  // On a brand-new install with no admin emails configured, the first church-domain account
  // (or anyone, in local test mode) becomes the admin, so a stranger can't claim a public server.
  const inDomain = Boolean(domain) && email.endsWith('@' + domain.toLowerCase());
  const firstAdmin = noUsers && !adminEmails.length && (inDomain || process.env.MB_DEV_LOGIN === '1');
  let role = null;
  if (adminEmails.includes(email) || firstAdmin) role = 'admin';
  else if (canJoin(policy, { inDomain, inDirectory })) role = 'volunteer';
  return { role, inDirectory };
}

// True when this email has an active account, or the sign-in policy would let it create one.
export function mayHaveAccount(db, email) {
  email = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT active FROM users WHERE email = ?').get(email);
  return existing ? Boolean(existing.active) : Boolean(signUpRole(db, email).role);
}

// Finds the account for a verified email, creating one when the church allows it.
// The sign-in policy decides WHO MAY SIGN IN; it never decides WHO THEY ARE. A new account is
// always created unlinked, and an admin links it to a person by hand (Settings → Accounts).
// The one exception is someone brand new to the church (not in People, sign-ups open), who is
// added to People as a new person, flagged as new from the app, when we know their name
// (Google tells us; the email sign-up form asks). That never attaches to an existing person.
export function userForEmail(db, email, profile = {}) {
  email = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return existing.active ? existing : null;

  const { role, inDirectory } = signUpRole(db, email);
  if (!role) return null;

  const first = String(profile.first_name || '').trim().slice(0, 60);
  if (!inDirectory && role === 'volunteer' && !first) return { needsName: true };
  let personId = null;
  if (!inDirectory && first) {
    const info = db.prepare("INSERT INTO people (first_name, last_name, email, status, signed_up_at) VALUES (?, ?, ?, 'guest', datetime('now'))")
      .run(first, String(profile.last_name || '').trim().slice(0, 60), email);
    personId = Number(info.lastInsertRowid);
    const staff = db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('staff', 'admin')").all().map((u) => u.id);
    notify(db, staff, {
      kind: 'connect',
      title: `New app sign-up: ${first} ${String(profile.last_name || '').trim()}`.trim(),
      body: `${email} created an account and was added to People. Say hello!`,
      url: '/#/connect?tab=signups',
      app_url: `${(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')}/#/connect?tab=signups`,
    });
  }

  const info = db.prepare("INSERT INTO users (email, role, person_id, theme) VALUES (?, ?, ?, 'device')").run(email, role, personId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// ---------------------------------------------------------------- passwords and email codes
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function checkPassword(pw, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(want, got);
}

const codeHash = (email, code) => crypto.createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// The sign-in limits (in-memory, per process) live inside authRoutes so each app, and each restart,
// starts clean. See server/ratelimit.js.

// Who may create their own (volunteer) account just by signing in. Everyone else needs an admin
// to add them in Settings → Accounts. New accounts only see their own schedule until given more.
export const SIGN_IN_POLICIES = ['anyone', 'directory', 'domain', 'invited'];
function canJoin(policy, { inDomain, inDirectory }) {
  if (policy === 'anyone') return true;
  if (policy === 'directory') return inDomain || inDirectory;
  if (policy === 'domain') return inDomain;
  return false;
}

export function authRoutes(app, db) {
  // IP keys and email keys sit in separate limiters so a flood of made-up emails can't push
  // out the IP limits (or the reverse); the server-wide code-email ceiling has its own tiny one.
  const limits = createLimiter();
  const emailLimits = createLimiter();
  const codeCeiling = createLimiter({ cap: 10 });
  let capHitAt = 0; // when the new-account code ceiling last refused (Settings → Checks shows it)
  let capWarnedAt = 0;
  const devLogin = process.env.MB_DEV_LOGIN === '1';
  const google = () => ({
    // Trimmed, because values pasted into a host's settings page often pick up stray spaces.
    id: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    domain: getSetting(db, 'workspace_domain', process.env.GOOGLE_WORKSPACE_DOMAIN || ''),
    // Only lock Google's account picker to the church domain when nobody else may sign in.
    domainOnly: getSetting(db, 'sign_in_policy', 'anyone') === 'domain',
  });
  // Sign-in returns to the address it started from: the dashboard (PUBLIC_URL) or the member
  // app (MB_APP_URL). Both callback URLs must be listed in the Google Cloud client.
  const callbackUrl = (req) => `${siteOrigin(req)}/auth/google/callback`;
  // Where to go after signing in: a path on this site only.
  const safeNext = (v) => (typeof v === 'string' && /^\/(?!\/)/.test(v) && !v.includes('\\') ? v.slice(0, 300) : '/');

  app.get('/auth/options', (_req, res) => {
    res.json({
      google: Boolean(google().id && google().secret),
      email: canSendMail(),
      signups: getSetting(db, 'sign_in_policy', 'anyone') === 'anyone',
      dev: devLogin,
      churchName: getSetting(db, 'church_name', 'Meadowbrook Church'),
      brandColor: getSetting(db, 'brand_color', '#135fd1'),
    });
  });

  app.get('/auth/google', (req, res) => {
    const g = google();
    if (!g.id) return res.status(500).send('Google sign-in is not set up yet. See README → Google sign-in.');
    const state = crypto.randomBytes(16).toString('base64url');
    res.setHeader('Set-Cookie', [
      `mb_oauth=${state}; Max-Age=600; ${cookieFlags(req)}`,
      `mb_next=${encodeURIComponent(safeNext(req.query.next))}; Max-Age=600; ${cookieFlags(req)}`,
    ]);
    const params = new URLSearchParams({
      client_id: g.id,
      redirect_uri: callbackUrl(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    if (g.domain && g.domainOnly) params.set('hd', g.domain);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // Settings → Backups: an admin lets the hub save backups to their Google Drive. It only asks for
  // access to files the hub itself creates (drive.file), and uses the same callback address.
  app.get('/auth/google/drive', (req, res) => {
    const g = google();
    if (!req.user || req.user.role !== 'admin') return res.redirect('/login');
    if (req.user.campusIds) return res.redirect(`/#/settings/backups?drive_error=${encodeURIComponent(ALL_CAMPUSES_MESSAGE)}`); // backups are church-wide
    if (!g.id) return res.status(500).send('Google sign-in is not set up yet. See README → Google sign-in.');
    const state = crypto.randomBytes(16).toString('base64url');
    res.setHeader('Set-Cookie', `mb_drive=${state}; Max-Age=600; ${cookieFlags(req)}`);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: g.id, redirect_uri: callbackUrl(req), response_type: 'code', scope: `openid email ${DRIVE_SCOPE}`,
      state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
    })}`);
  });

  async function finishDrive(req, res) {
    const back = (msg) => res.redirect(`/#/settings/backups${msg ? `?drive_error=${encodeURIComponent(msg)}` : '?drive=connected'}`);
    if (!req.user || req.user.role !== 'admin') return res.redirect('/login');
    if (req.user.campusIds) return back(ALL_CAMPUSES_MESSAGE);
    if (req.query.error) return back('Google Drive wasn’t connected.');
    const g = google();
    const r = await fetch(process.env.MB_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code || ''), client_id: g.id, client_secret: g.secret, redirect_uri: callbackUrl(req), grant_type: 'authorization_code' }),
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.refresh_token) return back(`Google didn’t allow Drive access (${t.error || 'no long-term access was given'}). Try again, and tick the Google Drive box.`);
    if (!String(t.scope || '').includes(DRIVE_SCOPE)) return back('The Google Drive box wasn’t ticked. Try again and allow it.');
    const claims = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()) : {};
    connectDrive(db, { refresh_token: t.refresh_token, email: claims.email || '' });
    back('');
  }

  app.get('/auth/google/callback', async (req, res) => {
    const fail = (msg) => res.redirect(`/login?error=${encodeURIComponent(msg)}`);
    if (req.query.state && req.query.state === parseCookies(req).mb_drive) return finishDrive(req, res).catch(() => res.redirect('/#/settings/backups?drive_error=Connecting%20failed.'));
    if (!req.query.state || req.query.state !== parseCookies(req).mb_oauth) return fail('Sign-in expired. Please try again.');
    const g = google();
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code || ''),
          client_id: g.id,
          client_secret: g.secret,
          redirect_uri: callbackUrl(req),
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await r.json();
      if (!r.ok || !tokens.id_token) {
        // Google's error code (e.g. invalid_client, redirect_uri_mismatch) says what to fix; it holds no secrets.
        console.error('Google token exchange failed:', r.status, tokens.error, tokens.error_description, 'redirect_uri =', callbackUrl(req));
        return fail(`Google sign-in failed (${tokens.error || r.status}). ${SIGN_IN_HINTS[tokens.error] || ''}`.trim());
      }
      // The ID token came straight from Google over TLS, so its claims can be trusted
      // without checking the signature (Google's OpenID Connect guidance).
      const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
      if (claims.aud !== g.id || !claims.email_verified) return fail('Google could not verify that email address.');
      const user = userForEmail(db, claims.email, { first_name: claims.given_name || claims.name || claims.email.split('@')[0], last_name: claims.family_name || '' });
      if (!user || user.needsName) {
        return fail(g.domain && g.domainOnly
          ? `Please sign in with your @${g.domain} account.`
          : 'Your account isn’t set up yet. Ask a church admin to add you.');
      }
      startSession(db, req, res, user.id);
      res.redirect(safeNext(parseCookies(req).mb_next));
    } catch (e) {
      console.error('Google sign-in error', e);
      fail('Google sign-in failed.');
    }
  });

  // Local development and demos only: sign in as any email without Google.
  if (devLogin) {
    app.post('/auth/dev', (req, res) => {
      const email = String(req.body?.email || '');
      const user = userForEmail(db, email, { first_name: email.split('@')[0] });
      if (!user || user.needsName) return res.status(403).json({ error: 'No account for that email.' });
      startSession(db, req, res, user.id);
      res.json({ ok: true });
    });
  }

  // ---------------------------------------------------------------- email sign-in
  // Sign in with email and password.
  app.post('/auth/password', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const mismatch = () => res.status(401).json({ error: 'That email and password don’t match. First time here? Use “Email me a code”.' });
    // Not an email address: nothing to look up, and no limiter key made for it.
    if (!validEmail(email)) return mismatch();
    // The address first, then the email: a refused client creates no new keys.
    if (!ipAllowed(limits, 'pwip', req.ip, 40, 15 * 60e3, { wide: 8 }) || !emailLimits.hit(`pw:${email}`, 8, 15 * 60e3)) {
      return res.status(429).json({ error: 'Too many tries. Wait a few minutes, or use “Email me a code”.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!user?.password_hash || !checkPassword(req.body?.password || '', user.password_hash)) return mismatch();
    startSession(db, req, res, user.id);
    res.json({ ok: true });
  });

  // Emails a 6-digit code to prove the address belongs to them: for signing in the first time,
  // a forgotten password, or creating an account.
  app.post('/auth/code', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter your email address.' });
    if (!canSendMail()) return res.status(503).json({ error: 'Email sign-in isn’t set up yet. Use Google, or ask the church office.' });
    const tooMany = () => res.status(429).json({ error: 'We’ve sent several codes already. Check your inbox (and spam), or try again in an hour.' });
    // The address first, then the email: a refused client creates no new keys.
    if (!ipAllowed(limits, 'codeip', req.ip, 20, 60 * 60e3, { wide: 8 }) || !emailLimits.hit(`code:${email}`, 5, 60 * 60e3)) return tooMany();
    // Every valid request takes a slot from the server-wide ceiling the same way, whatever the
    // account state, so filling it can't be used to learn who has an account (only new accounts are
    // held back by it below; members are never refused because of it).
    const ceiling = Number(getSetting(db, 'max_code_emails_per_hour', 200));
    const maxPerHour = Number.isInteger(ceiling) && ceiling > 0 ? ceiling : 200;
    const capOk = codeCeiling.hit('codes', maxPerHour, 60 * 60e3);
    // Answer now, the same for everyone; the lookups, the code and the email happen afterwards, so
    // neither the database work nor the email can be timed to tell whether an address has an account.
    res.json({ ok: true });
    try {
      // No account, and the sign-in policy wouldn't let this email make one: send nothing, so the
      // form can't be used to mail strangers.
      if (!mayHaveAccount(db, email)) return;
      // The ceiling only holds back emails that would create a new account.
      if (!capOk && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        const now = Date.now();
        if (!capWarnedAt || now - capWarnedAt >= 60 * 60e3) console.warn(`Sign-in codes reached the limit of ${maxPerHour} an hour (max_code_emails_per_hour); new addresses get no code until it clears.`);
        capWarnedAt = capHitAt = now;
        return;
      }
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      tx(db, () => {
        db.prepare('UPDATE login_codes SET used_at = datetime(\'now\') WHERE email = ? AND used_at IS NULL').run(email);
        db.prepare("INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))").run(email, codeHash(email, code));
      });
      const church = getSetting(db, 'church_name', 'Church');
      sendMail({
        to: email,
        subject: `${code} is your ${church} sign-in code`,
        text: `Your code is ${code}\n\nEnter it to sign in or create your ${church} account. It works for 15 minutes.\n\nDidn’t ask for this? You can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your ${church} sign-in code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p><p>Enter it to sign in or create your account. It works for 15 minutes.</p><p style="color:#777;font-size:13px">Didn’t ask for this? You can ignore this email.</p></div>`,
      }).catch((e) => console.error('Sending the sign-in code failed:', e.message));
    } catch (e) {
      console.error('Preparing the sign-in code failed:', e.message); // the answer has already gone
    }
  });

  // Checks the code, then signs them in. Asks for a name (new to the church) or a password (first
  // time) when it still needs one; the code stays valid until it succeeds.
  app.post('/auth/code/verify', (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const row = db.prepare("SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(email);
    if (!row || row.attempts >= 5) return res.status(400).json({ error: 'That code has expired. Send a new one.' });
    const given = String(b.code || '').replace(/\D/g, '');
    const ok = given.length === 6 && crypto.timingSafeEqual(Buffer.from(codeHash(email, given)), Buffer.from(row.code_hash));
    if (!ok) {
      db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      return res.status(400).json({ error: row.attempts >= 4 ? 'Too many wrong codes. Send a new one.' : 'That code isn’t right. Check the email and try again.' });
    }
    const user = userForEmail(db, email, { first_name: b.first_name, last_name: b.last_name });
    if (user?.needsName) return res.status(400).json({ need_name: true, error: 'Welcome! Tell us your name to create your account.' });
    if (!user) return res.status(403).json({ error: 'This email can’t create an account here. Ask the church office to add you.' });
    const password = String(b.password || '');
    if (password && password.length < 8) return res.status(400).json({ need_password: true, error: 'Use at least 8 characters for your password.' });
    if (!password && !user.password_hash) return res.status(400).json({ need_password: true, error: 'Choose a password for next time.' });
    if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
    db.prepare("UPDATE login_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
    // A new password signs out everywhere else.
    if (password) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      closeStreams({ userId: user.id });
    }
    startSession(db, req, res, user.id);
    res.json({ ok: true });
  });

  app.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });

  return { limits, emailLimits, codeCapHitAt: () => capHitAt }; // handed back for tests and Settings → Checks
}

const SIGN_IN_HINTS = {
  invalid_client: 'Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server match the Google Cloud client.',
  unauthorized_client: 'Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server match the Google Cloud client.',
  redirect_uri_mismatch: 'PUBLIC_URL + /auth/google/callback must exactly match the redirect URI in Google Cloud.',
  invalid_grant: 'The sign-in link expired or was already used. Please try again.',
};
