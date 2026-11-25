// Unlocks a backup made by the hub (Settings → Backups, or a file from the Google Drive folder).
//   MB_BACKUP_PASSWORD=… npm run restore -- <backup.db.gz.enc> [out-file] [--check]
// A database backup becomes a .db file; put it where MB_DB points (with the hub stopped) to
// restore. An uploaded-file backup ("people__p12-ab.jpg.enc") becomes that file again.
// --check also confirms an unlocked database is whole and says what's in it (docs/restore-drill.md).
// It never overwrites an existing file.
import fs from 'node:fs';
import path from 'node:path';
import { decrypt } from '../server/backup.js';
import { checkRestored } from '../server/restore-check.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [file, outArg] = args.filter((a) => a !== '--check');
if (!file) {
  console.error('Usage: MB_BACKUP_PASSWORD=… npm run restore -- <backup file> [out file] [--check]');
  process.exit(1);
}
if (!(process.env.MB_BACKUP_PASSWORD || '').trim()) {
  console.error('Set MB_BACKUP_PASSWORD to the backup password (the one in Render → Environment).');
  process.exit(1);
}
const base = path.basename(file).replace(/\.enc$/, '');
const out = outArg || (base.endsWith('.db.gz') ? base.replace(/\.gz$/, '') : base.split('__').at(-1));
if (fs.existsSync(out)) {
  console.error(`${out} already exists. Choose another name, or move it first; restore never overwrites a file.`);
  process.exit(1);
}
try {
  fs.writeFileSync(out, decrypt(fs.readFileSync(file)), { flag: 'wx' });
  console.log(`Unlocked → ${out}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (check && out.endsWith('.db')) {
  const r = checkRestored(out);
  console.log(`Integrity: ${r.integrity ?? 'not checked'}`);
  if (r.version !== undefined) console.log(`Schema version: ${r.version} (this code: ${r.expected_version}${r.needs_migrations ? '; the hub will add the newer changes when it starts' : ''})`);
  if (r.counts) console.table(r.counts);
  for (const p of r.problems) console.error(`Problem: ${p}`);
  console.log(r.ok ? 'Restore check passed.' : 'Restore check FAILED.');
  process.exit(r.ok ? 0 : 2);
}
