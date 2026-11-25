// Unlocks a backup made by the hub (Settings → Backups, or a file from the Google Drive folder).
//   npm run restore -- <backup.db.gz.enc> [out-file] [--check]
// It asks for the backup password without showing it (or reads MB_BACKUP_PASSWORD), so the
// password never lands in shell history. A database backup becomes a .db file; an uploaded-file
// backup ("people__p12-ab.jpg.enc") becomes that file again. --check also confirms an unlocked
// database is whole and says what's in it (docs/restore-drill.md).
// It never overwrites a file, writes the copy readable by you only, and refuses to write inside
// the code folder, where a copy of real data could be committed by mistake.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { decrypt } from '../server/backup.js';
import { checkRestored } from '../server/restore-check.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const [file, outArg] = args.filter((a) => a !== '--check');
if (!file) {
  console.error('Usage: npm run restore -- <backup file> [out file] [--check]');
  process.exit(1);
}
const base = path.basename(file).replace(/\.enc$/, '');
const out = path.resolve(outArg || (base.endsWith('.db.gz') ? base.replace(/\.gz$/, '') : base.split('__').at(-1)));
if (out === repo || out.startsWith(repo + path.sep)) {
  console.error(`Not writing inside the code folder (${repo}): a copy of real data could be committed by mistake. Use a folder like ~/restore-drill.`);
  process.exit(1);
}
if (fs.existsSync(out)) {
  console.error(`${out} already exists. Choose another name, or move it first; restore never overwrites a file.`);
  process.exit(1);
}

const pass = (process.env.MB_BACKUP_PASSWORD || '').trim() || (await askHidden('Backup password (it won’t show as you type): '));
if (!pass) {
  console.error('No password given. It is MB_BACKUP_PASSWORD in Render → Environment.');
  process.exit(1);
}
try {
  fs.writeFileSync(out, decrypt(fs.readFileSync(file), pass), { flag: 'wx', mode: 0o600 });
  console.log(`Unlocked → ${out}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (check) {
  if (!out.endsWith('.db')) {
    console.error('Check skipped: that isn’t a database copy (.db). Nothing was checked.');
    process.exit(3);
  }
  const r = checkRestored(out);
  console.log(`Integrity: ${r.integrity ?? 'not checked'}`);
  if (r.version !== undefined) console.log(`Schema version: ${r.version} (this code: ${r.expected_version}${r.needs_migrations ? '; the hub will add the newer changes when it starts' : ''})`);
  if (r.counts) console.table(r.counts);
  for (const p of r.problems) console.error(`Problem: ${p}`);
  console.log(r.ok ? 'Restore check passed.' : 'Restore check FAILED.');
  process.exit(r.ok ? 0 : 2);
}

// Reads one line without echoing it when typed at a terminal; piped input is read as is.
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      rl._writeToOutput = () => {}; // hide what's typed
    }
    rl.once('line', (line) => { resolve(line.trim()); rl.close(); if (process.stdin.isTTY) process.stdout.write('\n'); });
    rl.once('close', () => resolve(''));
  });
}
