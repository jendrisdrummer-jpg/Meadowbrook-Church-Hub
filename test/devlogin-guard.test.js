// Test sign-in is refused on a live server (RENDER or NODE_ENV=production) even when MB_DEV_LOGIN=1,
// and still works on a laptop, where `npm run dev`, the demo and ui-smoke rely on it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { devLoginAllowed } from '../server/devlogin.js';

const servers = [];
after(() => servers.forEach((s) => s.close()));

// createApp reads the environment when it starts, so set it first and put it back after.
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO users (email, role) VALUES ('a@example.org', 'admin')").run();
    const server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-dl-')) }).listen(0);
    servers.push(server);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dev = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mb': '1' }, body: JSON.stringify({ email: 'a@example.org' }) });
    const options = await (await fetch(`${base}/auth/options`)).json();
    return await fn({ dev, options });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('the rule: needs the flag, and no RENDER or production', () => {
  assert.equal(devLoginAllowed({ MB_DEV_LOGIN: '1' }), true);
  assert.equal(devLoginAllowed({}), false);
  assert.equal(devLoginAllowed({ MB_DEV_LOGIN: '1', RENDER: 'true' }), false);
  assert.equal(devLoginAllowed({ MB_DEV_LOGIN: '1', NODE_ENV: 'production' }), false);
});

test('on Render, MB_DEV_LOGIN=1 is ignored', async () => {
  await withEnv({ MB_DEV_LOGIN: '1', RENDER: '1', NODE_ENV: undefined }, ({ dev, options }) => {
    assert.equal(dev.status, 404);
    assert.equal(options.dev, false);
  });
});

test('with NODE_ENV=production, MB_DEV_LOGIN=1 is ignored', async () => {
  await withEnv({ MB_DEV_LOGIN: '1', RENDER: undefined, NODE_ENV: 'production' }, ({ dev, options }) => {
    assert.equal(dev.status, 404);
    assert.equal(options.dev, false);
  });
});

test('on a laptop, MB_DEV_LOGIN=1 still signs in', async () => {
  await withEnv({ MB_DEV_LOGIN: '1', RENDER: undefined, NODE_ENV: undefined }, ({ dev, options }) => {
    assert.equal(dev.status, 200);
    assert.equal(options.dev, true);
  });
});
