// Basic forms: staff set up a simple form (volunteer interest, a request, a survey) in the hub;
// guests or signed-in people fill it in on their phone. One small model, not a form builder.
// Every response is staff-only. A response is tied to a person only from the signed-in account's
// own linked person, never from a typed name, email or phone.
import { ipBucket, ipWide } from '../ratelimit.js';
import { Router } from 'express';
import { requireRole, canCampus, campusFilter, rank } from '../auth.js';
import { getSetting } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str, required, oneOf, audit } from '../http.js';
import { notify } from '../notify.js';
import { toCsv } from '../csv.js';
import { cleanQuestions, cleanAnswers, answerText, answerOf, FORM_TYPES } from '../questions.js';

const MAX_QUESTIONS = 30;
const AUDIENCES = ['public', 'signed_in'];
const MODES = ['off', 'optional', 'required'];
const CONTACT = ['name', 'email', 'phone'];
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export { ipBucket } from '../ratelimit.js'; // kept for existing imports

// Small in-memory limiter, one per app so a test (or a restart) starts clean. Addresses are
// swept when stale and capped (oldest dropped first); per-form counters live in their own map
// that is never wiped, so a flood of addresses can't reset a form's hourly limit.
const IP_WINDOW = 10 * 60e3;
const IP_CAP = 5000;
function limiter() {
  const ips = new Map(); // bucket -> { tries: [t], wins: [t] }
  const forms = new Map(); // form id -> [t]
  let swept = 0;
  const recent = (list, now, windowMs) => list.filter((t) => now - t < windowMs);
  const sweep = (now) => {
    if (ips.size <= IP_CAP && now - swept < 60e3) return;
    swept = now;
    for (const [k, v] of ips) if (!recent(v.tries, now, IP_WINDOW).length) ips.delete(k);
    // Still flooded: the oldest go first, down to 90% so the next requests don't sweep again.
    for (const k of ips.keys()) { if (ips.size <= IP_CAP * 0.9) break; ips.delete(k); }
  };
  return {
    // Counts an attempt (even one that fails validation); false when this address is over its tries.
    attempt(ip, max) {
      const now = Date.now();
      sweep(now);
      const e = ips.get(ip) || { tries: [], wins: [] };
      e.tries = recent(e.tries, now, IP_WINDOW);
      e.wins = recent(e.wins, now, IP_WINDOW);
      if (e.tries.length >= max) return false;
      e.tries.push(now);
      ips.set(ip, e);
      return true;
    },
    canWin: (ip, max) => (recent(ips.get(ip)?.wins || [], Date.now(), IP_WINDOW).length < max),
    win(ip) { ips.get(ip)?.wins.push(Date.now()); },
    formFull(id, max) { const now = Date.now(); const l = recent(forms.get(id) || [], now, 3600e3); forms.set(id, l); return l.length >= max; },
    formWin(id) { forms.get(id).push(Date.now()); },
  };
}

const slugify = (t) => t.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');

export default function formRoutes(db) {
  const r = Router();
  const limits = limiter();

  const parse = (f) => ({ ...f, active: Boolean(f.active), questions: JSON.parse(f.questions || '[]'), ask_contact: JSON.parse(f.ask_contact || '{}') });

  // Church-wide forms (no campus) are managed, and their responses read, only by staff with no
  // campus limit; a campus form by staff who can access that campus.
  const manages = (user, f) => (f.campus_id == null ? !user.campusIds : canCampus(user, f.campus_id));
  const getForm = (req, id) => {
    const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(int(id));
    if (!f || !canCampus(req.user, f.campus_id)) throw notFound('Form');
    return f;
  };
  const getManaged = (req, id) => {
    const f = getForm(req, id);
    if (!manages(req.user, f)) throw forbidden();
    return f;
  };

  // ---------------------------------------------------------------- the hub
  r.get('/admin/forms', requireRole('staff'), (req, res) => {
    const cf = campusFilter(req.user, 'f.campus_id');
    const rows = db.prepare(`SELECT f.*, c.short_name campus_short, c.name campus_name,
        (SELECT COUNT(*) FROM form_responses x WHERE x.form_id = f.id) total,
        (SELECT COUNT(*) FROM form_responses x WHERE x.form_id = f.id AND x.status = 'new') new_count
      FROM forms f LEFT JOIN campuses c ON c.id = f.campus_id WHERE ${cf.sql} ORDER BY f.active DESC, f.title LIMIT 200`).all(...cf.args);
    // Counts only where the account may read the responses.
    res.json(rows.map((f) => {
      const can = manages(req.user, f);
      return { ...parse(f), can_manage: can, total: can ? f.total : null, new_count: can ? f.new_count : null };
    }));
  });

  // Who can be told about new responses: active staff or admins who can read them (campus_id of
  // the form, none = church-wide: only staff with no campus limit).
  const canBeTold = (u, campusId) => {
    if (!u || !u.active || rank(u.role) < rank('staff')) return false;
    const ids = u.campus_ids ? JSON.parse(u.campus_ids) : null;
    return campusId == null ? !ids : !ids || ids.includes(campusId);
  };

  // Names only, and only people who could be chosen for the campus asked about.
  r.get('/admin/forms/notify-options', requireRole('staff'), (req, res) => {
    const campusId = req.query.campus_id ? int(req.query.campus_id, 'Campus') : null;
    if (campusId != null && !canCampus(req.user, campusId)) return res.json([]);
    if (campusId == null && req.user.campusIds) return res.json([]); // limited staff can't manage church-wide forms
    res.json(db.prepare(`SELECT u.id, u.active, u.role, u.campus_ids, COALESCE(NULLIF(TRIM(COALESCE(p.nickname, p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), u.email) name
      FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE u.active = 1 AND u.role IN ('staff', 'admin') ORDER BY name`).all()
      .filter((u) => canBeTold(u, campusId)).slice(0, 200).map(({ id, name }) => ({ id, name })));
  });

  r.get('/admin/forms/:id', requireRole('staff'), (req, res) => {
    const f = getForm(req, req.params.id);
    res.json({ ...parse(f), can_manage: manages(req.user, f) });
  });

  function notifyUser(id, campusId) {
    if (id == null) return null;
    const u = db.prepare('SELECT id, role, active, campus_ids FROM users WHERE id = ? AND active = 1').get(id);
    if (!u || rank(u.role) < rank('staff')) throw bad('Choose someone on staff to be told about new responses.');
    if (!canBeTold(u, campusId)) throw bad('That person can’t see this form’s responses, so they can’t be told about them.');
    return u.id;
  }

  function clean(req, b, old = {}) {
    const f = {};
    f.title = required(b.title ?? old.title, 'Title').slice(0, 140);
    f.intro = str(b.intro ?? old.intro, 2000);
    f.campus_id = b.campus_id !== undefined ? int(b.campus_id) : old.campus_id ?? null;
    if (f.campus_id && !db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(f.campus_id)) throw bad('Unknown campus.');
    if (!manages(req.user, { campus_id: f.campus_id })) throw forbidden();
    f.audience = oneOf(b.audience ?? old.audience, AUDIENCES, 'public');
    const given = b.ask_contact ?? (old.ask_contact ? JSON.parse(old.ask_contact) : { name: 'required', email: 'optional', phone: 'off' });
    f.ask_contact = JSON.stringify(Object.fromEntries(CONTACT.map((k) => [k, oneOf(given?.[k], MODES, 'off')])));
    f.questions = JSON.stringify(cleanQuestions(b.questions ?? (old.questions ? JSON.parse(old.questions) : []), FORM_TYPES, MAX_QUESTIONS));
    f.active = (b.active ?? old.active ?? 1) ? 1 : 0; // new forms start on
    f.notify_user_id = notifyUser(b.notify_user_id !== undefined ? int(b.notify_user_id) : old.notify_user_id ?? null, f.campus_id);
    return f;
  }

  function newSlug(title, wanted) {
    const taken = (s) => db.prepare('SELECT 1 FROM forms WHERE slug = ?').get(s);
    if (wanted) {
      const s = str(wanted, 60).toLowerCase();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length < 3) throw bad('The link can use letters, numbers and dashes, at least 3 characters.');
      if (taken(s)) throw new HttpError(409, 'That link is already used by another form.');
      return s;
    }
    const base = slugify(title).length >= 3 ? slugify(title) : 'form';
    for (let i = 1; ; i++) {
      const s = i === 1 ? base : `${base}-${i}`;
      if (!taken(s)) return s;
    }
  }

  r.post('/admin/forms', requireRole('staff'), (req, res) => {
    const b = req.body || {};
    const f = clean(req, b);
    const slug = newSlug(f.title, b.slug);
    const keys = Object.keys(f);
    const id = db.prepare(`INSERT INTO forms (slug, ${keys.join(', ')}, created_by) VALUES (?, ${keys.map(() => '?').join(', ')}, ?)`).run(slug, ...Object.values(f), req.user.id).lastInsertRowid;
    audit(db, req, 'form.create', `${f.title} (${slug})`);
    res.status(201).json(parse(db.prepare('SELECT * FROM forms WHERE id = ?').get(id)));
  });

  // The link (slug) never changes, so a form that's been shared keeps working. Turning "active"
  // off archives it: the link stops working and the responses stay.
  r.patch('/admin/forms/:id', requireRole('staff'), (req, res) => {
    const old = getManaged(req, req.params.id);
    const f = clean(req, req.body || {}, old);
    db.prepare(`UPDATE forms SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(f), old.id);
    audit(db, req, old.active && !f.active ? 'form.archive' : 'form.edit', `${f.title} (${old.slug})`);
    res.json(parse(db.prepare('SELECT * FROM forms WHERE id = ?').get(old.id)));
  });

  const responseRows = (formId) => db.prepare(`SELECT x.*, p.first_name person_first, p.last_name person_last,
      (SELECT COALESCE(p2.nickname, p2.first_name) FROM users u JOIN people p2 ON p2.id = u.person_id WHERE u.id = x.done_by) done_by_name
    FROM form_responses x LEFT JOIN people p ON p.id = x.person_id WHERE x.form_id = ? ORDER BY x.created_at DESC, x.id DESC LIMIT 1000`).all(formId)
    .map((x) => ({ ...x, answers: JSON.parse(x.answers || '{}') }));

  r.get('/admin/forms/:id/responses', requireRole('staff'), (req, res) => {
    const f = getManaged(req, req.params.id);
    res.json({ form: parse(f), rows: responseRows(f.id) });
  });

  r.get('/admin/forms/:id/responses.csv', requireRole('staff'), (req, res) => {
    const f = parse(getManaged(req, req.params.id));
    const header = ['Name', 'Email', 'Phone', 'Signed-in person', ...f.questions.map((q) => q.label), 'Status', 'Received'];
    const rows = responseRows(f.id).map((x) => [x.name, x.email, x.phone, x.person_first ? `${x.person_first} ${x.person_last}` : '',
      ...f.questions.map((q) => answerText(answerOf(x.answers, q.id))), x.status === 'done' ? 'Done' : 'New', x.created_at]);
    audit(db, req, 'form.export', `${f.title} (${rows.length} responses)`); // never the answers
    res.setHeader('Content-Disposition', `attachment; filename="${f.slug}-responses.csv"`);
    res.type('text/csv').send(toCsv([header, ...rows]));
  });

  const getResponse = (req, id) => {
    const x = db.prepare('SELECT * FROM form_responses WHERE id = ?').get(int(id));
    if (!x) throw notFound('Response');
    return { x, f: getManaged(req, x.form_id) };
  };

  // Body: { done: bool }
  r.patch('/admin/form-responses/:id', requireRole('staff'), (req, res) => {
    const { x } = getResponse(req, req.params.id);
    const done = Boolean(req.body?.done);
    db.prepare(`UPDATE form_responses SET status = ?, done_by = ?, done_at = ${done ? "datetime('now')" : 'NULL'} WHERE id = ?`).run(done ? 'done' : 'new', done ? req.user.id : null, x.id);
    res.json({ ok: true });
  });

  r.delete('/admin/form-responses/:id', requireRole('admin'), (req, res) => {
    const { x, f } = getResponse(req, req.params.id);
    db.prepare('DELETE FROM form_responses WHERE id = ?').run(x.id);
    audit(db, req, 'form.response_delete', `${f.title} (response ${x.id})`);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- filling a form in
  // Signed-in forms, for the member app's More tab (titles only).
  r.get('/forms', requireRole('volunteer'), (req, res) => {
    const cf = campusFilter(req.user, 'campus_id');
    res.json(db.prepare(`SELECT slug, title, intro FROM forms WHERE active = 1 AND audience = 'signed_in' AND ${cf.sql} ORDER BY title LIMIT 50`).all(...cf.args));
  });

  const findActive = (slug) => {
    const f = db.prepare('SELECT * FROM forms WHERE slug = ? AND active = 1').get(str(slug, 80).toLowerCase());
    if (!f) throw notFound('Form');
    return parse(f);
  };

  // Only what a person filling it in should see: no campus, owner or notification details.
  r.get('/public/forms/:slug', (req, res) => {
    const f = findActive(req.params.slug);
    const base = { slug: f.slug, title: f.title, church_name: getSetting(db, 'church_name', 'Church'), audience: f.audience };
    if (f.audience === 'signed_in' && !req.user) return res.json({ ...base, needs_sign_in: true });
    if (f.audience === 'signed_in' && !canCampus(req.user, f.campus_id)) throw notFound('Form'); // same as the More tab
    res.json({ ...base, intro: f.intro, ask_contact: f.ask_contact, questions: f.questions.map(({ id, label, type, options, required: req }) => ({ id, label, type, options, required: req })) });
  });

  // Body: { name, email, phone, answers: { [question id]: value }, website (hidden: bots only) }
  r.post('/public/forms/:slug', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // a hidden field only bots fill in
    const ip = ipBucket(req.ip);
    const wide = ipWide(req.ip); // IPv6 /48: four times the per-address limits
    if (!limits.attempt(ip, 30) || (wide && !limits.attempt(wide, 120))) throw new HttpError(429, 'Too many tries. Please wait a few minutes.');
    const f = findActive(req.params.slug);
    if (limits.formFull(f.id, 200)) throw new HttpError(429, 'This form is getting a lot of responses. Please try again a little later.');
    if (f.audience === 'signed_in' && !req.user) throw new HttpError(401, 'Please sign in to fill this in.');
    if (f.audience === 'signed_in' && !canCampus(req.user, f.campus_id)) throw notFound('Form');
    if (!limits.canWin(ip, 10) || (wide && !limits.canWin(wide, 40))) throw new HttpError(429, 'Too many tries. Please wait a few minutes.');
    const who = { name: str(b.name, 120), email: str(b.email, 200).toLowerCase(), phone: str(b.phone, 40) };
    for (const k of CONTACT) {
      if (f.ask_contact[k] !== 'required' || who[k]) continue;
      throw bad(k === 'name' ? 'Please enter your name.' : k === 'email' ? 'Please enter your email.' : 'Please enter your phone number.');
    }
    if (who.email && !emailOk(who.email)) throw bad('That email doesn’t look right.');
    // Fields the form doesn't ask for are ignored.
    for (const k of CONTACT) if (f.ask_contact[k] === 'off') who[k] = '';
    const answers = cleanAnswers(f.questions, b.answers && typeof b.answers === 'object' ? b.answers : {});
    db.prepare('INSERT INTO form_responses (form_id, user_id, person_id, name, email, phone, answers) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(f.id, req.user?.id ?? null, req.user?.personId ?? null, who.name, who.email, who.phone, JSON.stringify(answers));
    limits.win(ip);
    if (wide) limits.win(wide);
    limits.formWin(f.id);
    // Checked now, not just when the form was saved: the person may have been demoted since. At most
    // one notice per form per person every 15 minutes, so a busy form doesn't flood their inbox.
    const url = `/#/forms/${f.id}/responses`;
    const target = f.notify_user_id && db.prepare('SELECT id, role, active, campus_ids FROM users WHERE id = ?').get(f.notify_user_id);
    if (canBeTold(target, f.campus_id)
      && !db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'form' AND url = ? AND created_at > datetime('now', '-15 minutes')").get(target.id, url)) {
      notify(db, [target.id], {
        kind: 'form',
        title: `New response: ${f.title}`,
        body: 'Open Forms in the Hub to read it.', // answers can be personal: never on a lock screen
        url,
      });
    }
    res.status(201).json({ ok: true });
  });

  return r;
}
