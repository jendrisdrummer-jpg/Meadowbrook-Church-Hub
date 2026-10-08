// Sign-in with the church's Google Workspace accounts, plus sessions and permissions.
//
// Roles, from least to most access:
//   volunteer – their own schedule, blockouts and the plans they serve on
//   leader    – also people, teams, scheduling and check-in at their campuses
//   staff     – also edits people, services, songs and rooms at their campuses
//   admin     – everything, including campuses, accounts and imports
// A user's campus_ids limits them to some campuses; NULL means every campus.
import crypto from 'node:crypto';
import { getSetting } from './db.js';

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
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(req)}`);
}

export function endSession(db, req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
}

export function loadUser(db) {
  const find = db.prepare(`
    SELECT u.*, p.first_name, p.last_name, p.nickname, p.photo
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN people p ON p.id = u.person_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = parseCookies(req)[COOKIE];
    const row = token && find.get(token, new Date().toISOString());
    req.user = row ? toUser(row) : null;
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
    photo: row.photo || null,
  };
}

export function requireRole(min) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (rank(req.user.role) < rank(min)) return res.status(403).json({ error: 'You don’t have access to that.' });
    next();
  };
}

// True when the user may work with this campus. A null campus (church-wide) is open to all.
export function canCampus(user, campusId) {
  if (!user) return false;
  if (!user.campusIds || campusId == null) return true;
  return user.campusIds.includes(Number(campusId));
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

// Finds the user for a verified email, creating one when the church allows it.
export function userForEmail(db, email) {
  email = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return existing.active ? existing : null;

  const adminEmails = (process.env.MB_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const noUsers = db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;
  const domain = getSetting(db, 'workspace_domain', process.env.GOOGLE_WORKSPACE_DOMAIN || '');
  const policy = getSetting(db, 'sign_in_policy', 'anyone');
  const person = db.prepare("SELECT id FROM people WHERE lower(email) = ? AND archived = 0 ORDER BY id LIMIT 1").get(email);

  // On a brand-new install with no admin emails configured, the first church-domain account
  // (or anyone, in local test mode) becomes the admin, so a stranger can't claim a public server.
  const inDomain = Boolean(domain) && email.endsWith('@' + domain.toLowerCase());
  const firstAdmin = noUsers && !adminEmails.length && (inDomain || process.env.MB_DEV_LOGIN === '1');
  let role = null;
  if (adminEmails.includes(email) || firstAdmin) role = 'admin';
  else if (canJoin(policy, { inDomain, inDirectory: Boolean(person) })) role = 'volunteer';
  if (!role) return null;

  const info = db.prepare('INSERT INTO users (email, role, person_id) VALUES (?, ?, ?)').run(email, role, person?.id ?? null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

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
  const devLogin = process.env.MB_DEV_LOGIN === '1';
  const google = () => ({
    // Trimmed, because values pasted into a host's settings page often pick up stray spaces.
    id: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    domain: getSetting(db, 'workspace_domain', process.env.GOOGLE_WORKSPACE_DOMAIN || ''),
    // Only lock Google's account picker to the church domain when nobody else may sign in.
    domainOnly: getSetting(db, 'sign_in_policy', 'anyone') === 'domain',
  });
  const callbackUrl = (req) => `${(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`}/auth/google/callback`;

  app.get('/auth/options', (_req, res) => {
    res.json({ google: Boolean(google().id && google().secret), dev: devLogin, churchName: getSetting(db, 'church_name', 'Meadowbrook Church') });
  });

  app.get('/auth/google', (req, res) => {
    const g = google();
    if (!g.id) return res.status(500).send('Google sign-in is not set up yet. See README → Google sign-in.');
    const state = crypto.randomBytes(16).toString('base64url');
    res.setHeader('Set-Cookie', `mb_oauth=${state}; Max-Age=600; ${cookieFlags(req)}`);
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

  app.get('/auth/google/callback', async (req, res) => {
    const fail = (msg) => res.redirect(`/login?error=${encodeURIComponent(msg)}`);
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
      const user = userForEmail(db, claims.email);
      if (!user) {
        return fail(g.domain && g.domainOnly
          ? `Please sign in with your @${g.domain} account.`
          : 'Your account isn’t set up yet. Ask a church admin to add you.');
      }
      startSession(db, req, res, user.id);
      res.redirect('/');
    } catch (e) {
      console.error('Google sign-in error', e);
      fail('Google sign-in failed.');
    }
  });

  // Local development and demos only: sign in as any email without Google.
  if (devLogin) {
    app.post('/auth/dev', (req, res) => {
      const user = userForEmail(db, req.body?.email || '');
      if (!user) return res.status(403).json({ error: 'No account for that email.' });
      startSession(db, req, res, user.id);
      res.json({ ok: true });
    });
  }

  app.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });
}

const SIGN_IN_HINTS = {
  invalid_client: 'Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server match the Google Cloud client.',
  unauthorized_client: 'Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server match the Google Cloud client.',
  redirect_uri_mismatch: 'PUBLIC_URL + /auth/google/callback must exactly match the redirect URI in Google Cloud.',
  invalid_grant: 'The sign-in link expired or was already used. Please try again.',
};
