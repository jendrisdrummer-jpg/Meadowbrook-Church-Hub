// Makes a consistent copy of the database (safe while the server is running) and keeps the last 30.
// Run it daily, e.g. from cron:  15 3 * * *  cd /app && node scripts/backup.js
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = process.env.MB_DB || 'data/meadowbrook.db';
const dir = process.env.MB_BACKUPS || 'data/backups';
const keep = Number(process.env.MB_BACKUP_KEEP) || 30;

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const target = path.join(dir, `meadowbrook-${stamp}.db`);
const db = new DatabaseSync(file);
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Backed up to ${target}`);

const old = fs.readdirSync(dir).filter((f) => /^meadowbrook-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) fs.rmSync(path.join(dir, f));
