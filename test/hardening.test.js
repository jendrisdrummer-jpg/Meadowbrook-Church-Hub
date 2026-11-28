// Pre-presentation hardening: health check, upload caching and blocking, headers, CSV guard,
// generic push text, odd cookies and errors, and the daily clean-up. Own database; no dates assumed
// except fixed ones passed in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { openDb, purgeStale, SCHEMA_VERSION } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';

process.env.MB_PUSH_ALLOW_LOCAL = '1';
let db, server, base, dir;
const cookies = {};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hard-'));
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: dir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const person = (first) => Number(db.prepare("INSERT INTO people (first_name, last_name) VALUES (?, 'Test')").run(first).lastInsertRowid);
  for (const [key, role] of [['admin', 'admin'], ['vol', 'volunteer']]) {
    const id = Number(db.prepare('INSERT INTO users (email, role, person_id, finance) VALUES (?, ?, ?, 1)').run(`${key}@h.test`, role, person(key)).lastInsertRowid);
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
});
after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const api = async (role, method, url, body) => {
  const res = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', cookie: cookies[role] }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
};

test('healthz checks the database and the schema version, and leaks nothing', async () => {
  const ok = await fetch(`${base}/healthz`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
  const bad = await fetch(`${base}/healthz`);
  assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { ok: false, reason: 'database' });
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // A database that can't answer at all.
  const dead = openDb(':memory:');
  const s2 = createApp({ db: dead, uploadDir: dir }).listen(0);
  await new Promise((r) => s2.once('listening', r));
  dead.close();
  const res = await fetch(`http://127.0.0.1:${s2.address().port}/healthz`);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: 'database' });
  s2.closeAllConnections(); s2.close();
});

test('uploads are private-cached; chat and song files are never served from the open folder', async () => {
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'photos', 'a.txt'), 'hi');
  const photo = await fetch(`${base}/uploads/photos/a.txt`, { headers: { cookie: cookies.vol } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('cache-control'), 'private, max-age=604800');

  // Song files: private cache header, and not reachable through /uploads.
  fs.mkdirSync(path.join(dir, 'songs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'songs', 'abc.pdf'), '%PDF-1.4');
  const song = Number(db.prepare("INSERT INTO songs (title) VALUES ('Test Song')").run().lastInsertRowid);
  const sf = Number(db.prepare("INSERT INTO song_files (song_id, kind, name, file, mime, size) VALUES (?, 'sheet', 'abc.pdf', 'abc.pdf', 'application/pdf', 8)").run(song).lastInsertRowid);
  const viaApi = await fetch(`${base}/api/song-files/${sf}`, { headers: { cookie: cookies.vol } });
  assert.equal(viaApi.status, 200);
  assert.match(viaApi.headers.get('cache-control'), /^private/);
  assert.doesNotMatch(viaApi.headers.get('cache-control'), /public/);
  for (const p of ['/uploads/songs/abc.pdf', '/uploads/songs', '/uploads/%73ongs/abc.pdf', '/uploads/SONGS/abc.pdf', '/uploads/chat/x.png', '/uploads/%63hat/x.png', '/uploads//chat/x.png']) {
    assert.equal((await fetch(base + p, { headers: { cookie: cookies.admin } })).status, 404, p);
  }

  // Members still get chat files through the checked route.
  const chat = (await api('admin', 'POST', '/chats', { name: 'Hardening' })).data;
  const up = await fetch(`${base}/api/chats/${chat.id}/files`, { method: 'POST', headers: { cookie: cookies.admin, 'x-mb': '1', 'content-type': 'application/octet-stream', 'x-file-type': 'image/png', 'x-file-name': 'p.png' }, body: Buffer.from('89504e470d0a1a0a', 'hex') }).then((r) => r.json());
  const got = await fetch(base + up.url, { headers: { cookie: cookies.admin } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  const stored = fs.readdirSync(path.join(dir, 'chat'))[0];
  assert.equal((await fetch(`${base}/uploads/chat/${stored}`, { headers: { cookie: cookies.admin } })).status, 404);
});

test('baseline security headers', async () => {
  for (const url of ['/healthz', '/login']) {
    const res = await fetch(base + url);
    assert.equal(res.headers.get('content-security-policy'), "object-src 'none'; base-uri 'self'; frame-ancestors 'self'", url);
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', url);
    assert.match(res.headers.get('permissions-policy'), /geolocation=\(\)/);
    assert.equal(res.headers.get('strict-transport-security'), null, 'no HSTS over plain HTTP');
  }
  const https = await fetch(`${base}/healthz`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(https.headers.get('strict-transport-security'), 'max-age=15552000');
});

test('finance CSV guards cells that start like formulas', async () => {
  db.prepare("INSERT INTO gifts (name, amount_cents, given_on, status) VALUES ('=1+1', 1000, '2030-03-03', 'succeeded')").run();
  db.prepare("INSERT INTO gifts (name, amount_cents, given_on, status) VALUES ('Lee, Pat', 500, '2030-03-03', 'succeeded')").run();
  const csv = (await api('admin', 'GET', '/finance/gifts.csv?from=2030-03-01&to=2030-03-31')).data;
  assert.match(csv, /^Date,Giver,Email,Fund,Amount,Fee covered,Method,Source,Status,Campus,Check #\r\n/);
  assert.match(csv, /\n2030-03-03,'=1\+1,/);
  assert.match(csv, /"Lee, Pat"/);
});

// Decrypts what the stand-in push service receives (RFC 8291) so the test can read the push body.
function decryptPush(buf, ua, authSecret) {
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const rest = buf.subarray(21 + idlen);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ua.computeSecret(asPublic), authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(rest.subarray(rest.length - 16));
  const plain = Buffer.concat([d.update(rest.subarray(0, rest.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

test('push notices for connect cards and office requests carry generic text; the inbox keeps the detail', async (t) => {
  const pushes = [];
  const ps = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { pushes.push(Buffer.concat(c)); res.writeHead(201).end(); }); }).listen(0);
  await new Promise((r) => ps.once('listening', r));
  t.after(() => { ps.closeAllConnections(); ps.close(); });
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const sub = await api('admin', 'POST', '/push/subscriptions', { endpoint: `http://127.0.0.1:${ps.address().port}/push/admin`, keys: { p256dh: ua.getPublicKey('base64url'), auth: authSecret.toString('base64url') } });
  assert.ok(sub.status < 300, `subscribed (${sub.status})`);
  const waitFor = async (n) => { for (let i = 0; i < 100 && pushes.length < n; i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(pushes.length >= n, 'a push arrived'); };

  const card = await fetch(`${base}/api/public/connect`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify({ first_name: 'Gus', email: 'gus@example.com', message: 'SECRET-PRAYER-TEXT' }) });
  assert.equal(card.status, 201);
  await waitFor(1);
  const p1 = decryptPush(pushes[0], ua, authSecret);
  assert.equal(p1.body, 'A new connect card is waiting in the Hub.');
  assert.ok(!JSON.stringify(p1).includes('SECRET-PRAYER-TEXT'));

  assert.equal((await api('vol', 'POST', '/me/office-request', { topic: 'other', message: 'PRIVATE-OFFICE-NOTE' })).status, 201);
  await waitFor(2);
  const p2 = decryptPush(pushes[1], ua, authSecret);
  assert.equal(p2.body, 'Someone sent a message to the office.');
  assert.ok(!JSON.stringify(p2).includes('PRIVATE-OFFICE-NOTE'));

  const inbox = JSON.stringify((await api('admin', 'GET', '/notifications')).data);
  assert.ok(inbox.includes('SECRET-PRAYER-TEXT') && inbox.includes('PRIVATE-OFFICE-NOTE'), 'in-app items keep the detail');
});

test('a bad cookie is no cookie, and a missing upload is a quiet 404', async (t) => {
  const bad = await fetch(`${base}/api/me`, { headers: { cookie: 'mb_session=%E0%A4%A; other=%' } });
  assert.equal(bad.status, 401);
  const logged = t.mock.method(console, 'error', () => {});
  const gone = await fetch(`${base}/uploads/photos/nope.png`, { headers: { cookie: cookies.vol } });
  assert.equal(gone.status, 404);
  assert.equal(logged.mock.callCount(), 0, 'not logged as an error');
});

test('purgeStale removes expired sessions and day-old login codes, by a fixed clock', () => {
  const d = openDb(':memory:');
  const u = Number(d.prepare("INSERT INTO users (email, role) VALUES ('s@h.test', 'volunteer')").run().lastInsertRowid);
  const ins = d.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
  ins.run('old', u, '2030-01-15T11:59:59.000Z');
  ins.run('live', u, '2030-01-15T12:00:01.000Z');
  const code = d.prepare("INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES ('s@h.test', 'h', '2030-01-01 00:00:00', ?)");
  code.run('2030-01-14 11:59:59');
  code.run('2030-01-14 12:00:01');
  assert.deepEqual(purgeStale(d, new Date('2030-01-15T12:00:00Z')), { sessions: 1, codes: 1 });
  assert.deepEqual(d.prepare('SELECT token FROM sessions').all().map((r) => r.token), ['live']);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM login_codes').get().n, 1);
});

test('migration 42 adds the two indexes', () => {
  const d = openDb(':memory:');
  assert.ok(SCHEMA_VERSION >= 42);
  const names = d.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  assert.ok(names.includes('checkins_person') && names.includes('sessions_user'));
});
