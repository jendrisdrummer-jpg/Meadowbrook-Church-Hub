// Findings from the browser regression: the Finance-only person search, readable statement dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { longDate } from '../server/routes/finance.js';

let server, base, db;
const cookies = {};

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-qaf-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'North', 'North', 'America/Chicago')");
  const person = (first, last, extra = {}) => Number(db.prepare('INSERT INTO people (first_name, last_name, nickname, email, phone, campus_id, archived) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(first, last, extra.nickname || '', `${first.toLowerCase()}@example.org`, '555-0100', extra.archived ? 1 : 0).lastInsertRowid);
  person('Gina', 'Giver'); person('Gino', 'Giverson', { nickname: 'G' }); person('Gone', 'Giver', { archived: true }); person('Pct', '100%Sure');
  person('Plain', 'Other');
  for (let i = 0; i < 25; i++) person(`Many${i}`, 'Crowd');
  const make = (key, role, finance) => {
    const id = db.prepare('INSERT INTO users (email, role, finance) VALUES (?, ?, ?)').run(`${key}@mb.test`, role, finance).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  };
  make('finvol', 'volunteer', 1); make('vol', 'volunteer', 0); make('admin', 'admin', 0); make('finadmin', 'admin', 1);
});
after(() => server.close());

const api = async (who, url) => {
  const res = await fetch(`${base}/api${url}`, { headers: { cookie: cookies[who] } });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
};

test('GET /finance/people: a Finance-only volunteer can search, others can’t', async () => {
  const ok = await api('finvol', '/finance/people?q=giver');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.rows.map((p) => p.first_name).sort(), ['Gina', 'Gino'], 'active people only (Gone is archived)');
  assert.equal((await api('vol', '/finance/people?q=giver')).status, 403, 'a plain volunteer');
  assert.equal((await api('admin', '/finance/people?q=giver')).status, 403, 'an admin without Finance');
  assert.equal((await api('finadmin', '/finance/people?q=giver')).status, 200);
});

test('GET /finance/people: only id, names and email; short or wild searches are safe; 20 at most', async () => {
  const { data } = await api('finvol', '/finance/people?q=gina');
  assert.deepEqual(Object.keys(data.rows[0]).sort(), ['email', 'first_name', 'id', 'last_name', 'nickname']);
  assert.deepEqual((await api('finvol', '/finance/people?q=g')).data.rows, [], 'one letter returns nothing');
  assert.equal((await api('finvol', '/finance/people?q=00%25')).data.rows.length, 1, '% is a plain character (only 100%Sure has one)');
  assert.equal((await api('finvol', '/finance/people?q=a_')).data.rows.length, 0, '_ is not a wildcard');
  assert.equal((await api('finvol', '/finance/people?q=crowd')).data.rows.length, 20);
});

test('statements say “Issued” with a readable date', async () => {
  assert.equal(longDate('2026-11-28'), 'November 28, 2026');
  assert.equal(longDate('2026-01-05'), 'January 5, 2026');
  db.prepare("INSERT INTO gifts (name, email, fund_id, amount_cents, fee_cents, method, source, status, given_on) VALUES ('Eve', 'eve@example.org', (SELECT id FROM funds LIMIT 1), 5000, 0, 'check', 'batch', 'succeeded', '2020-03-01')").run();
  const page = (await api('finadmin', `/finance/statements/${encodeURIComponent('e:eve@example.org')}?year=2020`)).data;
  assert.match(page, /Issued [A-Z][a-z]+ \d{1,2}, \d{4}/);
  assert.doesNotMatch(page, /Issued \d{4}-/);
});
