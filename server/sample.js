// Sample data: the marker that says a database holds only made-up data, and the guard that stops
// the demo seed from ever touching anything else. The seed deletes its target file before it
// writes, so it must be certain what it is deleting: it only runs inside this repo's data/ folder,
// never on the live server, and only over a file that is missing or carries the marker.
// The marker is a settings row the seed writes (sample_data = 1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const SAMPLE_KEY = 'sample_data'; // a settings row; the seed writes it as 1

export const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const dataDir = path.join(repoRoot, 'data');

// True for a database that holds the sample marker.
export function isSampleDb(db) {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(SAMPLE_KEY)?.value === '1'; } catch { return false; }
}

// 'missing' (no such file), 'marked' (sample data) or 'unmarked' (anything else, including a file
// that isn't a database at all). Opens the file read-only: no migrations, no writes, no new files.
export function sampleFileState(file) {
  if (!fs.existsSync(file)) return 'missing';
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return isSampleDb(db) ? 'marked' : 'unmarked';
  } catch {
    return 'unmarked';
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// The real location of a path, following symlinks as far as it exists, so a link inside data/
// can't point the seed at a file somewhere else.
function realish(p) {
  const abs = path.resolve(p);
  const tail = [];
  let head = abs;
  while (!fs.existsSync(head) && path.dirname(head) !== head) { tail.unshift(path.basename(head)); head = path.dirname(head); }
  return path.join(fs.realpathSync(head), ...tail);
}

// Why the seed must not run against this file, or null when it may. Plain-English, since a person
// reads it in a terminal.
export function seedTargetProblem(file, env = process.env) {
  if (env.NODE_ENV === 'production' || env.RENDER) {
    return 'Not seeding: this looks like the live server (NODE_ENV=production or RENDER is set). The demo seed deletes the database it points at, so it only runs on a laptop.';
  }
  const target = realish(file);
  const rel = path.relative(realish(dataDir), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return `Not seeding ${file}: the demo seed only writes inside this project's data/ folder (${dataDir}), because it deletes the file it points at.`;
  }
  if (sampleFileState(target) === 'unmarked') {
    return `Not seeding ${file}: it already exists and isn't marked as sample data, so it might be real. The seed won't delete it. If it is an old demo database you don't need, delete that file yourself and run this again.`;
  }
  return null;
}
