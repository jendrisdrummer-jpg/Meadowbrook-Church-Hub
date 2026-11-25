// Offline mode (MB_OFFLINE=1), for the restore drill and for looking at a copy of real data on a
// laptop. A copy of the database carries the church's push keys and Google Drive link, so without
// this a local run could push to members' phones, send serving reminders, or back up into (and tidy
// up) the church's Drive folder. In offline mode every outgoing web request except to this machine
// is refused, and the background jobs (reminders, announcements, calls, backups, media) don't start.
// Email needs MB_SMTP_* to send at all, so it stays in the local outbox.
export const isOffline = () => process.env.MB_OFFLINE === '1';

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function enableOffline() {
  const real = globalThis.fetch;
  if (real.offline) return real.restore;
  const guarded = (input, init) => {
    let host = '';
    try { host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname; } catch { /* not a URL */ }
    if (!LOCAL.has(host)) return Promise.reject(new Error(`Offline mode: not contacting ${host || 'that address'}.`));
    return real(input, init);
  };
  guarded.offline = true;
  guarded.restore = () => { globalThis.fetch = real; };
  globalThis.fetch = guarded;
  return guarded.restore;
}
