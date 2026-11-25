// Settings → Checks (admins): is this server set up safely for real use? Each check is a yes/no
// with a plain explanation. It never shows a secret; only non-secret values (like MB_TRUST_PROXY)
// are echoed. On Render (RENDER is set) the production expectations apply; elsewhere they're
// shown for information.
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { getSetting } from '../db.js';
import { mailConfigured } from '../mail.js';
import { backupStatus } from '../backup.js';
import { isOffline } from '../offline.js';

export function productionChecks(db, env = process.env) {
  const hosted = Boolean(env.RENDER);
  const out = [];
  const add = (id, label, status, detail) => out.push({ id, label, status, detail }); // status: ok | warn | bad | info

  const dev = env.MB_DEV_LOGIN === '1';
  add('dev_login', 'Test sign-in is off', dev ? (hosted ? 'bad' : 'warn') : 'ok',
    dev ? 'MB_DEV_LOGIN is on: anyone who opens the sign-in page can sign in as anyone. Remove it in the host’s environment settings.' : 'MB_DEV_LOGIN isn’t set.');

  const tp = (env.MB_TRUST_PROXY ?? '').trim();
  add('trust_proxy', 'Real visitor addresses (MB_TRUST_PROXY = 1)', tp === '1' ? 'ok' : hosted ? 'bad' : 'info',
    tp === '1' ? 'Set to 1: one proxy hop, as on Render.'
      : `Set to “${tp || '(not set)'}”. On Render it must be exactly 1, or rate limits see the proxy’s address (or a forged one) instead of the visitor’s.`);

  add('offline', 'Offline mode is off', isOffline() ? (hosted ? 'bad' : 'warn') : 'ok',
    isOffline() ? 'MB_OFFLINE is on: no email, push, backups or reminders go out. It is for restore drills on a laptop only.' : 'Off.');

  const policy = getSetting(db, 'sign_in_policy', 'anyone');
  add('sign_in_policy', 'Only invited people can create accounts', policy === 'invited' ? 'ok' : 'warn',
    policy === 'invited' ? 'Sign-in is set to “invited”.' : `Sign-in is set to “${policy}”. For the staff beta, “invited” is recommended (Settings → Sign-in & accounts).`);

  const google = Boolean((env.GOOGLE_CLIENT_ID || '').trim() && (env.GOOGLE_CLIENT_SECRET || '').trim());
  add('email', 'Email can be sent', mailConfigured() ? 'ok' : 'bad',
    mailConfigured() ? 'Email settings are present (MB_SMTP_USER and MB_SMTP_PASS).' : 'No email settings: no sign-in codes, schedule requests, reminders or receipts by email.');
  add('sign_in_methods', 'People have a way to sign in', google || mailConfigured() ? 'ok' : 'bad',
    [google && 'Google sign-in', mailConfigured() && 'email codes'].filter(Boolean).join(' and ') || 'Neither Google sign-in nor email codes is set up.');

  const b = backupStatus(db);
  const last = db.prepare("SELECT created_at FROM backups WHERE status = 'ok' ORDER BY id DESC LIMIT 1").get()?.created_at;
  const ageH = last ? (Date.now() - Date.parse(`${last.replace(' ', 'T')}Z`)) / 3600e3 : null;
  add('backup_password', 'Backups are encrypted', b.password_set ? 'ok' : 'bad', b.password_set ? 'MB_BACKUP_PASSWORD is set.' : 'MB_BACKUP_PASSWORD isn’t set, so no backups are made.');
  add('backup_recent', 'A backup finished in the last 36 hours', ageH !== null && ageH < 36 ? 'ok' : 'bad',
    last ? `Last good backup: ${last} UTC.` : 'No backup has finished yet.');
  add('backup_drive', 'Backups also go to Google Drive', b.drive ? 'ok' : 'warn', b.drive ? `Connected as ${b.drive.email}.` : 'Only on this server’s disk. Connect Google Drive in Settings → Backups.');

  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
  add('admins', 'At least two admins', admins >= 2 ? 'ok' : 'warn', `${admins} active admin${admins === 1 ? '' : 's'}.`);

  const dupes = db.prepare('SELECT COUNT(*) n FROM (SELECT person_id FROM users WHERE person_id IS NOT NULL GROUP BY person_id HAVING COUNT(*) > 1)').get().n;
  add('one_account_per_person', 'One account per person', dupes ? 'bad' : 'ok',
    dupes ? `${dupes} ${dupes === 1 ? 'person has' : 'people have'} more than one account linked. See docs/account-links.md.` : 'No one has two accounts linked.');

  return { hosted, checks: out, ready: !out.some((c) => c.status === 'bad') };
}

export default function checkRoutes(db) {
  const r = Router();
  r.get('/admin/production-checks', requireRole('admin'), (_req, res) => res.json(productionChecks(db)));
  return r;
}
