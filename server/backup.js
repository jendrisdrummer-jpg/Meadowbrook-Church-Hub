// Nightly backups: a consistent copy of the database (VACUUM INTO), gzipped and encrypted with
// MB_BACKUP_PASSWORD (AES-256-GCM, key from scrypt), sent to the Google Drive account an admin
// connected in Settings → Backups. Uploaded files (photos, song files, app pictures) go too,
// each encrypted, only when new or changed. Copies kept: the last 14, plus one a month for a
// year; the last 3 also stay on this server's disk. `npm run restore` unlocks a copy.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { localNow } from './http.js';
import { notify } from './notify.js';

const MAGIC = Buffer.from('MBBK1\n');
const KEEP_RECENT = 14;
const KEEP_MONTHS = 12;
const KEEP_LOCAL = 3;
const FILES_PER_RUN = 400;

const password = () => (process.env.MB_BACKUP_PASSWORD || '').trim();
export const backupDir = () => process.env.MB_BACKUP_DIR || path.join(path.dirname(path.resolve(process.env.MB_DB || 'data/meadowbrook.db')), 'backups');
const googleApi = () => (process.env.MB_GOOGLE_API || 'https://www.googleapis.com').replace(/\/+$/, '');
const tokenUrl = () => process.env.MB_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// ---------------------------------------------------------------- locking and unlocking
export function encrypt(data, pass = password()) {
  if (!pass) throw new Error('Set MB_BACKUP_PASSWORD on the server first.');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(data)), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}

export function decrypt(file, pass = password()) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('That isn’t a Church Hub backup file.');
  const salt = file.subarray(6, 22);
  const iv = file.subarray(22, 34);
  const tag = file.subarray(file.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  d.setAuthTag(tag);
  try {
    return zlib.gunzipSync(Buffer.concat([d.update(file.subarray(34, file.length - 16)), d.final()]));
  } catch {
    throw new Error('Wrong password, or the file is damaged.');
  }
}

// ---------------------------------------------------------------- Google Drive
const drive = (db) => getSetting(db, 'backup_drive', null);

async function accessToken(db) {
  const d = drive(db);
  if (!d?.refresh_token) throw new Error('Google Drive isn’t connected.');
  const r = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: (process.env.GOOGLE_CLIENT_ID || '').trim(), client_secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(), refresh_token: d.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20e3),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    throw new Error(t.error === 'invalid_grant'
      ? 'Google Drive access was removed or expired. Connect Google Drive again in Settings → Backups.'
      : `Google sign-in for Drive failed (${t.error || r.status}).`);
  }
  return t.access_token;
}

async function api(token, method, url, body, headers = {}) {
  const r = await fetch(`${googleApi()}${url}`, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body, signal: AbortSignal.timeout(120e3) });
  if (method === 'DELETE') return r.ok || r.status === 404;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Drive: ${data.error?.message || r.status}`);
  return data;
}

async function folder(db, token, key, name, parent) {
  const d = drive(db);
  if (d[key]) {
    const f = await api(token, 'GET', `/drive/v3/files/${d[key]}?fields=id,trashed`).catch(() => null);
    if (f && !f.trashed) return d[key];
  }
  const made = await api(token, 'POST', '/drive/v3/files?fields=id', JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }), { 'content-type': 'application/json' });
  setSetting(db, 'backup_drive', { ...drive(db), [key]: made.id });
  return made.id;
}

async function upload(token, name, data, parent) {
  const boundary = `mb${crypto.randomBytes(8).toString('hex')}`;
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const f = await api(token, 'POST', '/upload/drive/v3/files?uploadType=multipart&fields=id,size', body, { 'content-type': `multipart/related; boundary=${boundary}` });
  return f.id;
}

export async function downloadFromDrive(db, id) {
  const token = await accessToken(db);
  const r = await fetch(`${googleApi()}/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw new Error(`Google Drive: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------------------------------------------------------- one run
function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (path.resolve(full) === path.resolve(backupDir())) continue; // never back up the backups
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

let running = null;

export function runBackup(db, { uploadDir, reason = 'nightly' } = {}) {
  running ||= doBackup(db, { uploadDir, reason }).finally(() => { running = null; });
  return running;
}

async function doBackup(db, { uploadDir, reason }) {
  const church = getSetting(db, 'church_name', 'Church');
  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  const slug = church.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'church';
  const name = `${slug}-hub-${stamp}.db.gz.enc`;
  const id = Number(db.prepare("INSERT INTO backups (name, status, reason) VALUES (?, 'running', ?)").run(name, reason).lastInsertRowid);
  const tmp = path.join(backupDir(), `.snapshot-${process.pid}-${Date.now()}.db`);
  let sent = 0;
  try {
    if (!password()) throw new Error('Set MB_BACKUP_PASSWORD on the server (Render → Environment) to turn on backups.');
    fs.mkdirSync(backupDir(), { recursive: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const sealed = encrypt(fs.readFileSync(tmp));
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(path.join(backupDir(), name), sealed);
    db.prepare('UPDATE backups SET size = ?, local = 1 WHERE id = ?').run(sealed.length, id);

    let driveId = null;
    if (drive(db)?.refresh_token) {
      const token = await accessToken(db);
      const root = await folder(db, token, 'folder_id', `${church} Hub backups`);
      driveId = await upload(token, name, sealed, root);
      db.prepare('UPDATE backups SET drive_id = ? WHERE id = ?').run(driveId, id);
      // Uploaded files that are new or changed since the last run.
      if (uploadDir) {
        const filesFolder = await folder(db, token, 'files_folder_id', 'Uploaded files', root);
        const known = new Map(db.prepare('SELECT * FROM backup_files').all().map((f) => [f.path, f]));
        const save = db.prepare(`INSERT INTO backup_files (path, size, mtime, drive_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, drive_id = excluded.drive_id, backed_up_at = datetime('now')`);
        for (const rel of walk(uploadDir)) {
          if (sent >= FILES_PER_RUN) break; // the rest go tomorrow night
          const st = fs.statSync(path.join(uploadDir, rel));
          const was = known.get(rel);
          if (was && was.size === st.size && was.mtime === Math.floor(st.mtimeMs)) continue;
          const fid = await upload(token, `${rel.split(path.sep).join('__')}.enc`, encrypt(fs.readFileSync(path.join(uploadDir, rel))), filesFolder);
          if (was?.drive_id) await api(token, 'DELETE', `/drive/v3/files/${was.drive_id}`).catch(() => {});
          save.run(rel, st.size, Math.floor(st.mtimeMs), fid);
          sent += 1;
        }
      }
      await prune(db, token);
    } else {
      pruneLocal(db);
    }
    db.prepare("UPDATE backups SET status = 'ok', files = ?, error = '' WHERE id = ?").run(sent, id);
    if (!driveId) db.prepare("UPDATE backups SET error = 'Saved on this server only: connect Google Drive for an off-site copy.' WHERE id = ?").run(id);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    db.prepare("UPDATE backups SET status = 'failed', files = ?, error = ? WHERE id = ?").run(sent, String(e.message).slice(0, 500), id);
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
    notify(db, admins, { kind: 'backup', title: 'Last night’s backup didn’t finish', body: String(e.message).slice(0, 200), url: '/#/settings/backups' });
  }
  return db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
}

// Keep the newest 14, and the first copy of each of the last 12 months; delete the rest.
function keepers(rows) {
  const keep = new Set(rows.slice(0, KEEP_RECENT).map((r) => r.id));
  const months = new Map();
  for (const r of [...rows].reverse()) if (!months.has(r.created_at.slice(0, 7))) months.set(r.created_at.slice(0, 7), r.id);
  [...months.entries()].sort().reverse().slice(0, KEEP_MONTHS).forEach(([, id]) => keep.add(id));
  return keep;
}

async function prune(db, token) {
  const rows = db.prepare("SELECT * FROM backups WHERE status = 'ok' AND drive_id IS NOT NULL ORDER BY created_at DESC, id DESC").all();
  const keep = keepers(rows);
  for (const r of rows.filter((x) => !keep.has(x.id))) {
    if (await api(token, 'DELETE', `/drive/v3/files/${r.drive_id}`).catch(() => false)) db.prepare('UPDATE backups SET drive_id = NULL WHERE id = ?').run(r.id);
  }
  pruneLocal(db);
}

function pruneLocal(db) {
  const rows = db.prepare('SELECT * FROM backups WHERE local = 1 ORDER BY created_at DESC, id DESC').all();
  for (const r of rows.slice(KEEP_LOCAL)) {
    fs.rmSync(path.join(backupDir(), r.name), { force: true });
    db.prepare('UPDATE backups SET local = 0 WHERE id = ?').run(r.id);
  }
}

// Checked every few minutes: from 3 a.m. (church time), once a day.
export function maybeNightly(db, opts) {
  const tz = db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';
  const now = localNow(tz);
  if (now.time < '03:00' || getSetting(db, 'backup_last_day', '') === now.date) return null;
  setSetting(db, 'backup_last_day', now.date);
  return runBackup(db, { ...opts, reason: 'nightly' }).catch((e) => console.error('Backup failed:', e.message));
}

export function connectDrive(db, { refresh_token: refresh, email }) {
  const old = drive(db) || {};
  // Same Google account: keep using its folders. A different one starts fresh.
  setSetting(db, 'backup_drive', { ...(old.email === email ? old : {}), refresh_token: refresh, email, connected_at: new Date().toISOString() });
  if (old.email !== email) db.exec('DELETE FROM backup_files');
}

export function disconnectDrive(db) {
  const d = drive(db);
  if (d?.refresh_token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(d.refresh_token)}`, { method: 'POST' }).catch(() => {});
  setSetting(db, 'backup_drive', null);
}

export const backupStatus = (db) => ({
  password_set: Boolean(password()),
  google_ready: Boolean((process.env.GOOGLE_CLIENT_ID || '').trim() && (process.env.GOOGLE_CLIENT_SECRET || '').trim()),
  drive: drive(db)?.refresh_token ? { email: drive(db).email, connected_at: drive(db).connected_at } : null,
  files_backed_up: db.prepare('SELECT COUNT(*) n FROM backup_files').get().n,
  running: Boolean(running),
});
