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

export function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function isDateTime(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
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
