// Sign-in and public-route rate limits: flooding, code emails, /48 factors. Uses its own small
// apps (fresh limiters each time) and X-Forwarded-For (trusted from loopback in tests) for addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb, setSetting } from '../server/db.js';
import { authRoutes } from '../server/auth.js';
import { createApp, trustProxy } from '../server/index.js';
import { outbox } from '../server/mail.js';
import { productionChecks } from '../server/routes/checks.js';
import { startSession } from '../server/auth.js';
import { ipBucket, ipWide, createLimiter } from '../server/ratelimit.js';

async function authApp(db = openDb(':memory:')) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  const limiters = authRoutes(app, db);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const post = async (path, body, ip = '203.0.113.1') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  return { db, post, limiters, close: () => server.close() };
}

test('password sign-in: a 10,000-character email is refused and creates no limiter key', async () => {
  const t = await authApp();
  try {
    const before = t.limiters.limits.size + t.limiters.emailLimits.size;
    const r = await t.post('/auth/password', { email: `${'a'.repeat(10000)}@example.com`, password: 'x' });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /don’t match/);
    assert.equal((await t.post('/auth/password', { email: 'not an email', password: 'x' })).status, 401);
    assert.equal(t.limiters.limits.size + t.limiters.emailLimits.size, before, 'nothing was recorded');
  } finally { t.close(); }
});

test('a client over its address limit sending new emails adds no email keys', async () => {
  const t = await authApp();
  try {
    // 40 tries per 15 minutes per address; use them up with one email-sized key each.
    for (let i = 0; i < 40; i++) assert.equal((await t.post('/auth/password', { email: `a${i}@example.com`, password: 'x' }, '198.51.100.7')).status, 401);
    const keys = t.limiters.emailLimits.size;
    for (let i = 0; i < 25; i++) assert.equal((await t.post('/auth/password', { email: `new${i}@example.com`, password: 'x' }, '198.51.100.7')).status, 429);
    assert.equal(t.limiters.emailLimits.size, keys, 'a refused client creates no new email keys');
    // The same for code requests.
    for (let i = 0; i < 20; i++) await t.post('/auth/code', { email: `c${i}@example.com` }, '198.51.100.8');
    const codeKeys = t.limiters.emailLimits.size;
    assert.equal((await t.post('/auth/code', { email: 'one-more@example.com' }, '198.51.100.8')).status, 429);
    assert.equal(t.limiters.emailLimits.size, codeKeys);
  } finally { t.close(); }
});

test('a key at its limit survives a flood of other keys', () => {
  const l = createLimiter({ cap: 100 });
  for (let i = 0; i < 3; i++) assert.ok(l.hit('locked', 3, 3600e3));
  assert.equal(l.hit('locked', 3, 3600e3), false);
  for (let i = 0; i < 500; i++) l.hit(`flood${i}`, 3, 3600e3); // 'locked' is idle (least recently used)
  assert.ok(l.size <= 100);
  assert.equal(l.hit('locked', 3, 3600e3), false, 'still refused after 500 other keys');
});

test('code emails: unknown emails under “invited” get the usual answer and no email; known ones get a code', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'sign_in_policy', 'invited');
  db.prepare("INSERT INTO users (email, role) VALUES ('known@example.com', 'volunteer')").run();
  db.prepare("INSERT INTO users (email, role, active) VALUES ('gone@example.com', 'volunteer', 0)").run();
  const t = await authApp(db);
  try {
    const n = outbox.length;
    const r = await t.post('/auth/code', { email: 'stranger@example.com' });
    assert.deepEqual([r.status, r.data], [200, { ok: true }]);
    assert.equal((await t.post('/auth/code', { email: 'gone@example.com' })).status, 200);
    assert.equal(outbox.length, n, 'nothing was sent');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM login_codes WHERE email IN ('stranger@example.com', 'gone@example.com')").get().n, 0);
    const k = await t.post('/auth/code', { email: 'known@example.com' });
    assert.deepEqual([k.status, k.data], [200, { ok: true }], 'same answer');
    assert.equal(outbox.length, n + 1);
    assert.equal(outbox.at(-1).to, 'known@example.com');
    // Someone in People can still get a code under “directory”, an outsider can’t.
    setSetting(db, 'sign_in_policy', 'directory');
    db.prepare("INSERT INTO people (first_name, last_name, email) VALUES ('Pat', 'Member', 'pat@example.com')").run();
    await t.post('/auth/code', { email: 'pat@example.com' });
    await t.post('/auth/code', { email: 'outsider@example.com' });
    assert.deepEqual(outbox.slice(n + 1).map((m) => m.to), ['pat@example.com']);
    // Under “anyone” a new person may sign up, so they still get a code.
    setSetting(db, 'sign_in_policy', 'anyone');
    await t.post('/auth/code', { email: 'brand-new@example.com' });
    assert.equal(outbox.at(-1).to, 'brand-new@example.com');
  } finally { t.close(); }
});

test('code emails: a server-wide hourly ceiling (max_code_emails_per_hour) answers 429', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'max_code_emails_per_hour', 3);
  const t = await authApp(db);
  try {
    const n = outbox.length;
    // Different addresses and emails, so only the ceiling can stop it.
    for (let i = 0; i < 3; i++) assert.equal((await t.post('/auth/code', { email: `p${i}@example.com` }, `203.0.113.${10 + i}`)).status, 200);
    const r = await t.post('/auth/code', { email: 'p9@example.com' }, '203.0.113.99');
    assert.equal(r.status, 429);
    assert.match(r.data.error, /sent several codes already/);
    assert.equal(outbox.length, n + 3);
  } finally { t.close(); }
});

// ---------------------------------------------------------------- the wide (/48) factors
test('connect cards: 21 cards from 21 /64s of one /48 are accepted; one /64 is refused on its 6th, honestly', async () => {
  const db = openDb(':memory:');
  const server = createApp({ db, uploadDir: '/tmp' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const send = (ip, n) => fetch(`http://127.0.0.1:${server.address().port}/api/public/connect`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1', 'x-forwarded-for': ip },
    body: JSON.stringify({ first_name: `Guest${n}`, email: `guest${n}@example.com` }),
  });
  try {
    for (let i = 1; i <= 21; i++) assert.equal((await send(`2001:db8:5:${i.toString(16)}::1`, i)).status, 201, `card ${i}`);
    for (let i = 1; i <= 5; i++) assert.equal((await send('2001:db8:9:1::1', 100 + i)).status, 201);
    const r = await send('2001:db8:9:1::2', 106); // same /64
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error, 'We couldn’t send your card just now. Please try again in a few minutes.');
  } finally { server.close(); }
});

test('once a /48 is refused, new /64s in it add no limiter keys', () => {
  return import('../server/ratelimit.js').then(({ ipAllowed }) => {
    const l = createLimiter();
    // Fill the /48 (max 2 × wide 3 = 6), then a 7th from yet another /64 is refused.
    for (let i = 1; i <= 6; i++) assert.ok(ipAllowed(l, 'x', `2001:db8:7:${i}::1`, 2, 60e3, { wide: 3 }));
    assert.equal(ipAllowed(l, 'x', '2001:db8:7:ff::1', 2, 60e3, { wide: 3 }), false);
    const size = l.size;
    for (let i = 0x100; i < 0x100 + 1000; i++) assert.equal(ipAllowed(l, 'x', `2001:db8:7:${i.toString(16)}::1`, 2, 60e3, { wide: 3 }), false);
    assert.equal(l.size, size, 'size unchanged after 1,000 new /64s');
  });
});

test('strings that aren’t IP addresses don’t throw and never share ::1’s bucket', () => {
  const odd = ['', 'unknown', 'not an ip', '::1::2', '1.2.3', ':::', 'x'.repeat(500), '2001:db8::zz', undefined, null];
  for (const s of odd) {
    assert.doesNotThrow(() => ipBucket(s));
    assert.notEqual(ipBucket(s), ipBucket('::1'));
    assert.equal(ipWide(s), null);
  }
  assert.ok(ipBucket('x'.repeat(500)).length <= 64 + 4, 'capped');
  assert.notEqual(ipBucket('1.2.3'), ipBucket('1.2.3.4'));
});

// ---------------------------------------------------------------- checks and proxy setting
test('Settings → Checks never shows the SMTP secrets and shows the admin’s own address', async () => {
  const SECRET = 'smtp-secret-9f3a1c-value';
  const USER = 'mailer-user-77b2@example.com';
  const keep = { u: process.env.MB_SMTP_USER, p: process.env.MB_SMTP_PASS };
  const db = openDb(':memory:');
  const server = createApp({ db, uploadDir: '/tmp' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    process.env.MB_SMTP_USER = USER;
    process.env.MB_SMTP_PASS = SECRET;
    const id = db.prepare("INSERT INTO users (email, role) VALUES ('boss@example.com', 'admin')").run().lastInsertRowid;
    let cookie;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookie = v.split(';')[0]; } }, id);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/production-checks`, { headers: { cookie, 'x-forwarded-for': '203.0.113.77' } });
    const text = await res.text();
    assert.equal(res.status, 200);
    for (const s of [SECRET, USER]) {
      assert.ok(!text.includes(s), 'route output has no secret');
      assert.ok(!JSON.stringify(productionChecks(db)).includes(s), 'productionChecks has no secret');
    }
    const row = JSON.parse(text).checks.find((c) => c.id === 'your_address');
    assert.equal(row.status, 'info');
    assert.match(row.detail, /^203\.0\.113\.77\./);
    assert.ok(!productionChecks(db).checks.some((c) => c.id === 'your_address'), 'only when an address is passed in');
  } finally {
    server.close();
    for (const [k, v] of [['MB_SMTP_USER', keep.u], ['MB_SMTP_PASS', keep.p]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('MB_TRUST_PROXY is trimmed, and the Checks page agrees', () => {
  assert.equal(trustProxy(' 1 '), 1);
  assert.equal(trustProxy('1\n'), 1);
  assert.equal(trustProxy(' true '), true);
  assert.equal(trustProxy('  '), 'loopback, linklocal, uniquelocal');
  assert.equal(trustProxy(undefined), 'loopback, linklocal, uniquelocal');
  const db = openDb(':memory:');
  const tp = productionChecks(db, { RENDER: 'true', MB_TRUST_PROXY: ' 1 ' }).checks.find((c) => c.id === 'trust_proxy');
  assert.equal(tp.status, 'ok');
});
