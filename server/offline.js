// Offline mode (MB_OFFLINE=1), for the restore drill and for looking at a copy of real data on a
// laptop. A copy of the database carries the church's push keys and Google Drive link, so without
// this a local run could push to members' phones, send serving reminders, or back up into (and tidy
// up) the church's Drive folder. In offline mode every outgoing web request except to this machine
// is refused, and the background jobs (reminders, announcements, calls, backups, media) don't start.
// Email is kept in the local outbox in offline mode, even if MB_SMTP_* happen to be set (mail.js).
// Any value except empty, 0, false or no counts as on, so a typo errs on the safe side.
export const isOffline = () => !['', '0', 'false', 'no'].includes(String(process.env.MB_OFFLINE ?? '').trim().toLowerCase());
// Offline copies hold real data and usually run with test sign-in, so only this machine may connect.
export const listenHost = () => (isOffline() ? '127.0.0.1' : undefined);

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function enableOffline() {
  const real = globalThis.fetch;
  if (real.offline) return real.restore;
  const guarded = (input, init) => {
    let host = '';
    try { host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname; } catch { /* not a URL */ }
    if (!LOCAL.has(host)) return Promise.reject(new Error(`Offline mode: not contacting ${host || 'that address'}.`));
    return real(input, { ...init, redirect: 'error' }); // a local redirect can't lead outside
  };
  guarded.offline = true;
  guarded.restore = () => { globalThis.fetch = real; };
  globalThis.fetch = guarded;
  return guarded.restore;
}
