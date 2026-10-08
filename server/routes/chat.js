// Chat: one for every team (its members come from the team roster) plus groups that leaders
// and staff put together. Messages can reply to another, @mention people, carry photos and
// files, and get emoji reactions. Open chats update live over a server-sent event stream;
// everyone else gets a push notification.
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireRole, canCampus, rank } from '../auth.js';
import { tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, audit } from '../http.js';
import { pushOnly } from '../notify.js';
import { streams, send, hooks } from '../live.js';
import { dailyConfigured } from '../daily.js';

export const REACTIONS = ['👍', '❤️', '😂', '🙏', '🎉', '😮', '😢', '🔥'];
// Shown in the browser; everything else downloads.
const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
const PAGE = 50;

const personName = (p) => (p.first_name ? `${p.nickname || p.first_name} ${p.last_name || ''}`.trim() : (p.email || '').split('@')[0] || 'Someone');

export default function chatRoutes(db, { uploadDir }) {
  const r = Router();
  const fileDir = path.join(uploadDir, 'chat');

  // ---------------------------------------------------------------- live updates
  // Each open chat page holds a stream; `viewing` is the chat on screen (they get no push for it).
  const viewers = (chatId) => new Set([...streams].filter((s) => s.viewing === chatId).map((s) => s.userId));

  r.get('/chats/stream', requireRole('volunteer'), (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
    res.write('retry: 4000\n\n');
    const viewing = int(req.query.viewing, 'viewing');
    const s = { userId: req.user.id, viewing: viewing && canSee(req, viewing) ? viewing : null, res };
    streams.add(s);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); streams.delete(s); });
  });

  // ---------------------------------------------------------------- who's in a chat
  // Every live team has a chat; make any that are missing.
  const ensureTeamChats = () => db.prepare(`INSERT INTO chats (kind, team_id) SELECT 'team', t.id FROM teams t
    WHERE t.archived = 0 AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.team_id = t.id)`).run();

  const getChat = (id) => db.prepare(`SELECT c.*, t.name team_name, t.color team_color, t.campus_id, t.archived team_archived
    FROM chats c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = ?`).get(id);

  // The people in a chat (people without an account are listed, but can't read it yet).
  function members(c) {
    if (c.kind === 'team') {
      return db.prepare(`SELECT p.id person_id, p.first_name, p.last_name, p.nickname, p.photo, MAX(tm.is_leader) is_admin,
          (SELECT u.id FROM users u WHERE u.person_id = p.id AND u.active = 1) user_id
        FROM team_members tm JOIN people p ON p.id = tm.person_id WHERE tm.team_id = ? AND p.archived = 0
        GROUP BY p.id ORDER BY is_admin DESC, p.first_name, p.last_name`).all(c.team_id);
    }
    return db.prepare(`SELECT p.id person_id, p.first_name, p.last_name, p.nickname, p.photo, cm.is_admin,
        (SELECT u.id FROM users u WHERE u.person_id = p.id AND u.active = 1) user_id
      FROM chat_members cm JOIN people p ON p.id = cm.person_id WHERE cm.chat_id = ? AND p.archived = 0
      ORDER BY cm.is_admin DESC, p.first_name, p.last_name`).all(c.id);
  }
  // Accounts that hear about new messages: the members, plus whoever made a group without
  // being in People themselves (e.g. a shared admin login).
  function memberUserIds(c) {
    const ids = members(c).map((m) => m.user_id).filter(Boolean);
    if (c.kind === 'group' && c.created_by && !db.prepare('SELECT person_id FROM users WHERE id = ?').get(c.created_by)?.person_id) ids.push(c.created_by);
    return [...new Set(ids)];
  }

  // What this account can do in a chat: null (can't see it), or { member, manage }.
  function access(req, c) {
    if (!c) return null;
    const me = req.user;
    if (c.kind === 'team') {
      if (c.team_archived) return null;
      const row = me.personId && db.prepare('SELECT MAX(is_leader) leader FROM team_members WHERE team_id = ? AND person_id = ?').get(c.team_id, me.personId);
      const member = Boolean(row && row.leader != null);
      const staff = rank(me.role) >= rank('staff') && canCampus(me, c.campus_id);
      if (!member && !staff) return null;
      return { member, manage: staff || Boolean(row?.leader) };
    }
    const row = me.personId && db.prepare('SELECT is_admin FROM chat_members WHERE chat_id = ? AND person_id = ?').get(c.id, me.personId);
    const ownerWithoutPerson = c.created_by === me.id && !me.personId;
    if (!row && !ownerWithoutPerson) return null;
    return { member: true, manage: Boolean(row?.is_admin) || ownerWithoutPerson };
  }
  const canSee = (req, id) => Boolean(access(req, getChat(id)));
  function chat(req, id) {
    const c = getChat(int(id, 'chat'));
    const a = access(req, c);
    if (!a) throw notFound('Chat');
    return { c, a };
  }

  const readRow = (chatId, userId) => db.prepare('SELECT last_read_id, muted FROM chat_reads WHERE chat_id = ? AND user_id = ?').get(chatId, userId) || { last_read_id: 0, muted: 0 };
  const markRead = (chatId, userId, lastId) => db.prepare(`INSERT INTO chat_reads (chat_id, user_id, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT (chat_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(chatId, userId, lastId);
  const unread = (chatId, userId, after) => db.prepare(`SELECT COUNT(*) n FROM messages WHERE chat_id = ? AND id > ? AND deleted_at IS NULL
    AND (user_id IS NULL OR user_id != ?)`).get(chatId, after, userId).n;

  // ---------------------------------------------------------------- messages, as the page shows them
  function serialize(rows) {
    if (!rows.length) return [];
    const ids = rows.map((m) => m.id);
    const q = ids.map(() => '?').join(',');
    const files = Map.groupBy(db.prepare(`SELECT id, message_id, name, mime, size FROM message_files WHERE message_id IN (${q}) ORDER BY id`).all(...ids), (f) => f.message_id);
    const reacts = Map.groupBy(db.prepare(`SELECT x.message_id, x.emoji, x.user_id, p.first_name, p.last_name, p.nickname, u.email
      FROM message_reactions x JOIN users u ON u.id = x.user_id LEFT JOIN people p ON p.id = u.person_id WHERE x.message_id IN (${q})`).all(...ids), (x) => x.message_id);
    const replyIds = [...new Set(rows.map((m) => m.reply_to).filter(Boolean))];
    const replies = new Map(replyIds.length ? db.prepare(`SELECT m.id, m.body, m.deleted_at, p.first_name, p.last_name, p.nickname, u.email,
        (SELECT COUNT(*) FROM message_files f WHERE f.message_id = m.id) files
      FROM messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN people p ON p.id = u.person_id
      WHERE m.id IN (${replyIds.map(() => '?').join(',')})`).all(...replyIds).map((x) => [x.id, x]) : []);
    // Task cards show the task as it is now.
    const taskIds = [...new Set(rows.map((m) => m.task_id).filter(Boolean))];
    const tasks = new Map(taskIds.length ? db.prepare(`SELECT t.id, t.title, t.due_date, t.due_time, t.done_at, t.assignee_id, t.repeat,
        p.first_name, p.last_name, p.nickname, p.photo, dp.first_name done_first, dp.nickname done_nick,
        (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) items, (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) items_done,
        (SELECT COUNT(*) FROM task_comments k WHERE k.task_id = t.id) comments
      FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id LEFT JOIN users du ON du.id = t.done_by LEFT JOIN people dp ON dp.id = du.person_id
      WHERE t.id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds).map((t) => [t.id, {
        id: t.id, title: t.title, due_date: t.due_date, due_time: t.due_time, done_at: t.done_at, repeat: t.repeat, assignee_id: t.assignee_id,
        assignee: t.assignee_id ? { first_name: t.first_name, last_name: t.last_name, nickname: t.nickname, photo: t.photo } : null,
        done_by: t.done_at ? t.done_nick || t.done_first || '' : '', items: t.items, items_done: t.items_done, comments: t.comments,
      }]) : []);
    // Call cards: the call or meeting as it is now.
    const callIds = [...new Set(rows.map((m) => m.call_id).filter(Boolean))];
    const calls = new Map(callIds.length ? db.prepare(`SELECT id, title, starts_at, ended_at, room_created_at, started_by FROM calls
      WHERE id IN (${callIds.map(() => '?').join(',')})`).all(...callIds).map((c) => [c.id, c]) : []);
    return rows.map((m) => {
      const gone = Boolean(m.deleted_at);
      const reply = m.reply_to && replies.get(m.reply_to);
      const byEmoji = Map.groupBy(reacts.get(m.id) || [], (x) => x.emoji);
      return {
        id: m.id,
        chat_id: m.chat_id,
        kind: m.kind,
        task: m.kind === 'task' ? tasks.get(m.task_id) || null : undefined,
        call: m.kind === 'call' ? calls.get(m.call_id) || null : undefined,
        user_id: m.user_id,
        person_id: m.person_id,
        name: personName(m),
        photo: m.photo,
        body: gone ? '' : m.body,
        mentions: gone ? [] : JSON.parse(m.mentions || '[]'),
        created_at: m.created_at,
        edited_at: m.edited_at,
        deleted: gone,
        files: gone ? [] : (files.get(m.id) || []).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/chat-files/${f.id}/${encodeURIComponent(f.name)}` })),
        reactions: gone ? [] : REACTIONS.filter((e) => byEmoji.has(e)).map((e) => ({ emoji: e, user_ids: byEmoji.get(e).map((x) => x.user_id), names: byEmoji.get(e).map(personName) })),
        reply: reply ? { id: reply.id, name: personName(reply), body: reply.deleted_at ? '' : reply.body.slice(0, 140), files: reply.files, deleted: Boolean(reply.deleted_at) } : null,
      };
    });
  }
  const SELECT_MSG = `SELECT m.*, u.email, p.id person_id, p.first_name, p.last_name, p.nickname, p.photo
    FROM messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN people p ON p.id = u.person_id`;
  const message = (id) => serialize(db.prepare(`${SELECT_MSG} WHERE m.id = ?`).all(id))[0];
  // Tell everyone with the chat open (and members' other pages) about a new or changed message.
  const announce = (c, msg, type = 'message') => send(memberUserIds(c), c.id, { type, chat_id: c.id, message: msg });

  // ---------------------------------------------------------------- the chat list
  function summary(req, c, a) {
    const read = readRow(c.id, req.user.id);
    const last = db.prepare(`${SELECT_MSG} WHERE m.chat_id = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1`).get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      team_id: c.team_id,
      name: c.kind === 'team' ? c.team_name : c.name,
      color: c.team_color || null,
      member: a.member,
      manage: a.manage,
      muted: Boolean(read.muted),
      unread: a.member ? unread(c.id, req.user.id, read.last_read_id) : 0,
      last: last ? { name: personName(last), body: last.kind === 'task' ? `New task: ${db.prepare('SELECT title FROM tasks WHERE id = ?').get(last.task_id)?.title || '(deleted)'}`
        : last.kind === 'call' ? (db.prepare('SELECT starts_at, title FROM calls WHERE id = ?').get(last.call_id)?.starts_at ? `Scheduled a meeting` : 'Started a call') : last.body.slice(0, 120), files: db.prepare('SELECT COUNT(*) n FROM message_files WHERE message_id = ?').get(last.id).n, at: last.created_at, mine: last.user_id === req.user.id } : null,
    };
  }

  function myChats(req) {
    ensureTeamChats();
    const rows = db.prepare(`SELECT c.*, t.name team_name, t.color team_color, t.campus_id, t.archived team_archived
      FROM chats c LEFT JOIN teams t ON t.id = c.team_id WHERE c.kind = 'group' OR t.archived = 0`).all();
    return rows.map((c) => [c, access(req, c)]).filter(([, a]) => a);
  }

  r.get('/chats', requireRole('volunteer'), (req, res) => {
    const list = myChats(req).map(([c, a]) => summary(req, c, a));
    const at = (x) => x.last?.at || '';
    list.sort((x, y) => Number(y.member) - Number(x.member) || at(y).localeCompare(at(x)) || x.name.localeCompare(y.name));
    res.json({ me: req.user.id, person_id: req.user.personId ?? null, can_create: rank(req.user.role) >= rank('leader'), reactions: REACTIONS, video: dailyConfigured(), chats: list });
  });

  // For the unread badge in the menu.
  r.get('/chats/unread', requireRole('volunteer'), (req, res) => {
    let total = 0;
    for (const [c, a] of myChats(req)) {
      if (!a.member) continue;
      const read = readRow(c.id, req.user.id);
      if (!read.muted) total += unread(c.id, req.user.id, read.last_read_id);
    }
    res.json({ total });
  });

  // ---------------------------------------------------------------- one chat
  r.get('/chats/:id', requireRole('volunteer'), (req, res) => {
    const { c, a } = chat(req, req.params.id);
    // A call going on now (or a meeting that opens within 15 minutes), for the Join button up top.
    const call = db.prepare(`SELECT id, title, starts_at, started_by FROM calls WHERE chat_id = ? AND ended_at IS NULL
      AND (starts_at IS NULL OR starts_at <= ?) ORDER BY id DESC LIMIT 1`).get(c.id, new Date(Date.now() + 15 * 60e3).toISOString());
    res.json({ ...summary(req, c, a), campus_id: c.campus_id ?? null, members: members(c), open_tasks: openTasks(c), live_call: call || null, last_read_id: readRow(c.id, req.user.id).last_read_id });
  });

  // Newest PAGE messages, or older (?before=id) / newer (?after=id) than one.
  r.get('/chats/:id/messages', requireRole('volunteer'), (req, res) => {
    const { c } = chat(req, req.params.id);
    const before = int(req.query.before, 'before');
    const after = int(req.query.after, 'after');
    const rows = after
      ? db.prepare(`${SELECT_MSG} WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`).all(c.id, after)
      : db.prepare(`${SELECT_MSG} WHERE m.chat_id = ? ${before ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ${PAGE + 1}`).all(...(before ? [c.id, before] : [c.id])).reverse();
    const more = !after && rows.length > PAGE;
    res.json({ messages: serialize(more ? rows.slice(1) : rows), more });
  });

  r.post('/chats/:id/read', requireRole('volunteer'), (req, res) => {
    const { c, a } = chat(req, req.params.id);
    const last = int(req.body?.last_id, 'last_id') ?? db.prepare('SELECT MAX(id) id FROM messages WHERE chat_id = ?').get(c.id).id ?? 0;
    if (a.member) markRead(c.id, req.user.id, last);
    res.json({ ok: true });
  });

  r.patch('/chats/:id/me', requireRole('volunteer'), (req, res) => {
    const { c } = chat(req, req.params.id);
    db.prepare(`INSERT INTO chat_reads (chat_id, user_id, muted) VALUES (?, ?, ?)
      ON CONFLICT (chat_id, user_id) DO UPDATE SET muted = excluded.muted`).run(c.id, req.user.id, req.body?.muted ? 1 : 0);
    res.json({ muted: Boolean(req.body?.muted) });
  });

  // ---------------------------------------------------------------- sending
  r.post('/chats/:id/messages', requireRole('volunteer'), (req, res) => {
    const { c } = chat(req, req.params.id);
    const b = req.body || {};
    const body = str(b.body, 4000);
    const fileIds = (Array.isArray(b.file_ids) ? b.file_ids : []).slice(0, 10).map((x) => int(x, 'file'));
    const files = fileIds.length ? db.prepare(`SELECT id FROM message_files WHERE chat_id = ? AND user_id = ? AND message_id IS NULL AND id IN (${fileIds.map(() => '?').join(',')})`).all(c.id, req.user.id, ...fileIds) : [];
    if (!body && !files.length) throw bad('Type a message.');
    const replyTo = int(b.reply_to, 'reply_to');
    if (replyTo && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND chat_id = ?').get(replyTo, c.id)) throw bad('That message isn’t in this chat.');
    const people = members(c);
    const mentions = [...new Set((Array.isArray(b.mentions) ? b.mentions : []).map(Number))].filter((id) => people.some((m) => m.person_id === id));
    const id = tx(db, () => {
      const info = db.prepare('INSERT INTO messages (chat_id, user_id, body, reply_to, mentions) VALUES (?, ?, ?, ?, ?)').run(c.id, req.user.id, body, replyTo, JSON.stringify(mentions));
      const mid = Number(info.lastInsertRowid);
      for (const f of files) db.prepare('UPDATE message_files SET message_id = ? WHERE id = ?').run(mid, f.id);
      db.prepare("UPDATE chats SET last_message_at = datetime('now') WHERE id = ?").run(c.id);
      markRead(c.id, req.user.id, mid);
      return mid;
    });
    const msg = message(id);
    announce(c, msg);
    notifyMembers(c, msg, people);
    res.status(201).json(msg);
  });

  // A push to everyone in the chat who isn't looking at it. Muted chats stay quiet unless
  // the message @mentions them.
  // skip: accounts told some other way (whoever was just given a task hears about it from Tasks).
  function notifyMembers(c, msg, people, skip = new Set()) {
    const watching = viewers(c.id);
    const mentioned = new Set(people.filter((p) => msg.mentions.includes(p.person_id)).map((p) => p.user_id));
    const chatName = c.kind === 'team' ? c.team_name : c.name;
    const preview = msg.task ? `New task: ${msg.task.title}${msg.task.assignee ? ` → ${msg.task.assignee.nickname || msg.task.assignee.first_name}` : ''}`
      : msg.body ? msg.body.slice(0, 140) : msg.files.some((f) => f.mime.startsWith('image/')) ? 'Sent a photo' : 'Sent a file';
    const quiet = new Set(db.prepare('SELECT user_id FROM chat_reads WHERE chat_id = ? AND muted = 1').all(c.id).map((x) => x.user_id));
    const to = memberUserIds(c).filter((u) => u !== msg.user_id && !watching.has(u) && !skip.has(u));
    const base = { kind: 'chat', url: `/#/chat/${c.id}`, app_url: `/app/#/chat/${c.id}`, tag: `chat-${c.id}`, renotify: true, data: { chat_id: c.id } };
    pushOnly(db, to.filter((u) => mentioned.has(u)), { ...base, title: `${msg.name} mentioned you in ${chatName}`, body: preview });
    pushOnly(db, to.filter((u) => !mentioned.has(u) && !quiet.has(u)), { ...base, title: chatName, body: `${msg.name}: ${preview}` });
  }

  const ownMessage = (req, id) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(int(id, 'message'));
    if (!m) throw notFound('Message');
    const { c, a } = chat(req, m.chat_id);
    return { m, c, a };
  };

  r.patch('/messages/:id', requireRole('volunteer'), (req, res) => {
    const { m, c } = ownMessage(req, req.params.id);
    if (m.user_id !== req.user.id || m.deleted_at) throw forbidden();
    const body = str(req.body?.body, 4000);
    if (!body && !db.prepare('SELECT 1 FROM message_files WHERE message_id = ?').get(m.id)) throw bad('Type a message.');
    db.prepare("UPDATE messages SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, m.id);
    const msg = message(m.id);
    announce(c, msg);
    res.json(msg);
  });

  // Your own messages, or anyone's if you lead the team / run the group.
  r.delete('/messages/:id', requireRole('volunteer'), (req, res) => {
    const { m, c, a } = ownMessage(req, req.params.id);
    if (m.user_id !== req.user.id && !a.manage) throw forbidden();
    const files = db.prepare('SELECT file FROM message_files WHERE message_id = ?').all(m.id);
    tx(db, () => {
      db.prepare("UPDATE messages SET body = '', mentions = '[]', deleted_at = datetime('now') WHERE id = ?").run(m.id);
      db.prepare('DELETE FROM message_files WHERE message_id = ?').run(m.id);
      db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(m.id);
    });
    for (const f of files) fs.rm(path.join(fileDir, f.file), { force: true }, () => {});
    if (m.user_id !== req.user.id) audit(db, req, 'chat.message.delete', { chat: c.id, message: m.id });
    announce(c, message(m.id));
    res.json({ ok: true });
  });

  // Tap an emoji to add it; tap again to take it back.
  r.post('/messages/:id/reactions', requireRole('volunteer'), (req, res) => {
    const { m, c } = ownMessage(req, req.params.id);
    const emoji = req.body?.emoji;
    if (!REACTIONS.includes(emoji)) throw bad('Pick one of the reactions.');
    if (m.deleted_at) throw bad('That message was deleted.');
    const had = db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, req.user.id, emoji).changes;
    if (!had) db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(m.id, req.user.id, emoji);
    const msg = message(m.id);
    announce(c, msg);
    res.json(msg);
  });

  // ---------------------------------------------------------------- photos and files
  // The page uploads each file first (photos shrunk in the browser), then sends the message.
  r.post('/chats/:id/files', requireRole('volunteer'), express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
    const { c } = chat(req, req.params.id);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('That file is empty.');
    let name;
    try { name = decodeURIComponent(req.get('x-file-name') || ''); } catch { name = ''; }
    name = str(name.replace(/[\\/\0-\x1f]/g, '_'), 120) || 'file';
    // Sent as octet-stream (so no body parser touches it); the real type comes in its own header.
    const type = (req.get('x-file-type') || '').toLowerCase();
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
    const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
    const file = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(path.join(fileDir, file), req.body);
    const info = db.prepare('INSERT INTO message_files (chat_id, user_id, name, mime, size, file) VALUES (?, ?, ?, ?, ?, ?)').run(c.id, req.user.id, name, mime, req.body.length, file);
    const id = Number(info.lastInsertRowid);
    res.status(201).json({ id, name, mime, size: req.body.length, url: `/api/chat-files/${id}/${encodeURIComponent(name)}` });
  });

  // Only people in the chat can open its files.
  r.get('/chat-files/:id/:name', requireRole('volunteer'), (req, res) => {
    const f = db.prepare('SELECT * FROM message_files WHERE id = ?').get(int(req.params.id, 'file'));
    if (!f || !canSee(req, f.chat_id) || (!f.message_id && f.user_id !== req.user.id)) throw notFound('File');
    const inline = INLINE.has(f.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (f.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(path.join(fileDir, f.file));
  });

  // ---------------------------------------------------------------- tasks in chats
  // A team chat's tasks are the team's; a group's are the ones made in it.
  const openTasks = (c) => (c.kind === 'team'
    ? db.prepare('SELECT COUNT(*) n FROM tasks WHERE team_id = ? AND done_at IS NULL').get(c.team_id).n
    : db.prepare('SELECT COUNT(*) n FROM tasks WHERE chat_id = ? AND done_at IS NULL').get(c.id).n);
  function chatForTask(t) {
    if (t.chat_id) return getChat(t.chat_id);
    if (!t.team_id) return null;
    ensureTeamChats();
    const row = db.prepare('SELECT id FROM chats WHERE team_id = ?').get(t.team_id);
    return row ? getChat(row.id) : null;
  }
  hooks.chatAccess = (req, chatId) => {
    const c = getChat(chatId);
    const a = access(req, c);
    return a ? { ...a, id: c.id, kind: c.kind, team_id: c.team_id } : null;
  };
  hooks.chatPeople = (chatId) => {
    const c = getChat(chatId);
    return c ? members(c).map((m) => m.person_id) : [];
  };
  hooks.myGroups = (req) => db.prepare("SELECT * FROM chats WHERE kind = 'group' ORDER BY name").all()
    .filter((c) => access(req, c)).map((c) => ({ id: c.id, name: c.name }));
  // Giving a team or group task posts it in that chat as a card.
  hooks.taskPosted = (taskId, req) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    const c = t && chatForTask(t);
    if (!c || c.team_archived) return;
    const id = Number(db.prepare("INSERT INTO messages (chat_id, user_id, kind, task_id) VALUES (?, ?, 'task', ?)").run(c.id, req.user.id, taskId).lastInsertRowid);
    db.prepare("UPDATE chats SET last_message_at = datetime('now') WHERE id = ?").run(c.id);
    markRead(c.id, req.user.id, id);
    const msg = message(id);
    announce(c, msg);
    send(memberUserIds(c), c.id, { type: 'tasks', chat_id: c.id });
    const assignee = t.assignee_id && db.prepare('SELECT id FROM users WHERE person_id = ? AND active = 1').get(t.assignee_id)?.id;
    notifyMembers(c, msg, members(c), new Set(assignee ? [assignee] : []));
  };
  // Ticked off, reassigned, renamed…: every card for it, and its chat's Tasks tab, update.
  // ---------------------------------------------------------------- calls in chats
  hooks.chatUsers = (chatId) => { const c = getChat(chatId); return c ? memberUserIds(c) : []; };
  hooks.chatName = (chatId) => { const c = getChat(chatId); return c ? (c.kind === 'team' ? c.team_name : c.name) : ''; };
  // Posts a call or meeting card in its chat.
  hooks.callPosted = (callId, chatId, userId) => {
    const c = getChat(chatId);
    const id = Number(db.prepare("INSERT INTO messages (chat_id, user_id, kind, call_id) VALUES (?, ?, 'call', ?)").run(c.id, userId, callId).lastInsertRowid);
    db.prepare("UPDATE chats SET last_message_at = datetime('now') WHERE id = ?").run(c.id);
    markRead(c.id, userId, id);
    announce(c, message(id));
    return viewers(c.id);
  };
  // A call started, ended or changed: its cards update everywhere.
  hooks.callChanged = (callId) => {
    for (const { id } of db.prepare('SELECT id FROM messages WHERE call_id = ?').all(callId)) {
      const msg = message(id);
      const c = msg && getChat(msg.chat_id);
      if (c) { announce(c, msg); send(memberUserIds(c), c.id, { type: 'call', chat_id: c.id, call_id: callId }); }
    }
  };

  // `was` is the task's team/chat when it has just been deleted.
  hooks.taskChanged = (taskId, messageIds = null, was = null) => {
    const ids = messageIds || db.prepare('SELECT id FROM messages WHERE task_id = ?').all(taskId).map((x) => x.id);
    const chats = new Set();
    for (const id of ids) {
      const msg = message(id);
      const c = msg && getChat(msg.chat_id);
      if (!c) continue;
      announce(c, msg);
      chats.add(c.id);
    }
    const t = db.prepare('SELECT team_id, chat_id FROM tasks WHERE id = ?').get(taskId) || was;
    const home = t && chatForTask(t);
    if (home) chats.add(home.id);
    for (const cid of chats) { const c = getChat(cid); send(memberUserIds(c), cid, { type: 'tasks', chat_id: cid }); }
  };

  // ---------------------------------------------------------------- groups
  // Groups are for people who aren't one team: staff, elders, a project. Leaders and staff make them.
  const personIds = (req, list) => {
    const ids = [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))].slice(0, 500);
    if (!ids.length) return [];
    return db.prepare(`SELECT id, campus_id FROM people WHERE archived = 0 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      .filter((p) => canCampus(req.user, p.campus_id)).map((p) => p.id);
  };

  r.post('/chats', requireRole('leader'), (req, res) => {
    const name = required(req.body?.name, 'Group name').slice(0, 80);
    const people = personIds(req, req.body?.person_ids);
    const id = tx(db, () => {
      const cid = Number(db.prepare("INSERT INTO chats (kind, name, created_by) VALUES ('group', ?, ?)").run(name, req.user.id).lastInsertRowid);
      const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, person_id, is_admin) VALUES (?, ?, ?)');
      if (req.user.personId) ins.run(cid, req.user.personId, 1);
      for (const p of people) ins.run(cid, p, 0);
      return cid;
    });
    audit(db, req, 'chat.group.create', name);
    const c = getChat(id);
    send(memberUserIds(c), null, { type: 'chats' });
    res.status(201).json(summary(req, c, access(req, c)));
  });

  const group = (req, id) => {
    const { c, a } = chat(req, id);
    if (c.kind !== 'group') throw bad('Team chats follow the team roster. Add or remove people on the team’s page.');
    return { c, a };
  };

  r.patch('/chats/:id', requireRole('volunteer'), (req, res) => {
    const { c, a } = group(req, req.params.id);
    if (!a.manage) throw forbidden();
    db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(required(req.body?.name, 'Group name').slice(0, 80), c.id);
    send(memberUserIds(c), c.id, { type: 'chats' });
    res.json({ ok: true });
  });

  r.post('/chats/:id/members', requireRole('volunteer'), (req, res) => {
    const { c, a } = group(req, req.params.id);
    if (!a.manage) throw forbidden();
    const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, person_id) VALUES (?, ?)');
    for (const p of personIds(req, req.body?.person_ids)) ins.run(c.id, p);
    send(memberUserIds(c), c.id, { type: 'chats' });
    res.json({ members: members(c) });
  });

  // Run the group to remove anyone (or make them an admin too); anyone can leave.
  r.patch('/chats/:id/members/:personId', requireRole('volunteer'), (req, res) => {
    const { c, a } = group(req, req.params.id);
    if (!a.manage) throw forbidden();
    db.prepare('UPDATE chat_members SET is_admin = ? WHERE chat_id = ? AND person_id = ?').run(req.body?.is_admin ? 1 : 0, c.id, int(req.params.personId));
    res.json({ members: members(c) });
  });

  r.delete('/chats/:id/members/:personId', requireRole('volunteer'), (req, res) => {
    const { c, a } = group(req, req.params.id);
    const pid = int(req.params.personId);
    if (!a.manage && pid !== req.user.personId) throw forbidden();
    const before = memberUserIds(c);
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND person_id = ?').run(c.id, pid);
    // A group is never left without someone to run it.
    if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND is_admin = 1').get(c.id)) {
      db.prepare('UPDATE chat_members SET is_admin = 1 WHERE rowid = (SELECT rowid FROM chat_members WHERE chat_id = ? ORDER BY added_at LIMIT 1)').run(c.id);
    }
    send(before, c.id, { type: 'chats' });
    res.json({ members: members(c) });
  });

  r.delete('/chats/:id', requireRole('volunteer'), (req, res) => {
    const { c, a } = group(req, req.params.id);
    if (!a.manage) throw forbidden();
    const before = memberUserIds(c);
    const files = db.prepare('SELECT file FROM message_files WHERE chat_id = ?').all(c.id);
    db.prepare('DELETE FROM chats WHERE id = ?').run(c.id);
    for (const f of files) fs.rm(path.join(fileDir, f.file), { force: true }, () => {});
    audit(db, req, 'chat.group.delete', c.name);
    send(before, c.id, { type: 'chats' });
    res.json({ ok: true });
  });

  return r;
}
