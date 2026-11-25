// Sign-in sessions: tokens are stored hashed, old plaintext rows are converted at startup,
// and live chat streams end when their session or account goes away. Own database; no dates assumed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { send, streams } from '../server/live.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
let db, server, base, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-sess-'));
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: dir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function addUser(email, role = 'volunteer') {
  return Number(db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(email, role).lastInsertRowid);
}
// Signs in the way the server does, and returns the cookie the browser would hold.
function signIn(userId) {
  let cookie;
  startSession(db, { secure: false }, { setHeader: (_k, v) => { cookie = v.split(';')[0]; } }, userId);
  return cookie;
}
const rawToken = (cookie) => cookie.split('=')[1];
const call = (cookie, method, url, body) => fetch(base + url, {
  method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie }, body: body ? JSON.stringify(body) : undefined,
});

// Opens a chat stream; `ended()` resolves true once the server closes it.
async function openStream(cookie) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/chats/stream`, { headers: { cookie }, signal: ctl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let text = '';
  let done = false;
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done: d } = await reader.read();
        if (d) { done = true; return; }
        text += new TextDecoder().decode(value);
      }
    } catch { /* aborted */ }
  })();
  const ended = async () => { await Promise.race([pump, new Promise((r) => setTimeout(r, 400))]); return done; };
  return { ended, text: () => text, close: () => ctl.abort() };
}

test('the stored token is the sha256 of the cookie value, not the value', () => {
  const cookie = signIn(addUser('a@mb.org'));
  const raw = rawToken(cookie);
  const stored = db.prepare('SELECT token FROM sessions').all().map((r) => r.token);
  assert.ok(!stored.includes(raw));
  assert.ok(stored.includes(sha(raw)));
});

test('sign-in, /me, sign-out and expiry still work', async () => {
  const id = addUser('b@mb.org');
  const cookie = signIn(id);
  const me = await call(cookie, 'GET', '/api/me');
  assert.equal((await me.json()).email, 'b@mb.org');
  // Passing the stored hash as the cookie must not sign anyone in.
  const hashed = `mb_session=${sha(rawToken(cookie))}`;
  assert.equal((await call(hashed, 'GET', '/api/chats/stream')).status, 401);
  // Expired
  const c2 = signIn(id);
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run('2000-01-01T00:00:00.000Z', sha(rawToken(c2)));
  assert.equal((await call(c2, 'GET', '/api/chats/stream')).status, 401);
  // Sign out
  assert.equal((await call(cookie, 'POST', '/auth/logout')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(sha(rawToken(cookie))).n, 0);
  assert.equal((await call(cookie, 'GET', '/api/chats/stream')).status, 401);
});

test('sessions made before hashing are converted at startup and keep working', async () => {
  const file = path.join(dir, 'old.db');
  let old = openDb(file);
  const uid = Number(old.prepare("INSERT INTO users (email, role) VALUES ('old@mb.org', 'volunteer')").run().lastInsertRowid);
  const raw = crypto.randomBytes(32).toString('base64url');          // how tokens used to be stored
  old.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, '2999-01-01T00:00:00.000Z')").run(raw, uid);
  const already = sha('some other token');
  old.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, '2999-01-01T00:00:00.000Z')").run(already, uid);
  old.close();

  old = openDb(file);                                                 // a new deploy starts
  const rows = old.prepare('SELECT token FROM sessions ORDER BY token').all().map((r) => r.token);
  assert.deepEqual(rows, [raw, already].map((t) => (t === raw ? sha(raw) : t)).sort());
  assert.ok(!rows.includes(raw));
  const srv = createApp({ db: old, uploadDir: dir }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/me`, { headers: { cookie: `mb_session=${raw}` } });
  assert.equal((await res.json()).email, 'old@mb.org');
  srv.closeAllConnections(); srv.close();
  old.close();
  // Starting again changes nothing.
  old = openDb(file);
  assert.deepEqual(old.prepare('SELECT token FROM sessions ORDER BY token').all().map((r) => r.token), rows);
  old.close();
});

test('signing out ends that session’s stream, and only that one', async () => {
  const id = addUser('c@mb.org');
  const one = signIn(id), two = signIn(id);
  const s1 = await openStream(one), s2 = await openStream(two);
  await call(one, 'POST', '/auth/logout');
  assert.equal(await s1.ended(), true);
  assert.equal(await s2.ended(), false);
  s2.close();
});

test('deactivating or deleting an account ends all its streams', async () => {
  const admin = signIn(addUser('admin@mb.org', 'admin'));
  const id = addUser('d@mb.org');
  const a = signIn(id), b = signIn(id);
  const sa = await openStream(a), sb = await openStream(b);
  assert.equal((await call(admin, 'PATCH', `/api/users/${id}`, { active: false })).status, 200);
  assert.equal(await sa.ended(), true);
  assert.equal(await sb.ended(), true);
  assert.equal(streams.size, 0);

  const id2 = addUser('e@mb.org');
  const sc = await openStream(signIn(id2));
  assert.equal((await call(admin, 'DELETE', `/api/users/${id2}`)).status, 200);
  assert.equal(await sc.ended(), true);
});

test('changing a role or campus limits ends the account’s streams; other accounts keep theirs', async () => {
  const admin = signIn(addUser('admin2@mb.org', 'admin'));
  const id = addUser('f@mb.org'), other = addUser('g@mb.org');
  const mine = await openStream(signIn(id)), theirs = await openStream(signIn(other));
  assert.equal((await call(admin, 'PATCH', `/api/users/${id}`, { role: 'leader' })).status, 200);
  assert.equal(await mine.ended(), true);
  const again = await openStream(signIn(id));
  db.exec("INSERT OR IGNORE INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'N', 'America/Chicago')");
  assert.equal((await call(admin, 'PATCH', `/api/users/${id}`, { campus_ids: [1] })).status, 200);
  assert.equal(await again.ended(), true);
  assert.equal(await theirs.ended(), false);
  theirs.close();
});

test('a stream whose session has expired stops receiving', async () => {
  const id = addUser('h@mb.org');
  const cookie = signIn(id);
  const s = await openStream(cookie);
  send([id], null, { type: 'hello' });
  await s.ended();
  assert.ok(s.text().includes('"type":"hello"'));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run('2000-01-01T00:00:00.000Z', sha(rawToken(cookie)));
  send([id], null, { type: 'later' });
  assert.equal(await s.ended(), true);
  assert.ok(!s.text().includes('later'));
});
