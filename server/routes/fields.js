// Custom profile fields: milestones (baptism, Holy Ghost…), classes, leadership track and anything
// else the church wants to track, grouped into sections on each person's profile.
import { Router } from 'express';
import { requireRole, canCampus, rank } from '../auth.js';
import { tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, oneOf, isDate, audit } from '../http.js';

export const FIELD_TYPES = ['text', 'longtext', 'date', 'yesno', 'choice', 'multi', 'number'];

const parse = (row) => ({ ...row, options: JSON.parse(row.options || '[]') });

// Fields this user may see (leaders see "leader" fields; staff and admins see everything).
export function visibleFields(db, user, { includeArchived = false } = {}) {
  const rows = db.prepare(`SELECT * FROM profile_fields ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort, id`).all().map(parse);
  return rows.filter((f) => rank(user.role) >= rank(f.visibility === 'staff' ? 'staff' : 'leader'));
}

// Turns raw input into the stored value for a field, or null to clear it. Throws on bad input.
export function cleanValue(field, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
  switch (field.type) {
    case 'date':
      if (!isDate(v)) throw bad(`${field.label} must be a date.`);
      return v;
    case 'yesno':
      return v === true || v === 'true' || v === 'yes' || v === 1 || v === '1';
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`${field.label} must be a number.`);
      return n;
    }
    case 'choice':
      if (!field.options.includes(v)) throw bad(`“${v}” isn’t an option for ${field.label}.`);
      return v;
    case 'multi': {
      const list = (Array.isArray(v) ? v : [v]).map(String);
      const badOne = list.find((x) => !field.options.includes(x));
      if (badOne) throw bad(`“${badOne}” isn’t an option for ${field.label}.`);
      return [...new Set(list)];
    }
    default:
      return str(v, field.type === 'longtext' ? 5000 : 500) || null;
  }
}

// Best-effort parse of spreadsheet text (for imports): dates, yes/no, choices by name.
export function valueFromText(field, text, parseDate) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const match = (s) => field.options.find((o) => o.toLowerCase() === s.trim().toLowerCase());
  switch (field.type) {
    case 'date': return parseDate(t);
    case 'yesno': return /^(y|yes|true|1|x|✓)$/i.test(t);
    case 'number': return Number.isFinite(Number(t)) ? Number(t) : null;
    case 'choice': return match(t) ?? null;
    case 'multi': {
      const list = t.split(/[,;|]/).map(match).filter(Boolean);
      return list.length ? [...new Set(list)] : null;
    }
    default: return t.slice(0, 5000);
  }
}

export function setValues(db, personId, fields, values) {
  const up = db.prepare(`INSERT INTO profile_values (person_id, field_id, value) VALUES (?, ?, ?)
    ON CONFLICT(person_id, field_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  const clear = db.prepare('DELETE FROM profile_values WHERE person_id = ? AND field_id = ?');
  for (const [fieldId, raw] of Object.entries(values)) {
    const field = fields.find((f) => f.id === Number(fieldId));
    if (!field) continue;
    const v = cleanValue(field, raw);
    if (v === null) clear.run(personId, field.id);
    else up.run(personId, field.id, JSON.stringify(v));
  }
}

export default function fieldRoutes(db) {
  const r = Router();
  const getField = (id) => {
    const f = db.prepare('SELECT * FROM profile_fields WHERE id = ?').get(id);
    if (!f) throw notFound('Field');
    return parse(f);
  };

  function cleanDef(b, partial) {
    const out = {};
    if (!partial || b.label !== undefined) out.label = required(b.label, 'Field name').slice(0, 80);
    if (!partial || b.section !== undefined) out.section = str(b.section, 60) || 'Other';
    if (!partial || b.type !== undefined) out.type = oneOf(b.type, FIELD_TYPES, 'text');
    if (b.options !== undefined) {
      if (!Array.isArray(b.options)) throw bad('Options must be a list.');
      out.options = JSON.stringify([...new Set(b.options.map((o) => str(o, 80)).filter(Boolean))]);
    }
    if (b.visibility !== undefined) out.visibility = oneOf(b.visibility, ['leader', 'staff'], 'leader');
    if (b.archived !== undefined) out.archived = b.archived ? 1 : 0;
    return out;
  }

  r.get('/profile-fields', requireRole('leader'), (req, res) => {
    res.json(visibleFields(db, req.user, { includeArchived: req.query.all === '1' && rank(req.user.role) >= rank('admin') }));
  });

  r.post('/profile-fields', requireRole('admin'), (req, res) => {
    const f = cleanDef(req.body || {}, false);
    if ((f.type === 'choice' || f.type === 'multi') && !JSON.parse(f.options || '[]').length) throw bad('Add at least one option.');
    f.options ??= '[]';
    f.sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM profile_fields').get().n;
    const keys = Object.keys(f);
    const info = db.prepare(`INSERT INTO profile_fields (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(f));
    audit(db, req, 'field.create', f.label);
    res.status(201).json(getField(info.lastInsertRowid));
  });

  r.patch('/profile-fields/:id', requireRole('admin'), (req, res) => {
    const old = getField(req.params.id);
    const f = cleanDef(req.body || {}, true);
    // Changing the type would make stored values meaningless.
    if (f.type && f.type !== old.type && db.prepare('SELECT 1 FROM profile_values WHERE field_id = ? LIMIT 1').get(old.id)) {
      throw bad('This field already has answers, so its type can’t change. Make a new field instead.');
    }
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE profile_fields SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), old.id);
    res.json(getField(old.id));
  });

  r.put('/profile-fields/order', requireRole('admin'), (req, res) => {
    const upd = db.prepare('UPDATE profile_fields SET sort = ? WHERE id = ?');
    tx(db, () => (req.body?.ids || []).forEach((id, i) => upd.run(i, int(id))));
    res.json({ ok: true });
  });

  function person(req, id) {
    const p = db.prepare('SELECT id, campus_id FROM people WHERE id = ?').get(id);
    if (!p) throw notFound('Person');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    return p;
  }

  r.get('/people/:id/profile', requireRole('leader'), (req, res) => {
    const p = person(req, req.params.id);
    const fields = visibleFields(db, req.user);
    const values = Object.fromEntries(db.prepare('SELECT field_id, value FROM profile_values WHERE person_id = ?').all(p.id)
      .filter((v) => fields.some((f) => f.id === v.field_id)).map((v) => [v.field_id, JSON.parse(v.value)]));
    res.json({ fields, values, can_edit: rank(req.user.role) >= rank('staff') });
  });

  // Body: { values: { [fieldId]: value } } – only the fields given change.
  r.put('/people/:id/profile', requireRole('staff'), (req, res) => {
    const p = person(req, req.params.id);
    tx(db, () => setValues(db, p.id, visibleFields(db, req.user), req.body?.values || {}));
    audit(db, req, 'person.profile', { id: p.id, fields: Object.keys(req.body?.values || {}) });
    res.json({ ok: true });
  });

  return r;
}
