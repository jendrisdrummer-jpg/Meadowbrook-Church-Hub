// The member app (app.<church domain>): what's on it, set in the dashboard's App Builder, and
// what guests can do without signing in (see service times, fill in a connect card).
import { Router } from 'express';
import { requireRole, canCampus, campusFilter } from '../auth.js';
import { getSetting, setSetting } from '../db.js';
import { bad, notFound, forbidden, int, str, required, audit } from '../http.js';
import { notify, notifyDeclined, assignmentSig } from '../notify.js';
import crypto from 'node:crypto';

// Ready-made tab types. "more" (account, notifications, settings) is always last.
export const TAB_TYPES = ['home', 'serve', 'watch', 'give', 'connect', 'page', 'link', 'more'];
export const BLOCK_TYPES = ['welcome', 'times', 'serving', 'buttons', 'watch', 'text'];
const ICONS = ['home', 'calendar', 'user', 'play', 'heart', 'hand', 'info', 'link', 'menu', 'music', 'people', 'gift', 'book', 'chat', 'check'];

export const DEFAULT_APP = {
  tabs: [
    { id: 'home', type: 'home', label: 'Home', icon: 'home', on: true },
    { id: 'serve', type: 'serve', label: 'Serve', icon: 'calendar', on: true },
    { id: 'watch', type: 'watch', label: 'Watch', icon: 'play', on: true },
    { id: 'give', type: 'give', label: 'Give', icon: 'heart', on: true },
    { id: 'connect', type: 'connect', label: 'Connect', icon: 'hand', on: false },
    { id: 'more', type: 'more', label: 'More', icon: 'menu', on: true },
  ],
  home: [
    { id: 'welcome', type: 'welcome', title: 'Welcome home', text: 'We’re so glad you’re here.' },
    { id: 'serving', type: 'serving' },
    { id: 'buttons', type: 'buttons', items: [
      { label: 'I’m new here', tab: 'connect' },
      { label: 'Watch live', tab: 'watch' },
      { label: 'Give', tab: 'give' },
    ] },
    { id: 'times', type: 'times', title: 'Service times' },
  ],
  watch_url: '',
  give_url: '',
  connect: {
    title: 'We’d love to meet you',
    intro: 'Let us know you were here, and how we can help.',
    interests: ['Learning more about the church', 'Baptism', 'Joining a small group', 'Serving on a team', 'Talking with a pastor'],
  },
};

const id = (v, i) => (str(v, 40).replace(/[^\w-]/g, '') || `x${i}`);
const url = (v) => {
  const s = str(v, 500);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw bad('Links start with https://');
  return s;
};

// Validates an App Builder save; unknown fields are dropped.
function cleanConfig(b) {
  if (!b || !Array.isArray(b.tabs) || !Array.isArray(b.home)) throw bad('Missing tabs or home screen.');
  const tabs = b.tabs.slice(0, 12).map((t, i) => {
    const type = TAB_TYPES.includes(t.type) ? t.type : null;
    if (!type) throw bad('Unknown tab type.');
    const tab = { id: id(t.id, i), type, label: required(t.label, 'Tab name').slice(0, 20), icon: ICONS.includes(t.icon) ? t.icon : 'info', on: t.on !== false };
    if (type === 'link') tab.url = url(t.url);
    if (type === 'page') { tab.title = str(t.title, 120); tab.body = str(t.body, 8000); }
    return tab;
  }).filter((t) => t.type !== 'more');
  tabs.push({ ...(b.tabs.find((t) => t.type === 'more') || DEFAULT_APP.tabs.at(-1)), id: 'more', type: 'more', on: true, label: str(b.tabs.find((t) => t.type === 'more')?.label, 20) || 'More', icon: 'menu' });
  if (tabs.filter((t) => t.on).length > 5) throw bad('Up to 5 tabs fit along the bottom of a phone (including More). Turn one off.');
  if (new Set(tabs.map((t) => t.id)).size !== tabs.length) throw bad('Two tabs have the same id.');
  const home = b.home.slice(0, 20).map((k, i) => {
    if (!BLOCK_TYPES.includes(k.type)) throw bad('Unknown home screen block.');
    const block = { id: id(k.id, i), type: k.type };
    if (['welcome', 'text', 'times', 'watch'].includes(k.type)) block.title = str(k.title, 120);
    if (['welcome', 'text'].includes(k.type)) block.text = str(k.text, 4000);
    if (k.type === 'buttons') {
      block.items = (Array.isArray(k.items) ? k.items : []).slice(0, 6).map((x) => ({ label: required(x.label, 'Button text').slice(0, 30), ...(x.url ? { url: url(x.url) } : { tab: id(x.tab, 0) }) }));
    }
    return block;
  });
  const c = b.connect || {};
  return {
    tabs,
    home,
    watch_url: url(b.watch_url),
    give_url: url(b.give_url),
    connect: {
      title: str(c.title, 120) || DEFAULT_APP.connect.title,
      intro: str(c.intro, 1000),
      interests: (Array.isArray(c.interests) ? c.interests : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 12),
    },
  };
}

export const appConfig = (db) => ({ ...DEFAULT_APP, ...getSetting(db, 'app_config', {}) });

// A tiny per-address limit so the public form can't be used to flood the inbox.
const recent = new Map();
function rateLimit(key, max = 5, windowMs = 10 * 60e3) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return true;
}

export default function appRoutes(db) {
  const r = Router();

  // Everything the app needs to draw itself. Public: guests use the app without signing in.
  r.get('/app/config', (req, res) => {
    const times = db.prepare(`SELECT t.day_of_week, t.start_time, t.default_title, t.name, c.id campus_id, c.name campus_name, c.short_name campus_short, c.address
      FROM service_types t JOIN campuses c ON c.id = t.campus_id
      WHERE t.archived = 0 AND c.active = 1 AND t.day_of_week IS NOT NULL AND (t.ends_on IS NULL OR t.ends_on >= date('now'))
      ORDER BY c.sort, t.day_of_week, t.start_time`).all();
    res.json({
      church_name: getSetting(db, 'church_name', 'Church'),
      brand_color: getSetting(db, 'brand_color', '#135fd1'),
      campuses: db.prepare('SELECT id, name, short_name, address FROM campuses WHERE active = 1 ORDER BY sort, name').all(),
      times,
      config: appConfig(db),
      hub_url: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
      user: req.user ? { name: req.user.name, role: req.user.role, linked: Boolean(req.user.personId), person_id: req.user.personId ?? null, photo: req.user.photo, theme: req.user.theme } : null,
    });
  });

  r.put('/app/config', requireRole('staff'), (req, res) => {
    const config = cleanConfig(req.body);
    setSetting(db, 'app_config', config);
    audit(db, req, 'app.config');
    res.json(config);
  });

  // ---------------------------------------------------------------- email reply links
  // Accept or decline from the link in a "you're scheduled" email, without signing in.
  const signed = (req) => {
    const a = db.prepare(`SELECT a.*, s.starts_at, s.title, ps.name position, t.name team, c.name campus, c.address, p.first_name, p.nickname
      FROM assignments a JOIN services s ON s.id = a.service_id JOIN positions ps ON ps.id = a.position_id JOIN teams t ON t.id = ps.team_id
      JOIN campuses c ON c.id = s.campus_id JOIN people p ON p.id = a.person_id WHERE a.id = ?`).get(int(req.params.id));
    const want = a ? assignmentSig(db, a.id, a.person_id) : 'x'.repeat(24);
    const got = String(req.params.sig || '').padEnd(24).slice(0, 24);
    if (!a || !a.sent_at || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) throw notFound('That request');
    return a;
  };
  const view = (a) => ({ church_name: getSetting(db, 'church_name', 'Church'), brand_color: getSetting(db, 'brand_color', '#135fd1'), first_name: a.nickname || a.first_name,
    position: a.position, team: a.team, campus: a.campus, address: a.address, starts_at: a.starts_at, title: a.title, status: a.status, past: a.starts_at < new Date().toISOString().slice(0, 16) });

  r.get('/public/assignments/:id/:sig', (req, res) => res.json(view(signed(req))));
  r.post('/public/assignments/:id/:sig', (req, res) => {
    const a = signed(req);
    const status = req.body?.status === 'declined' ? 'declined' : req.body?.status === 'accepted' ? 'accepted' : null;
    if (!status) throw bad('Choose accept or decline.');
    if (view(a).past) throw bad('This date has already passed.');
    db.prepare("UPDATE assignments SET status = ?, decline_reason = ?, responded_at = datetime('now') WHERE id = ?")
      .run(status, status === 'declined' ? str(req.body?.reason, 300) : '', a.id);
    if (status === 'declined' && a.status !== 'declined') notifyDeclined(db, a.id);
    res.json(view({ ...a, status }));
  });

  // ---------------------------------------------------------------- connect cards
  r.post('/public/connect', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // a hidden field only bots fill in
    if (!rateLimit(req.ip)) throw bad('Thanks! We already have your card. Please try again later if you need to send another.');
    const first = required(b.first_name, 'First name').slice(0, 60);
    const email = str(b.email, 200).toLowerCase();
    const phone = str(b.phone, 40);
    if (!email && !phone) throw bad('Please leave an email or phone number so we can reach you.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('That email doesn’t look right.');
    const campusId = int(b.campus_id);
    const allowed = appConfig(db).connect.interests;
    const interests = (Array.isArray(b.interests) ? b.interests : []).filter((x) => allowed.includes(x));
    const info = db.prepare(`INSERT INTO connect_cards (campus_id, first_name, last_name, email, phone, first_time, interests, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      campusId && db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId) ? campusId : null,
      first, str(b.last_name, 60), email, phone, b.first_time ? 1 : 0, JSON.stringify(interests), str(b.message, 2000));
    // Staff (at that campus) hear about it in their inbox.
    const staff = db.prepare("SELECT id, campus_ids FROM users WHERE active = 1 AND role IN ('staff', 'admin')").all()
      .filter((u) => !u.campus_ids || !campusId || JSON.parse(u.campus_ids).includes(campusId)).map((u) => u.id);
    notify(db, staff, {
      kind: 'connect',
      title: `New connect card: ${first} ${str(b.last_name, 60)}`.trim(),
      body: [b.first_time ? 'First time here' : '', interests.join(', '), str(b.message, 120)].filter(Boolean).join(' · ') || 'Tap to follow up.',
      url: '/#/connect',
      app_url: `${(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')}/#/connect`,
    });
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  const card = (req, cardId) => {
    const c = db.prepare('SELECT * FROM connect_cards WHERE id = ?').get(cardId);
    if (!c) throw notFound('Connect card');
    if (!canCampus(req.user, c.campus_id)) throw forbidden();
    return c;
  };

  r.get('/connect-cards', requireRole('leader'), (req, res) => {
    const cf = campusFilter(req.user, 'k.campus_id');
    const open = req.query.status !== 'done';
    const rows = db.prepare(`SELECT k.*, c.short_name campus_short, c.name campus_name, p.first_name person_first, p.last_name person_last,
        (SELECT COALESCE(p2.nickname, p2.first_name) FROM users u JOIN people p2 ON p2.id = u.person_id WHERE u.id = k.done_by) done_by_name
      FROM connect_cards k LEFT JOIN campuses c ON c.id = k.campus_id LEFT JOIN people p ON p.id = k.person_id
      WHERE ${open ? 'k.done_at IS NULL' : 'k.done_at IS NOT NULL'} AND ${cf.sql}
      ORDER BY k.created_at DESC LIMIT 200`).all(...cf.args);
    res.json(rows.map((k) => ({ ...k, interests: JSON.parse(k.interests || '[]') })));
  });

  // Body: { done?: bool, person_id?: id|null }
  r.patch('/connect-cards/:id', requireRole('leader'), (req, res) => {
    const c = card(req, req.params.id);
    const b = req.body || {};
    if (b.person_id !== undefined) {
      const pid = int(b.person_id);
      if (pid && !db.prepare('SELECT 1 FROM people WHERE id = ?').get(pid)) throw notFound('Person');
      db.prepare('UPDATE connect_cards SET person_id = ? WHERE id = ?').run(pid, c.id);
    }
    if (b.done !== undefined) {
      db.prepare('UPDATE connect_cards SET done_at = ?, done_by = ? WHERE id = ?').run(b.done ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, b.done ? req.user.id : null, c.id);
    }
    res.json({ ok: true });
  });

  // People who created their own account in the app and haven't been welcomed yet.
  r.get('/signups', requireRole('leader'), (req, res) => {
    const cf = campusFilter(req.user, 'p.campus_id');
    const done = req.query.status === 'done';
    res.json(db.prepare(`SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.campus_id, p.signed_up_at, p.welcomed_at, c.short_name campus_short
      FROM people p LEFT JOIN campuses c ON c.id = p.campus_id
      WHERE p.signed_up_at IS NOT NULL AND p.archived = 0 AND p.welcomed_at IS ${done ? 'NOT ' : ''}NULL AND ${cf.sql}
      ORDER BY p.signed_up_at DESC LIMIT 200`).all(...cf.args));
  });

  r.patch('/signups/:id', requireRole('leader'), (req, res) => {
    const p = db.prepare('SELECT id, campus_id FROM people WHERE id = ? AND signed_up_at IS NOT NULL').get(req.params.id);
    if (!p) throw notFound('Sign-up');
    if (!canCampus(req.user, p.campus_id)) throw forbidden();
    db.prepare('UPDATE people SET welcomed_at = ? WHERE id = ?').run(req.body?.welcomed ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, p.id);
    res.json({ ok: true });
  });

  r.delete('/connect-cards/:id', requireRole('staff'), (req, res) => {
    const c = card(req, req.params.id);
    db.prepare('DELETE FROM connect_cards WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  return r;
}

