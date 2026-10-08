// Unlocks a backup made by the hub (Settings → Backups, or a file from the Google Drive folder).
//   MB_BACKUP_PASSWORD=… npm run restore -- <backup.db.gz.enc> [out-file]
// A database backup becomes a .db file; put it where MB_DB points (with the hub stopped) to
// restore. An uploaded-file backup ("people__p12-ab.jpg.enc") becomes that file again.
import fs from 'node:fs';
import path from 'node:path';
import { decrypt } from '../server/backup.js';

const [file, outArg] = process.argv.slice(2);
if (!file) {
  console.error('Usage: MB_BACKUP_PASSWORD=… npm run restore -- <backup file> [out file]');
  process.exit(1);
}
if (!(process.env.MB_BACKUP_PASSWORD || '').trim()) {
  console.error('Set MB_BACKUP_PASSWORD to the backup password (the one in Render → Environment).');
  process.exit(1);
}
const base = path.basename(file).replace(/\.enc$/, '');
const out = outArg || (base.endsWith('.db.gz') ? base.replace(/\.gz$/, '') : base.split('__').at(-1));
try {
  fs.writeFileSync(out, decrypt(fs.readFileSync(file)));
  console.log(`Unlocked → ${out}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
