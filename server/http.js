// Small helpers shared by the route files.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = 'That') => new HttpError(404, `${what} wasn’t found.`);
export const forbidden = () => new HttpError(403, 'You don’t have access to that.');

// Express 5 forwards rejected promises to the error handler, so handlers can just throw.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That’s too big to upload.' });
  // Errors that carry a client status (a missing upload is a 404, a bad range a 416) pass through quietly.
  const code = err?.status ?? err?.statusCode;
  if (Number.isInteger(code) && code >= 400 && code < 500) return res.status(code).json({ error: code === 404 ? 'That wasn’t found.' : 'That request couldn’t be handled.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

// '' / undefined / null → null; otherwise an integer (throws on junk).
export function int(v, field = 'value') {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${field} must be a whole number.`);
  return n;
}

export function str(v, max = 2000) {
  return v == null ? '' : String(v).trim().slice(0, max);
}

export function required(v, field) {
  const s = str(v);
  if (!s) throw bad(`${field} is required.`);
  return s;
}

export function oneOf(v, options, fallback) {
  return options.includes(v) ? v : fallback;
}

// Said to a signed-in person whose account isn’t tied to a person record yet.
export const NOT_LINKED = 'Your account isn’t connected to your record in the church directory yet. Please ask the office to link it.';

// Calendar-exact: 2026-02-30 is not a date, and 25:00 is not a time.
export function isDate(v) {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// HH:MM on a 24-hour clock (00:00 to 23:59).
export function isTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function isDateTime(v) {
  return typeof v === 'string' && /^.{10}T.{5}$/.test(v) && isDate(v.slice(0, 10)) && isTime(v.slice(11));
}

// A length in minutes: the fallback when left blank, otherwise a whole number above 0.
export function lengthMin(v, fallback) {
  const n = int(v, 'Length');
  if (n == null) return fallback;
  if (n <= 0) throw bad('Length needs to be more than 0 minutes.');
  return n;
}

export function audit(db, req, action, detail = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
    .run(req.user?.id ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// Date in a campus's own time zone, as YYYY-MM-DD and HH:MM.
export function localNow(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// The campus's own clock as { date, time, stamp } where stamp is YYYY-MM-DDTHH:MM, the same shape as
// services.starts_at (local time), so "has it started?" is a plain string comparison.
export function campusNow(db, campusId, at = new Date()) {
  const tz = db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(campusId)?.timezone || 'UTC';
  let n;
  try { n = localNow(tz, at); } catch { n = localNow('UTC', at); }
  return { ...n, stamp: `${n.date}T${n.time}` };
}
