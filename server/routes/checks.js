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

// `ip` is the requesting admin's own address as this server sees it; it is shown to them and not stored.
// `codeCapHitAt` is when the sign-in code limit for new accounts last refused someone (ms; 0 = never).
export function productionChecks(db, env = process.env, { ip, codeCapHitAt = 0 } = {}) {
  const hosted = Boolean(env.RENDER);
  const out = [];
  const add = (id, label, status, detail) => out.push({ id, label, status, detail }); // status: ok | warn | bad | info

  const dev = env.MB_DEV_LOGIN === '1';
  add('dev_login', 'Test sign-in is off', dev ? (hosted ? 'bad' : 'warn') : 'ok',
    dev ? 'MB_DEV_LOGIN is on: anyone who opens the sign-in page can sign in as anyone. Remove it in the host’s environment settings.' : 'MB_DEV_LOGIN isn’t set.');

  const tp = (env.MB_TRUST_PROXY ?? '').trim();
  // A small number of proxy hops (Render today: its Cloudflare edge plus its load balancer = 2). The
  // number is right when "Your address as this server sees it" matches a what-is-my-IP site; "true"
  // or a list would let visitors forge their address, so only 1–2 count as set.
  const hops = /^[12]$/.test(tp);
  add('trust_proxy', 'Real visitor addresses (MB_TRUST_PROXY)', hops ? 'ok' : hosted ? 'bad' : 'info',
    hops ? `Set to ${tp} proxy hop${tp === '1' ? '' : 's'}. Check the next row matches a “what is my IP” site; on Render it is 2.`
      : `Set to “${tp || '(not set)'}”. On a host it must be a number of proxy hops (on Render, 2), or rate limits see the proxy’s address (or a forged one) instead of the visitor’s.`);

  if (ip) {
    add('your_address', 'Your address as this server sees it', 'info',
      `${ip}. Compare it with a “what is my IP” site: if they differ, MB_TRUST_PROXY is probably wrong, and rate limits are counting the proxy’s address instead of each visitor’s.`);
  }

  add('offline', 'Offline mode is off', isOffline() ? (hosted ? 'bad' : 'warn') : 'ok',
    isOffline() ? 'MB_OFFLINE is on: no email, push, backups or reminders go out. It is for restore drills on a laptop only.' : 'Off.');

  const policy = getSetting(db, 'sign_in_policy', 'anyone');
  add('sign_in_policy', 'Only invited people can create accounts', policy === 'invited' ? 'ok' : 'warn',
    policy === 'invited' ? 'Sign-in is set to “invited”.' : `Sign-in is set to “${policy}”. For the staff beta, “invited” is recommended (Settings → Sign-in & accounts).`);

  if (codeCapHitAt && Date.now() - codeCapHitAt < 3600e3) {
    add('code_cap', 'Sign-in code limit for new accounts reached in the last hour', 'warn',
      'New addresses asked for more codes than max_code_emails_per_hour allows, so some got none. People who already have accounts are not affected. If this wasn’t a real rush of sign-ups, someone may be flooding the form: set the sign-in policy to “invited”.');
  }

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

export default function checkRoutes(db, { codeCapHitAt = () => 0 } = {}) {
  const r = Router();
  r.get('/admin/production-checks', requireRole('admin'), (req, res) => res.json(productionChecks(db, process.env, { ip: req.ip, codeCapHitAt: codeCapHitAt() })));
  return r;
}
