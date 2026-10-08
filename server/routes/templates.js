// Service templates: reusable orders of service ("Sunday Morning", "Baptism Sunday") with
// "fill in" slots for what changes each week, and the positions the service needs. Staff and
// admins manage them; anyone who can edit a plan can apply one.
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { tx, updateFields } from '../db.js';
import { bad, notFound, forbidden, int, str, required, oneOf, audit } from '../http.js';

const ITEM_COLS = ['kind', 'category', 'title', 'song_id', 'song_key', 'length_sec', 'person_id', 'info', 'notes', 'is_start', 'placeholder'];

// Copies a template's rows onto a service (after its existing rows, or replacing them), and its
// positions too when asked. Used by "Apply template" and by repeating services.
export function applyTemplate(db, templateId, serviceId, { replace = false, needs = false } = {}) {
  if (replace) db.prepare('DELETE FROM plan_items WHERE service_id = ?').run(serviceId);
  const base = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM plan_items WHERE service_id = ?').get(serviceId).n;
  if (db.prepare('SELECT 1 FROM template_items WHERE template_id = ? AND is_start = 1').get(templateId)) {
    db.prepare('UPDATE plan_items SET is_start = 0 WHERE service_id = ?').run(serviceId);
  }
  db.prepare(`INSERT INTO plan_items (service_id, sort, ${ITEM_COLS.join(', ')})
    SELECT ?, sort + ?, ${ITEM_COLS.join(', ')} FROM template_items WHERE template_id = ? ORDER BY sort, id`).run(serviceId, base, templateId);
  if (needs) {
    const list = db.prepare('SELECT position_id, count FROM template_needs WHERE template_id = ?').all(templateId);
    if (list.length) {
      db.prepare('DELETE FROM service_needs WHERE service_id = ?').run(serviceId);
      const ins = db.prepare('INSERT INTO service_needs (service_id, position_id, count) VALUES (?, ?, ?)');
      for (const n of list) ins.run(serviceId, n.position_id, n.count);
    }
  }
}

export default function templateRoutes(db) {
  const r = Router();
  const isStaff = (req) => rank(req.user.role) >= rank('staff');

  function template(req, id) {
    const t = db.prepare('SELECT * FROM service_templates WHERE id = ?').get(id);
    if (!t) throw notFound('Template');
    if (!canCampus(req.user, t.campus_id)) throw forbidden();
    return t;
  }
  const items = (id) => db.prepare(`SELECT i.*, so.title song_title, so.author song_author, p.first_name, p.last_name, p.nickname
    FROM template_items i LEFT JOIN songs so ON so.id = i.song_id LEFT JOIN people p ON p.id = i.person_id
    WHERE i.template_id = ? ORDER BY i.sort, i.id`).all(id);

  function itemFields(b) {
    const out = {};
    if (b.kind !== undefined) out.kind = oneOf(b.kind, ['header', 'song', 'item'], 'item');
    for (const k of ['title', 'song_key', 'notes', 'info']) if (b[k] !== undefined) out[k] = str(b[k]);
    if (b.category !== undefined) out.category = str(b.category, 40);
    if (b.song_id !== undefined) out.song_id = int(b.song_id);
    if (b.person_id !== undefined) out.person_id = int(b.person_id);
    if (b.length_sec !== undefined) out.length_sec = Math.max(0, int(b.length_sec) ?? 0);
    if (b.is_start !== undefined) out.is_start = b.is_start ? 1 : 0;
    if (b.placeholder !== undefined) out.placeholder = b.placeholder ? 1 : 0;
    return out;
  }

  r.get('/templates', requireRole('leader'), (req, res) => {
    const cf = campusFilter(req.user, 't.campus_id');
    res.json(db.prepare(`SELECT t.*, c.short_name campus_short, c.name campus_name,
        (SELECT COUNT(*) FROM template_items i WHERE i.template_id = t.id) item_count,
        (SELECT COUNT(*) FROM template_items i WHERE i.template_id = t.id AND i.placeholder = 1) fill_count,
        (SELECT COALESCE(SUM(count), 0) FROM template_needs n WHERE n.template_id = t.id) needs_count,
        (SELECT COUNT(*) FROM service_types st WHERE st.template_id = t.id AND st.archived = 0) series_count
      FROM service_templates t LEFT JOIN campuses c ON c.id = t.campus_id
      WHERE t.archived = 0 AND ${cf.sql} ORDER BY t.name COLLATE NOCASE`).all(...cf.args));
  });

  r.get('/templates/:id', requireRole('leader'), (req, res) => {
    const t = template(req, req.params.id);
    res.json({
      ...t,
      items: items(t.id),
      needs: db.prepare('SELECT position_id, count FROM template_needs WHERE template_id = ?').all(t.id),
      series: db.prepare('SELECT id, name, default_title FROM service_types WHERE template_id = ? AND archived = 0').all(t.id),
      can_edit: isStaff(req),
    });
  });

  // Body: { name, campus_id?, description?, from_service_id? } – from_service_id copies a real service.
  r.post('/templates', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const campusId = int(b.campus_id);
    if (!canCampus(req.user, campusId) || (campusId == null && req.user.campusIds)) throw forbidden();
    const id = tx(db, () => {
      const info = db.prepare('INSERT INTO service_templates (name, campus_id, description) VALUES (?, ?, ?)')
        .run(required(b.name, 'Template name').slice(0, 120), campusId, str(b.description, 500));
      const tid = Number(info.lastInsertRowid);
      if (b.from_service_id) {
        const s = db.prepare('SELECT * FROM services WHERE id = ?').get(int(b.from_service_id));
        if (!s || !canCampus(req.user, s.campus_id)) throw notFound('Service');
        db.prepare('UPDATE service_templates SET start_time = ? WHERE id = ?').run(s.starts_at.slice(11, 16), tid);
        db.prepare(`INSERT INTO template_items (template_id, sort, ${ITEM_COLS.join(', ')})
          SELECT ?, sort, ${ITEM_COLS.join(', ')} FROM plan_items WHERE service_id = ? ORDER BY sort, id`).run(tid, s.id);
        db.prepare('INSERT INTO template_needs (template_id, position_id, count) SELECT ?, position_id, count FROM service_needs WHERE service_id = ?').run(tid, s.id);
      }
      return tid;
    });
    audit(db, req, 'template.create', b.name);
    res.status(201).json(db.prepare('SELECT * FROM service_templates WHERE id = ?').get(id));
  });

  r.patch('/templates/:id', requireRole('staff'), (req, res) => {
    const t = template(req, req.params.id);
    const b = { ...req.body };
    if (b.name !== undefined) b.name = required(b.name, 'Template name');
    if (b.campus_id !== undefined) {
      b.campus_id = int(b.campus_id);
      if (!canCampus(req.user, b.campus_id)) throw forbidden();
    }
    if (b.start_time !== undefined && !/^\d{2}:\d{2}$/.test(b.start_time)) throw bad('Times look like 09:30.');
    updateFields(db, 'service_templates', t.id, b, ['name', 'campus_id', 'description', 'start_time', 'archived']);
    if (b.archived) db.prepare('UPDATE service_types SET template_id = NULL WHERE template_id = ?').run(t.id);
    res.json(db.prepare('SELECT * FROM service_templates WHERE id = ?').get(t.id));
  });

  r.put('/templates/:id/needs', requireRole('staff'), (req, res) => {
    const t = template(req, req.params.id);
    tx(db, () => {
      db.prepare('DELETE FROM template_needs WHERE template_id = ?').run(t.id);
      const ins = db.prepare('INSERT INTO template_needs (template_id, position_id, count) VALUES (?, ?, ?)');
      for (const n of req.body?.needs || []) {
        const count = Math.min(int(n.count) ?? 1, 50);
        if (count > 0) ins.run(t.id, int(n.position_id, 'Position'), count);
      }
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- template rows
  const onlyStart = (tid, itemId) => db.prepare('UPDATE template_items SET is_start = 0 WHERE template_id = ? AND id != ?').run(tid, itemId);

  r.post('/templates/:id/items', requireRole('staff'), (req, res) => {
    const t = template(req, req.params.id);
    const f = itemFields(req.body || {});
    if (f.song_id && !f.title) f.title = db.prepare('SELECT title FROM songs WHERE id = ?').get(f.song_id)?.title ?? '';
    if (f.kind === 'song' && !f.song_id && !f.title) { f.title = 'Song'; f.placeholder = 1; }
    f.sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM template_items WHERE template_id = ?').get(t.id).n;
    const keys = Object.keys(f);
    const id = db.prepare(`INSERT INTO template_items (template_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(t.id, ...Object.values(f)).lastInsertRowid;
    if (f.is_start) onlyStart(t.id, id);
    res.status(201).json(items(t.id));
  });

  r.patch('/template-items/:id', requireRole('staff'), (req, res) => {
    const item = db.prepare('SELECT * FROM template_items WHERE id = ?').get(req.params.id);
    if (!item) throw notFound('Item');
    template(req, item.template_id);
    const f = itemFields(req.body || {});
    updateFields(db, 'template_items', item.id, f, Object.keys(f));
    if (f.is_start) onlyStart(item.template_id, item.id);
    res.json(items(item.template_id));
  });

  r.delete('/template-items/:id', requireRole('staff'), (req, res) => {
    const item = db.prepare('SELECT * FROM template_items WHERE id = ?').get(req.params.id);
    if (!item) throw notFound('Item');
    template(req, item.template_id);
    db.prepare('DELETE FROM template_items WHERE id = ?').run(item.id);
    res.json(items(item.template_id));
  });

  r.put('/templates/:id/items/order', requireRole('staff'), (req, res) => {
    const t = template(req, req.params.id);
    const upd = db.prepare('UPDATE template_items SET sort = ? WHERE id = ? AND template_id = ?');
    tx(db, () => (req.body?.ids || []).forEach((id, i) => upd.run(i, int(id), t.id)));
    res.json(items(t.id));
  });

  return r;
}
