// The demo seed deletes the database it points at, so it must refuse anything that might be real:
// the live server, a path outside this project's data/ folder, and an existing file that isn't
// marked as sample data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { seedTargetProblem, sampleFileState, dataDir, repoRoot, SAMPLE_KEY } from '../server/sample.js';

fs.mkdirSync(dataDir, { recursive: true });
const work = fs.mkdtempSync(path.join(dataDir, 'test-seed-'));
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

const seed = (file, env = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed-demo.js'], {
  cwd: repoRoot, encoding: 'utf8', env: { PATH: process.env.PATH, ...env, MB_DB: file },
});
const realLooking = (file) => {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO settings VALUES ('church_name', '\"A real church\"');");
  db.close();
};

test('the seed refuses to run on the live server', () => {
  assert.match(seedTargetProblem(path.join(work, 'a.db'), { NODE_ENV: 'production' }), /live server/);
  assert.match(seedTargetProblem(path.join(work, 'a.db'), { RENDER: 'true' }), /live server/);
  assert.equal(seedTargetProblem(path.join(work, 'a.db'), {}), null);
  const file = path.join(work, 'prod.db');
  const r = seed(file, { NODE_ENV: 'production' });
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(file), false, 'nothing was written');
});

test('the seed refuses a path outside the data folder, including one reached through a link', () => {
  assert.match(seedTargetProblem('/data/meadowbrook.db', {}), /data\/ folder/);
  assert.match(seedTargetProblem(path.join(repoRoot, 'meadowbrook.db'), {}), /data\/ folder/);
  assert.match(seedTargetProblem(path.join(dataDir, '..', 'x.db'), {}), /data\/ folder/);
  assert.match(seedTargetProblem(dataDir, {}), /data\/ folder/);
  const outside = fs.mkdtempSync(path.join(path.dirname(repoRoot), 'mb-outside-'));
  try {
    fs.symlinkSync(outside, path.join(work, 'link'));
    assert.match(seedTargetProblem(path.join(work, 'link', 'x.db'), {}), /data\/ folder/);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('the seed will not delete a database that is not marked as sample data', () => {
  const file = path.join(work, 'church.db');
  realLooking(file);
  assert.equal(sampleFileState(file), 'unmarked');
  assert.match(seedTargetProblem(file, {}), /isn't marked as sample data/);
  const r = seed(file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /isn't marked as sample data/);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'church_name'").get().value, '"A real church"', 'the file is untouched');
  db.close();
  // Something that is not a database at all is also left alone.
  const junk = path.join(work, 'notes.db');
  fs.writeFileSync(junk, 'not a database');
  assert.equal(seed(junk).status, 1);
  assert.equal(fs.readFileSync(junk, 'utf8'), 'not a database');
});

test('the seed writes the marker, and may run again over its own file', () => {
  const file = path.join(work, 'sample.db');
  const first = seed(file);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(sampleFileState(file), 'marked');
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get(SAMPLE_KEY).value, '1');
  db.close();
  const again = seed(file);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(sampleFileState(path.join(work, 'nothing.db')), 'missing');
});
