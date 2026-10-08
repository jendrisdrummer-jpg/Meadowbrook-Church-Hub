// Video calls in chats (Daily): start one now, or schedule a team meeting. The Daily room is
// made when the first person joins and closed when everyone has left. A monthly minutes limit
// (Settings → Video calls) keeps it inside the free plan: Daily's own usage records are
// checked every minute while calls are live (and on every join); admins are told at 80% and
// 100%, and once the limit is reached no call starts and live ones end.
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireRole, rank } from '../auth.js';
import { getSetting, setSetting } from '../db.js';
import { HttpError, bad, notFound, forbidden, int, str } from '../http.js';
import { notify } from '../notify.js';
import { hooks } from '../live.js';
import * as daily from '../daily.js';

const ROOM_HOURS = 4;
const EARLY_MIN = 15;                 // meetings open (and remind) this long before they start
const iso = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
const parse = (t) => Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthStart = () => Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);

// This month's participant-minutes, from Daily, refreshed when older than maxAge ms.
export async function usage(db, maxAge = 5 * 60e3) {
  const limit = getSetting(db, 'video_minutes_limit', 9000);
  let u = getSetting(db, 'video_usage', null);
  if (!u || u.month !== monthKey()) u = { month: monthKey(), minutes: 0, synced_at: 0 };
  if (daily.dailyConfigured() && Date.now() - u.synced_at > maxAge) {
    try {
      u = { ...u, month: monthKey(), minutes: await daily.minutesSince(monthStart()), synced_at: Date.now() };
      // Tell admins once a month at 80%, and again when the limit is reached.
      const level = limit && u.minutes >= limit ? 100 : limit && u.minutes >= limit * 0.8 ? 80 : 0;
      if (level > (u.warned || 0)) {
        u.warned = level;
        const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((x) => x.id);
        notify(db, admins, {
          kind: 'call',
          title: level === 100 ? 'Video calls paused: monthly minutes used up' : 'Video calls: 80% of this month’s minutes used',
          body: `${u.minutes.toLocaleString()} of ${limit.toLocaleString()} minutes. ${level === 100 ? 'Calls start again on the 1st, or raise the limit in Settings.' : 'Calls stop at the limit until the 1st.'}`,
          url: '/#/settings/church',
          tag: 'video-usage',
        });
      }
      setSetting(db, 'video_usage', u);
    } catch (e) { console.error('Video usage check failed:', e.message); }
  }
  return { ...u, limit, left: Math.max(0, limit - u.minutes), configured: daily.dailyConfigured() };
}

const links = (c) => ({ url: `/#/chat/${c.chat_id}?call=${c.id}`, app_url: `/app/#/chat/${c.chat_id}?call=${c.id}` });

async function endCall(db, c) {
  if (c.room_name) await daily.deleteRoom(c.room_name).catch((e) => console.error('Closing a video room failed:', e.message));
  db.prepare('UPDATE calls SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(iso(), c.id);
  hooks.callChanged(c.id);
}

export default function callRoutes(db) {
  const r = Router();
  const getCall = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  function load(req, id) {
    const c = getCall(int(id, 'call'));
    const a = c && hooks.chatAccess(req, c.chat_id);
    if (!a) throw notFound('Call');
    return { c, a };
  }
  const live = (chatId) => db.prepare('SELECT * FROM calls WHERE chat_id = ? AND ended_at IS NULL AND starts_at IS NULL ORDER BY id DESC').get(chatId);

  // For Settings and the chat page: is it set up, and how much is left this month.
  r.get('/calls/usage', requireRole('volunteer'), async (req, res) => {
    const u = await usage(db, rank(req.user.role) >= rank('staff') ? 60e3 : 5 * 60e3);
    res.json({ configured: u.configured, minutes: u.minutes, limit: u.limit, left: u.left, month: u.month });
  });

  // Start a call now, or schedule a meeting (starts_at, an ISO time).
  r.post('/chats/:id/calls', requireRole('volunteer'), async (req, res) => {
    const chatId = int(req.params.id, 'chat');
    const a = hooks.chatAccess(req, chatId);
    if (!a) throw notFound('Chat');
    if (a.kind === 'team' && !a.member && !a.manage) throw forbidden();
    const b = req.body || {};
    let startsAt = null;
    if (b.starts_at) {
      const t = Date.parse(b.starts_at);
      if (Number.isNaN(t)) throw bad('Pick a date and time.');
      if (t < Date.now() - 5 * 60e3) throw bad('That time has passed.');
      startsAt = new Date(t).toISOString();
    } else {
      const u = await usage(db);
      if (!u.configured) throw new HttpError(503, 'Video calls aren’t set up yet. An admin can turn them on in Settings → Church.');
      if (u.left <= 0) throw new HttpError(403, `This month’s video minutes are used up (${u.minutes} of ${u.limit}). They reset on the 1st.`);
      // One call at a time in a chat: starting again just joins the one going.
      const going = live(chatId);
      if (going) return res.json({ ...going, existing: true });
    }
    const title = str(b.title, 120) || (startsAt ? 'Team meeting' : '');
    const id = Number(db.prepare('INSERT INTO calls (chat_id, title, starts_at, started_by) VALUES (?, ?, ?, ?)').run(chatId, title, startsAt, req.user.id).lastInsertRowid);
    const watching = hooks.callPosted(id, chatId, req.user.id);
    const c = getCall(id);
    const name = hooks.chatName(chatId);
    const to = hooks.chatUsers(chatId).filter((u) => u !== req.user.id && !watching.has(u));
    if (!startsAt) {
      notify(db, to, { kind: 'call', title: `${req.user.name} started a call in ${name}`, body: 'Tap to join.', ...links(c), tag: `call-${id}`, data: { call_id: id } });
    } else {
      const when = new Date(startsAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC' });
      notify(db, to, { kind: 'call', title: `${title} · ${name}`, body: `${req.user.name} scheduled it for ${when}.`, ...links(c), tag: `call-${id}`, data: { call_id: id } });
    }
    res.status(201).json(c);
  });

  // Join: a room (made now if needed) and a pass for this person.
  r.post('/calls/:id/join', requireRole('volunteer'), async (req, res) => {
    const { c, a } = load(req, req.params.id);
    if (c.ended_at) throw bad('This call has ended.');
    if (c.starts_at && Date.now() < parse(c.starts_at) - EARLY_MIN * 60e3) throw bad(`You can join from ${EARLY_MIN} minutes before it starts.`);
    const u = await usage(db, 60e3);
    if (!u.configured) throw new HttpError(503, 'Video calls aren’t set up yet. An admin can turn them on in Settings → Church.');
    if (u.left <= 0) throw new HttpError(403, `This month’s video minutes are used up (${u.minutes} of ${u.limit}). They reset on the 1st.`);
    let room = { name: c.room_name, url: c.room_url, exp: c.room_exp };
    const now = Math.floor(Date.now() / 1000);
    try {
      if (!room.name || room.exp < now + 120) {
        const exp = now + ROOM_HOURS * 3600;
        const made = await daily.createRoom(`mb-${c.id}-${crypto.randomBytes(4).toString('hex')}`, exp);
        room = { name: made.name, url: made.url, exp };
        db.prepare('UPDATE calls SET room_name = ?, room_url = ?, room_exp = ?, room_created_at = COALESCE(room_created_at, ?) WHERE id = ?').run(room.name, room.url, exp, iso(), c.id);
        hooks.callChanged(c.id);
      }
      const token = await daily.meetingToken({
        room_name: room.name, user_name: req.user.name, user_id: String(req.user.id), exp: room.exp,
        is_owner: c.started_by === req.user.id || Boolean(a.manage), enable_screenshare: true,
      });
      db.prepare('UPDATE calls SET empty_since = NULL WHERE id = ?').run(c.id);
      res.json({ url: room.url, token, title: c.title || hooks.chatName(c.chat_id), minutes_left: u.left });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  });

  // End a call for everyone, or cancel a meeting: whoever started it, or a leader/admin of the chat.
  r.post('/calls/:id/end', requireRole('volunteer'), async (req, res) => {
    const { c, a } = load(req, req.params.id);
    if (c.started_by !== req.user.id && !a.manage) throw forbidden();
    if (!c.ended_at) await endCall(db, c);
    res.json({ ok: true });
  });

  return r;
}

// Every minute: meeting reminders, closing empty or expired rooms, and the monthly limit.
export async function syncCalls(db) {
  const now = Date.now();
  // "Starting soon" for scheduled meetings.
  for (const c of db.prepare('SELECT * FROM calls WHERE starts_at IS NOT NULL AND ended_at IS NULL AND reminded = 0').all()) {
    const t = parse(c.starts_at);
    if (t - now > EARLY_MIN * 60e3) continue;
    db.prepare('UPDATE calls SET reminded = 1 WHERE id = ?').run(c.id);
    if (now - t > 30 * 60e3) continue;
    notify(db, hooks.chatUsers(c.chat_id), { kind: 'call', title: `Starting soon: ${c.title || 'Team meeting'}`, body: `${hooks.chatName(c.chat_id)} · tap to join`, ...links(c), tag: `call-${c.id}`, data: { call_id: c.id } });
  }
  const open = db.prepare('SELECT * FROM calls WHERE ended_at IS NULL').all();
  for (const c of open) {
    // Nobody ever joined: a call after an hour, a meeting two hours after its start.
    if (!c.room_name) {
      const from = c.starts_at ? parse(c.starts_at) + 60 * 60e3 : parse(c.created_at);
      if (now - from > 60 * 60e3) await endCall(db, c);
      continue;
    }
    if (c.room_exp * 1000 < now) { await endCall(db, c); continue; }
    if (!daily.dailyConfigured()) continue;
    // Everyone has left for 5 minutes: close it.
    try {
      const p = await daily.presence(c.room_name);
      if ((p.total_count || 0) > 0) db.prepare('UPDATE calls SET empty_since = NULL WHERE id = ?').run(c.id);
      else if (!c.empty_since) db.prepare('UPDATE calls SET empty_since = ? WHERE id = ?').run(iso(), c.id);
      else if (now - parse(c.empty_since) > 5 * 60e3) await endCall(db, c);
    } catch (e) { console.error('Video presence check failed:', e.message); }
  }
  // Over the monthly limit: end what's live so the bill stays at zero.
  const rooms = db.prepare('SELECT * FROM calls WHERE ended_at IS NULL AND room_name IS NOT NULL').all();
  if (rooms.length && daily.dailyConfigured()) {
    const u = await usage(db, 55e3);
    if (u.left <= 0) {
      for (const c of rooms) {
        notify(db, hooks.chatUsers(c.chat_id), { kind: 'call', title: 'Call ended: monthly video minutes used up', body: `${u.minutes} of ${u.limit} minutes this month. They reset on the 1st.`, ...links(c), tag: `call-${c.id}` });
        await endCall(db, c);
      }
    }
  }
}
