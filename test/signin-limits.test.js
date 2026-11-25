// Sign-in and public-route rate limits: flooding, code emails, /48 factors. Uses its own small
// apps (fresh limiters each time) and X-Forwarded-For (trusted from loopback in tests) for addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
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

// A stand-in mail server that accepts connections and never answers, or a closed port.
async function stalledSmtp() {
  const socks = new Set();
  const srv = net.createServer((s) => { socks.add(s); s.on('error', () => {}); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, close: () => { for (const s of socks) s.destroy(); srv.close(); } };
}
async function withSmtp(port, fn) {
  const keys = ['MB_SMTP_USER', 'MB_SMTP_PASS', 'MB_SMTP_HOST', 'MB_SMTP_PORT'];
  const keep = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { MB_SMTP_USER: 'web@example.com', MB_SMTP_PASS: 'not-a-real-password', MB_SMTP_HOST: '127.0.0.1', MB_SMTP_PORT: String(port) });
  try { return await fn(); } finally { for (const k of keys) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
}

test('code emails: a known and an unknown email answer the same, fast, even when the mail server stalls', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'sign_in_policy', 'invited');
  db.prepare("INSERT INTO users (email, role) VALUES ('known@example.com', 'volunteer')").run();
  const smtp = await stalledSmtp();
  const t = await authApp(db);
  try {
    await withSmtp(smtp.port, async () => {
      const timed = async (email) => { const t0 = performance.now(); const r = await t.post('/auth/code', { email }); return { r, ms: performance.now() - t0 }; };
      const known = await timed('known@example.com'); // would wait on the stalled server if it sent first
      const unknown = await timed('stranger@example.com');
      for (const x of [known, unknown]) {
        assert.deepEqual([x.r.status, x.r.data], [200, { ok: true }]);
        assert.ok(x.ms < 150, `answered in ${Math.round(x.ms)} ms`);
      }
      assert.equal(db.prepare("SELECT COUNT(*) n FROM login_codes WHERE email = 'known@example.com'").get().n, 1, 'the code is stored');
    });
  } finally { t.close(); smtp.close(); }
});

test('code emails: a failing send still answers 200 and is logged, with no unhandled rejection', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (email, role) VALUES ('known@example.com', 'volunteer')").run();
  const dead = await stalledSmtp();
  const port = dead.port;
  dead.close(); // nothing listens there now: connection refused
  const t = await authApp(db);
  const logged = [];
  const orig = console.error;
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await withSmtp(port, async () => {
      const r = await t.post('/auth/code', { email: 'known@example.com' });
      assert.deepEqual([r.status, r.data], [200, { ok: true }]);
      for (let i = 0; i < 50 && !logged.length; i++) await new Promise((res) => setTimeout(res, 20));
    });
    assert.ok(logged.some((l) => l.includes('Sending the sign-in code failed')), 'the failure is logged');
    await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(unhandled, []);
  } finally { console.error = orig; process.off('unhandledRejection', onUnhandled); t.close(); }
});

test('code emails: the server-wide cap counts only new accounts and never answers 429', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'max_code_emails_per_hour', 3);
  db.prepare("INSERT INTO users (email, role) VALUES ('member@example.com', 'volunteer')").run();
  const t = await authApp(db);
  const warned = [];
  const origWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const n = outbox.length;
    assert.equal(t.limiters.codeCapHitAt(), 0);
    // Under “anyone”: three new addresses use the cap up, from different connections.
    for (let i = 0; i < 3; i++) assert.equal((await t.post('/auth/code', { email: `p${i}@example.com` }, `203.0.113.${10 + i}`)).status, 200);
    assert.equal(outbox.length, n + 3);
    assert.deepEqual(productionChecks(db, {}, { codeCapHitAt: t.limiters.codeCapHitAt() }).checks.filter((c) => c.id === 'code_cap'), [], 'no row yet');
    // A 4th and 5th new address: same answer, no mail, and the warning is logged once.
    for (const e of ['p8@example.com', 'p9@example.com']) {
      const r = await t.post('/auth/code', { email: e }, '203.0.113.99');
      assert.deepEqual([r.status, r.data], [200, { ok: true }]);
    }
    assert.equal(outbox.length, n + 3, 'nothing more was sent');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM login_codes WHERE email IN ('p8@example.com', 'p9@example.com')").get().n, 0);
    assert.equal(warned.length, 1, 'one warning, not one per request');
    // Someone with an account, from a fresh address, still gets their code.
    const k = await t.post('/auth/code', { email: 'member@example.com' }, '203.0.113.150');
    assert.deepEqual([k.status, k.data], [200, { ok: true }]);
    assert.equal(outbox.at(-1).to, 'member@example.com');
    assert.equal(outbox.length, n + 4);
    // Settings → Checks says so.
    const row = productionChecks(db, {}, { codeCapHitAt: t.limiters.codeCapHitAt() }).checks.find((c) => c.id === 'code_cap');
    assert.equal(row.status, 'warn');
    assert.equal(row.label, 'Sign-in code limit for new accounts reached in the last hour');
    assert.ok(!productionChecks(db, {}, { codeCapHitAt: Date.now() - 2 * 3600e3 }).checks.some((c) => c.id === 'code_cap'), 'clears after an hour');
  } finally { console.warn = origWarn; t.close(); }
});

test('code emails: under “invited” existing members all get mail even with a cap of 3', async () => {
  const db = openDb(':memory:');
  setSetting(db, 'sign_in_policy', 'invited');
  setSetting(db, 'max_code_emails_per_hour', 3);
  for (let i = 0; i < 4; i++) db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(`m${i}@example.com`, 'volunteer');
  const t = await authApp(db);
  try {
    const n = outbox.length;
    for (let i = 0; i < 4; i++) assert.equal((await t.post('/auth/code', { email: `m${i}@example.com` }, `203.0.113.${20 + i}`)).status, 200);
    assert.deepEqual(outbox.slice(n).map((m) => m.to), ['m0@example.com', 'm1@example.com', 'm2@example.com', 'm3@example.com']);
    assert.equal(t.limiters.codeCapHitAt(), 0, 'the cap was never touched');
  } finally { t.close(); }
});

test('settings: the code-email cap is shown to admins only', async () => {
  const db = openDb(':memory:');
  const server = createApp({ db, uploadDir: '/tmp' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const get = async (role) => {
      const id = db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(`${role}@example.com`, role).lastInsertRowid;
      let cookie;
      startSession(db, { secure: false }, { setHeader: (_k, v) => { cookie = v.split(';')[0]; } }, id);
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/settings`, { headers: { cookie } });
      assert.equal(res.status, 200);
      return res.json();
    };
    const vol = await get('volunteer');
    assert.ok(!('max_code_emails_per_hour' in vol));
    assert.equal(vol.church_name, 'Meadowbrook Church', 'other settings still come back');
    assert.equal((await get('admin')).max_code_emails_per_hour, 200);
  } finally { server.close(); }
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

test('code emails: every valid request takes a slot from the cap, so filling it shows nothing about who has an account', async () => {
  // Cap 2: one member and one stranger each take a slot; a fresh new address then gets nothing,
  // exactly as if two strangers had asked. Members still get their code.
  for (const first of ['member2@example.com', 'stranger0@example.com']) {
    const db = openDb(':memory:');
    setSetting(db, 'max_code_emails_per_hour', 2);
    db.prepare("INSERT INTO users (email, role) VALUES ('member2@example.com', 'volunteer')").run();
    const t = await authApp(db);
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      await t.post('/auth/code', { email: first }, '203.0.113.201');
      await t.post('/auth/code', { email: 'stranger1@example.com' }, '203.0.113.202');
      const n = outbox.length;
      assert.deepEqual((await t.post('/auth/code', { email: 'fresh@example.com' }, '203.0.113.203')).data, { ok: true });
      assert.equal(outbox.length, n, `no code for a new address once two slots are taken (first: ${first})`);
      await t.post('/auth/code', { email: 'member2@example.com' }, '203.0.113.204');
      assert.equal(outbox.at(-1).to, 'member2@example.com', 'members are never held back');
    } finally { console.warn = origWarn; t.close(); }
  }
});
