// Feedback from staff and leaders: bugs, frustrations, missing pieces and ideas. Admins triage each
// one with a status and, when it's done (or decided against), write what happened. Those notes are
// the "You said, we did" record everyone can read. Deliberately small: not a project tracker.
import { Router } from 'express';
import { requireRole, rank, canCampus, campusFilter } from '../auth.js';
import { bad, notFound, int, str, required, oneOf, audit } from '../http.js';
import { notify } from '../notify.js';

export const CATEGORIES = ['bug', 'frustration', 'missing', 'workflow', 'request', 'idea'];
export const SEVERITIES = ['blocks_sunday', 'slows_me_down', 'nice_to_have'];
export const STATUSES = ['received', 'looking', 'planned', 'done', 'not_now'];
const LABEL = { bug: 'Bug', frustration: 'Frustration', missing: 'Missing', workflow: 'Workflow', request: 'Request', idea: 'Ministry idea' };

const sent = new Map();
function allowed(userId) {
  const now = Date.now();
  const hits = (sent.get(userId) || []).filter((t) => now - t < 60 * 60e3);
  if (hits.length >= 10) return false;
  hits.push(now);
  sent.set(userId, hits);
  if (sent.size > 5000) sent.clear();
  return true;
}

export default function feedbackRoutes(db) {
  const r = Router();
  const isAdmin = (req) => rank(req.user.role) >= rank('admin');

  r.post('/feedback', requireRole('volunteer'), (req, res) => {
    const b = req.body || {};
    const body = required(b.body, 'What happened or what you’d like').slice(0, 2000);
    const category = oneOf(b.category, CATEGORIES, 'idea');
    const severity = oneOf(b.severity, SEVERITIES, 'nice_to_have');
    if (!allowed(req.user.id)) throw bad('Thanks! You’ve sent a lot of feedback this hour. Please try again a little later.');
    // Only a campus the sender belongs to (it decides which campus-limited admins see it).
    const campusId = int(b.campus_id) != null && canCampus(req.user, int(b.campus_id)) ? int(b.campus_id) : null;
    const info = db.prepare('INSERT INTO feedback (user_id, role, campus_id, page, category, severity, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, req.user.role, campusId && db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId) ? campusId : null,
        str(b.page, 200), category, severity, body);
    const admins = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin'").all().map((u) => u.id);
    notify(db, admins, {
      kind: 'feedback',
      title: `${severity === 'blocks_sunday' ? 'Blocks Sunday: ' : ''}${LABEL[category]} from ${req.user.name}`,
      body: 'Open Feedback in the Hub to read it.', // the text itself may be personal: never on a lock screen
      url: '/#/feedback',
    });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // Admins see everything (optionally one status); everyone else sees only what they sent.
  r.get('/feedback', requireRole('volunteer'), (req, res) => {
    const where = [];
    const args = [];
    if (!isAdmin(req)) { where.push('f.user_id = ?'); args.push(req.user.id); } else {
      // A campus-limited admin sees feedback from their campuses (and feedback with no campus).
      const cf = campusFilter(req.user, 'f.campus_id');
      where.push(cf.sql); args.push(...cf.args);
    }
    if (STATUSES.includes(req.query.status)) { where.push('f.status = ?'); args.push(req.query.status); }
    const rows = db.prepare(`SELECT f.*, u.email sender_email, COALESCE(p.nickname, p.first_name) sender_first, p.last_name sender_last
      FROM feedback f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN people p ON p.id = u.person_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.status IN ('done', 'not_now'), f.severity = 'blocks_sunday' DESC, f.created_at DESC LIMIT 300`).all(...args);
    res.json(rows.map((f) => (isAdmin(req) ? f : { ...f, admin_note: undefined, sender_email: undefined })));
  });

  // "You said, we did": what was done, in admins' words, for everyone. No names, no original text.
  r.get('/feedback/done', requireRole('volunteer'), (_req, res) => {
    res.json(db.prepare(`SELECT id, category, status, done_note, done_at FROM feedback
      WHERE status IN ('done', 'not_now') AND done_note != '' ORDER BY done_at DESC LIMIT 100`).all());
  });

  r.patch('/feedback/:id', requireRole('admin'), (req, res) => {
    const f = db.prepare('SELECT * FROM feedback WHERE id = ?').get(int(req.params.id));
    if (!f) throw notFound('Feedback');
    const b = req.body || {};
    const status = b.status === undefined ? f.status : oneOf(b.status, STATUSES, f.status);
    const closing = ['done', 'not_now'].includes(status);
    db.prepare(`UPDATE feedback SET status = ?, admin_note = ?, done_note = ?, done_at = ?, updated_at = datetime('now') WHERE id = ?`).run(
      status,
      b.admin_note === undefined ? f.admin_note : str(b.admin_note, 2000),
      b.done_note === undefined ? f.done_note : str(b.done_note, 1000),
      closing ? (f.done_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : null,
      f.id);
    audit(db, req, 'feedback.update', { id: f.id, status });
    res.json(db.prepare('SELECT * FROM feedback WHERE id = ?').get(f.id));
  });

  return r;
}
