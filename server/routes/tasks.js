// Tasks: anyone on a team can give a task to someone on that team; anyone can keep personal
// ones. Tasks have a due date (with reminders), an optional service, a checklist, comments,
// and can repeat (finishing one makes the next).
import { Router } from 'express';
import { requireRole, canCampus, rank } from '../auth.js';
import { tx } from '../db.js';
import { bad, notFound, forbidden, int, str, required, isDate, localNow } from '../http.js';
import { notify } from '../notify.js';
import { hooks } from '../live.js';

export const REPEATS = ['', 'daily', 'weekly', 'biweekly', 'monthly'];
const personName = (p) => (p?.first_name ? `${p.nickname || p.first_name} ${p.last_name || ''}`.trim() : '');

// The next due date for a repeating task (monthly keeps the day, or the month's last day).
export function nextDue(date, repeat) {
  const d = new Date(`${date}T12:00:00Z`);
  if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  if (repeat === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  if (repeat === 'monthly') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

const userOf = (db, personId) => (personId ? db.prepare('SELECT id FROM users WHERE person_id = ? AND active = 1').get(personId)?.id : null);
const links = (id) => ({ url: `/#/tasks/${id}`, app_url: `/app/#/tasks/${id}` });
// Done and Tomorrow right on the notification (the service worker handles them).
const taskActions = (id) => ({ actions: [{ action: 'task-done', title: 'Done' }, { action: 'task-snooze', title: 'Tomorrow' }], data: { task_id: id } });

export default function taskRoutes(db) {
  const r = Router();
  const isStaff = (req) => rank(req.user.role) >= rank('staff');
  const team = (id) => db.prepare('SELECT * FROM teams WHERE id = ? AND archived = 0').get(id);
  const membership = (teamId, personId) => (personId ? db.prepare('SELECT MAX(is_leader) leader FROM team_members WHERE team_id = ? AND person_id = ?').get(teamId, personId) : null);
  const onTeam = (teamId, personId) => membership(teamId, personId)?.leader != null;

  // Teams this account can make and see tasks for: the ones they're on, or (staff) any at their campuses.
  function myTeams(req) {
    const rows = db.prepare('SELECT id, name, color, campus_id FROM teams WHERE archived = 0 ORDER BY name').all();
    return rows.filter((t) => onTeam(t.id, req.user.personId) || (isStaff(req) && canCampus(req.user, t.campus_id)));
  }

  // What this account can do with a task: null (can't see it), or { edit, remove }.
  function access(req, t) {
    if (!t) return null;
    const me = req.user;
    const mine = t.created_by === me.id || (me.personId && t.assignee_id === me.personId);
    // A group's tasks: everyone in the group.
    if (t.chat_id) {
      const g = hooks.chatAccess(req, t.chat_id);
      if (!g && !mine) return null;
      return { edit: true, remove: t.created_by === me.id || Boolean(g?.manage) };
    }
    if (!t.team_id) return mine ? { edit: true, remove: t.created_by === me.id } : null;
    const tm = team(t.team_id);
    if (!tm) return mine ? { edit: true, remove: t.created_by === me.id } : null;
    const m = membership(t.team_id, me.personId);
    const staff = isStaff(req) && canCampus(me, tm.campus_id);
    if (!mine && m?.leader == null && !staff) return null;
    return { edit: true, remove: t.created_by === me.id || Boolean(m?.leader) || staff };
  }
  function task(req, id) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(int(id, 'task'));
    const a = access(req, t);
    if (!a) throw notFound('Task');
    return { t, a };
  }

  // Who a task can go to: anyone on its team, or (personal) only yourself.
  function checkAssignee(req, teamId, personId, chatId = null) {
    if (personId == null) return null;
    if (chatId) {
      if (!hooks.chatPeople(chatId).includes(personId)) throw bad('They aren’t in that group.');
      return personId;
    }
    if (!teamId) {
      if (personId !== req.user.personId) throw bad('Personal tasks are just for you. Pick a team to give it to someone else.');
      return personId;
    }
    if (!onTeam(teamId, personId)) throw bad('They aren’t on that team.');
    return personId;
  }
  function checkTeam(req, teamId) {
    if (teamId == null) return null;
    if (!myTeams(req).some((t) => t.id === teamId)) throw bad('You can only make tasks for teams you’re on.');
    return teamId;
  }
  // A group chat this account is in (group tasks live there).
  function checkGroup(req, chatId) {
    if (chatId == null) return null;
    const g = hooks.chatAccess(req, chatId);
    if (!g || g.kind !== 'group') throw bad('You can only make tasks for groups you’re in.');
    return chatId;
  }
  function checkService(serviceId) {
    if (serviceId == null) return null;
    if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(serviceId)) throw bad('That service wasn’t found.');
    return serviceId;
  }
  const dueTime = (v) => (v ? (/^\d{2}:\d{2}$/.test(v) ? v : (() => { throw bad('Use a time like 18:30.'); })()) : null);

  // ---------------------------------------------------------------- lists
  const LIST = `SELECT t.*, tm.name team_name, tm.color team_color, g.name group_name,
      p.first_name, p.last_name, p.nickname, p.photo,
      cp.first_name by_first, cp.last_name by_last, cp.nickname by_nick, cu.email by_email,
      s.starts_at service_at, s.title service_title, c.short_name service_campus,
      (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) items,
      (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) items_done,
      (SELECT COUNT(*) FROM task_comments k WHERE k.task_id = t.id) comments
    FROM tasks t LEFT JOIN teams tm ON tm.id = t.team_id LEFT JOIN chats g ON g.id = t.chat_id LEFT JOIN people p ON p.id = t.assignee_id
    LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN people cp ON cp.id = cu.person_id
    LEFT JOIN services s ON s.id = t.service_id LEFT JOIN campuses c ON c.id = s.campus_id`;
  const shape = (t) => ({
    id: t.id, title: t.title, notes: t.notes, team_id: t.team_id, team_name: t.team_name, team_color: t.team_color, chat_id: t.chat_id, group_name: t.group_name,
    assignee_id: t.assignee_id, assignee: t.assignee_id ? { first_name: t.first_name, last_name: t.last_name, nickname: t.nickname, photo: t.photo } : null,
    created_by: t.created_by, created_by_name: personName({ first_name: t.by_first, last_name: t.by_last, nickname: t.by_nick }) || (t.by_email || '').split('@')[0],
    due_date: t.due_date, due_time: t.due_time, repeat: t.repeat, done_at: t.done_at,
    service_id: t.service_id, service: t.service_id ? { starts_at: t.service_at, title: t.service_title, campus: t.service_campus } : null,
    items: t.items, items_done: t.items_done, comments: t.comments, created_at: t.created_at,
  });
  const ORDER = "ORDER BY t.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.id";

  // ?view=mine (given to me) | given (I gave to others) | team (&place=team:ID or chat:ID; all of
  // mine without) | chat (&chat_id: a chat's Tasks tab) ; ?done=1 for finished ones.
  r.get('/tasks', requireRole('volunteer'), (req, res) => {
    const view = ['mine', 'given', 'team', 'chat'].includes(req.query.view) ? req.query.view : 'mine';
    const done = req.query.done === '1';
    const status = done ? "t.done_at IS NOT NULL AND t.done_at > datetime('now', '-60 days')" : 't.done_at IS NULL';
    const order = done ? 'ORDER BY t.done_at DESC LIMIT 200' : ORDER;
    let rows;
    if (view === 'mine') {
      rows = db.prepare(`${LIST} WHERE t.assignee_id = ? AND ${status} ${order}`).all(req.user.personId ?? -1);
    } else if (view === 'given') {
      rows = db.prepare(`${LIST} WHERE t.created_by = ? AND (t.assignee_id IS NULL OR t.assignee_id != ?) AND ${status} ${order}`).all(req.user.id, req.user.personId ?? -1);
    } else if (view === 'chat') {
      // A chat's Tasks tab: everything still open, and what was finished this week.
      const g = hooks.chatAccess(req, int(req.query.chat_id, 'chat'));
      if (!g) throw notFound('Chat');
      const where = g.kind === 'team' ? 't.team_id = ?' : 't.chat_id = ?';
      const key = g.kind === 'team' ? g.team_id : g.id;
      rows = [
        ...db.prepare(`${LIST} WHERE ${where} AND t.done_at IS NULL ${ORDER}`).all(key),
        ...db.prepare(`${LIST} WHERE ${where} AND t.done_at > datetime('now', '-7 days') ORDER BY t.done_at DESC LIMIT 30`).all(key),
      ];
    } else {
      const [kind, pid] = String(req.query.place || (req.query.team_id ? `team:${req.query.team_id}` : '')).split(':');
      const teams = kind === 'chat' ? [] : myTeams(req).map((t) => t.id).filter((id) => !pid || id === Number(pid));
      const groups = kind === 'team' ? [] : hooks.myGroups(req).map((g) => g.id).filter((id) => !pid || id === Number(pid));
      if (pid && !teams.length && !groups.length) throw notFound('Team');
      const ors = [teams.length && `t.team_id IN (${teams.join(',')})`, groups.length && `t.chat_id IN (${groups.join(',')})`].filter(Boolean);
      rows = ors.length ? db.prepare(`${LIST} WHERE (${ors.join(' OR ')}) AND ${status} ${order}`).all() : [];
    }
    res.json(rows.map(shape));
  });

  // For the menu badge: my open tasks that are due today or late.
  r.get('/tasks/summary', requireRole('volunteer'), (req, res) => {
    const today = localNow(firstTz()).date;
    const row = db.prepare(`SELECT COUNT(*) open, SUM(due_date IS NOT NULL AND due_date <= ?) due FROM tasks WHERE assignee_id = ? AND done_at IS NULL`).get(today, req.user.personId ?? -1);
    res.json({ open: row.open, due: row.due || 0 });
  });
  const firstTz = () => db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';

  // Teams and groups I can make tasks for, each with who's in it (for the "Assigned to" list).
  r.get('/tasks/teams', requireRole('volunteer'), (req, res) => {
    const people = db.prepare(`SELECT DISTINCT p.id, p.first_name, p.last_name, p.nickname, p.photo FROM team_members tm JOIN people p ON p.id = tm.person_id
      WHERE tm.team_id = ? AND p.archived = 0 ORDER BY p.first_name, p.last_name`);
    const groupPeople = db.prepare(`SELECT p.id, p.first_name, p.last_name, p.nickname, p.photo FROM chat_members cm JOIN people p ON p.id = cm.person_id
      WHERE cm.chat_id = ? AND p.archived = 0 ORDER BY p.first_name, p.last_name`);
    res.json([
      ...myTeams(req).map((t) => ({ key: `team:${t.id}`, kind: 'team', ...t, members: people.all(t.id) })),
      ...hooks.myGroups(req).map((g) => ({ key: `chat:${g.id}`, kind: 'group', id: g.id, name: g.name, color: null, campus_id: null, members: groupPeople.all(g.id) })),
    ]);
  });

  // ---------------------------------------------------------------- one task
  function full(req, id) {
    const { a } = task(req, id);
    const t = shape(db.prepare(`${LIST} WHERE t.id = ?`).get(id));
    return {
      ...t,
      can_edit: a.edit,
      can_delete: a.remove,
      checklist: db.prepare('SELECT id, text, done FROM task_items WHERE task_id = ? ORDER BY sort, id').all(id),
      thread: db.prepare(`SELECT k.id, k.body, k.created_at, k.user_id, p.first_name, p.last_name, p.nickname, p.photo, u.email
        FROM task_comments k LEFT JOIN users u ON u.id = k.user_id LEFT JOIN people p ON p.id = u.person_id WHERE k.task_id = ? ORDER BY k.id`).all(id)
        .map((k) => ({ id: k.id, body: k.body, created_at: k.created_at, mine: k.user_id === req.user.id, name: personName(k) || (k.email || '').split('@')[0] || 'Someone', photo: k.photo })),
    };
  }

  r.get('/tasks/:id', requireRole('volunteer'), (req, res) => res.json(full(req, int(req.params.id, 'task'))));

  // Tell the person a task was given to (unless they gave it to themselves).
  function tellAssignee(req, id, personId, verb = 'gave you a task') {
    const uid = userOf(db, personId);
    if (!uid || uid === req.user.id) return;
    const t = db.prepare('SELECT t.title, t.due_date, COALESCE(tm.name, g.name) team FROM tasks t LEFT JOIN teams tm ON tm.id = t.team_id LEFT JOIN chats g ON g.id = t.chat_id WHERE t.id = ?').get(id);
    const due = t.due_date ? ` · due ${new Date(`${t.due_date}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
    notify(db, [uid], { kind: 'task', title: `${req.user.name} ${verb}`, body: `${t.title}${t.team ? ` (${t.team})` : ''}${due}`, ...links(id), tag: `task-${id}`, ...taskActions(id) });
  }

  r.post('/tasks', requireRole('volunteer'), (req, res) => {
    const b = req.body || {};
    // A team's task, a group's task (chat_id), or a personal one.
    const chatId = checkGroup(req, int(b.chat_id, 'chat'));
    const teamId = chatId ? null : checkTeam(req, int(b.team_id, 'team'));
    const assignee = b.assignee_id === undefined && !teamId && !chatId ? req.user.personId ?? null : checkAssignee(req, teamId, int(b.assignee_id, 'assignee'), chatId);
    if (b.due_date && !isDate(b.due_date)) throw bad('Pick a due date.');
    const id = tx(db, () => {
      const info = db.prepare(`INSERT INTO tasks (title, notes, team_id, chat_id, assignee_id, created_by, due_date, due_time, service_id, repeat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(required(b.title, 'What needs doing').slice(0, 200), str(b.notes, 4000), teamId, chatId, assignee, req.user.id,
        b.due_date || null, b.due_date ? dueTime(b.due_time) : null, checkService(int(b.service_id, 'service')), REPEATS.includes(b.repeat) ? b.repeat : '');
      const tid = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO task_items (task_id, text, sort) VALUES (?, ?, ?)');
      (Array.isArray(b.checklist) ? b.checklist : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 50).forEach((x, i) => ins.run(tid, x, i));
      return tid;
    });
    tellAssignee(req, id, assignee);
    if (teamId || chatId) hooks.taskPosted(id, req);
    res.status(201).json(full(req, id));
  });

  r.patch('/tasks/:id', requireRole('volunteer'), (req, res) => {
    const { t, a } = task(req, req.params.id);
    if (!a.edit) throw forbidden();
    const b = req.body || {};
    const set = {};
    if (b.title !== undefined) set.title = required(b.title, 'What needs doing').slice(0, 200);
    if (b.notes !== undefined) set.notes = str(b.notes, 4000);
    let teamId = t.team_id;
    let chatId = t.chat_id;
    const moving = (b.team_id !== undefined && int(b.team_id, 'team') !== t.team_id) || (b.chat_id !== undefined && int(b.chat_id, 'chat') !== t.chat_id);
    if (moving) {
      chatId = b.chat_id !== undefined ? checkGroup(req, int(b.chat_id, 'chat')) : null;
      teamId = chatId ? null : checkTeam(req, int(b.team_id ?? null, 'team'));
      Object.assign(set, { team_id: teamId, chat_id: chatId });
      // Somewhere else: keep the person only if they're there too.
      const stays = !t.assignee_id || (chatId ? hooks.chatPeople(chatId).includes(t.assignee_id) : teamId ? onTeam(teamId, t.assignee_id) : t.assignee_id === req.user.personId);
      if (b.assignee_id === undefined && !stays) set.assignee_id = null;
    }
    if (b.assignee_id !== undefined) set.assignee_id = checkAssignee(req, teamId, int(b.assignee_id, 'assignee'), chatId);
    if (b.due_date !== undefined) {
      if (b.due_date && !isDate(b.due_date)) throw bad('Pick a due date.');
      set.due_date = b.due_date || null;
      if (!b.due_date) set.due_time = null;
    }
    if (b.due_time !== undefined) set.due_time = (set.due_date ?? t.due_date) ? dueTime(b.due_time) : null;
    if (set.due_date !== undefined || set.due_time !== undefined) set.reminded = 0;
    if (b.service_id !== undefined) set.service_id = checkService(int(b.service_id, 'service'));
    if (b.repeat !== undefined) set.repeat = REPEATS.includes(b.repeat) ? b.repeat : '';
    let next = null;
    if (b.done !== undefined) {
      set.done_at = b.done ? (t.done_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : null;
      set.done_by = b.done ? req.user.id : null;
    }
    tx(db, () => {
      const keys = Object.keys(set);
      if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => set[k]), t.id);
      // Finishing a repeating task makes the next one (once), with the checklist unticked.
      const now = db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id);
      if (b.done && !t.done_at && now.repeat && !now.next_id) {
        const due = nextDue(now.due_date || localNow(firstTz()).date, now.repeat);
        next = Number(db.prepare(`INSERT INTO tasks (title, notes, team_id, chat_id, assignee_id, created_by, due_date, due_time, repeat)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(now.title, now.notes, now.team_id, now.chat_id, now.assignee_id, now.created_by, due, now.due_time, now.repeat).lastInsertRowid);
        db.prepare('INSERT INTO task_items (task_id, text, sort) SELECT ?, text, sort FROM task_items WHERE task_id = ?').run(next, t.id);
        db.prepare('UPDATE tasks SET next_id = ? WHERE id = ?').run(next, t.id);
      }
      // Undone straight away (Undo, or a mis-tap): take back the next one if nobody has touched it.
      if (b.done === false && t.done_at && now.next_id) {
        const n = db.prepare(`SELECT * FROM tasks WHERE id = ? AND done_at IS NULL AND created_at = updated_at
          AND NOT EXISTS (SELECT 1 FROM task_comments WHERE task_id = tasks.id) AND NOT EXISTS (SELECT 1 FROM task_items WHERE task_id = tasks.id AND done = 1)`).get(now.next_id);
        if (n) {
          db.prepare('DELETE FROM tasks WHERE id = ?').run(n.id);
          db.prepare('UPDATE tasks SET next_id = NULL WHERE id = ?').run(t.id);
        }
      }
    });
    if (set.assignee_id && set.assignee_id !== t.assignee_id) tellAssignee(req, t.id, set.assignee_id);
    // The person who gave the task hears when it's done.
    if (b.done && !t.done_at && t.created_by && t.created_by !== req.user.id) {
      notify(db, [t.created_by], { kind: 'task', title: `${req.user.name} finished a task`, body: set.title || t.title, ...links(t.id), tag: `task-${t.id}` });
    }
    // Cards in chats and Tasks tabs update; moved into a team or group, it's posted there.
    if (moving && (teamId || chatId)) hooks.taskPosted(t.id, req);
    hooks.taskChanged(t.id, null, { team_id: t.team_id, chat_id: t.chat_id });
    if (next) hooks.taskChanged(next);
    res.json({ ...full(req, t.id), next_id: next });
  });

  r.delete('/tasks/:id', requireRole('volunteer'), (req, res) => {
    const { t, a } = task(req, req.params.id);
    if (!a.remove) throw forbidden();
    const cards = db.prepare('SELECT id FROM messages WHERE task_id = ?').all(t.id).map((m) => m.id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    hooks.taskChanged(t.id, cards, t);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- checklist
  r.post('/tasks/:id/checklist', requireRole('volunteer'), (req, res) => {
    const { t } = task(req, req.params.id);
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM task_items WHERE task_id = ?').get(t.id).n;
    db.prepare('INSERT INTO task_items (task_id, text, sort) VALUES (?, ?, ?)').run(t.id, required(req.body?.text, 'Step').slice(0, 300), sort);
    hooks.taskChanged(t.id);
    res.status(201).json(full(req, t.id));
  });
  const item = (req, id) => {
    const i = db.prepare('SELECT * FROM task_items WHERE id = ?').get(int(id, 'step'));
    if (!i) throw notFound('Step');
    task(req, i.task_id);
    return i;
  };
  r.patch('/task-items/:id', requireRole('volunteer'), (req, res) => {
    const i = item(req, req.params.id);
    if (req.body?.text !== undefined) db.prepare('UPDATE task_items SET text = ? WHERE id = ?').run(required(req.body.text, 'Step').slice(0, 300), i.id);
    if (req.body?.done !== undefined) db.prepare('UPDATE task_items SET done = ? WHERE id = ?').run(req.body.done ? 1 : 0, i.id);
    hooks.taskChanged(i.task_id);
    res.json(full(req, i.task_id));
  });
  r.delete('/task-items/:id', requireRole('volunteer'), (req, res) => {
    const i = item(req, req.params.id);
    db.prepare('DELETE FROM task_items WHERE id = ?').run(i.id);
    hooks.taskChanged(i.task_id);
    res.json(full(req, i.task_id));
  });

  // ---------------------------------------------------------------- comments
  r.post('/tasks/:id/comments', requireRole('volunteer'), (req, res) => {
    const { t } = task(req, req.params.id);
    const body = required(req.body?.body, 'Comment').slice(0, 2000);
    db.prepare('INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)').run(t.id, req.user.id, body);
    // The person doing it and the person who gave it hear about comments.
    const to = [userOf(db, t.assignee_id), t.created_by].filter((u) => u && u !== req.user.id);
    notify(db, to, { kind: 'task', title: `${req.user.name} commented on “${t.title}”`, body: body.slice(0, 140), ...links(t.id), tag: `task-${t.id}` });
    hooks.taskChanged(t.id);
    res.status(201).json(full(req, t.id));
  });
  r.delete('/task-comments/:id', requireRole('volunteer'), (req, res) => {
    const k = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(int(req.params.id, 'comment'));
    if (!k) throw notFound('Comment');
    task(req, k.task_id);
    if (k.user_id !== req.user.id) throw forbidden();
    db.prepare('DELETE FROM task_comments WHERE id = ?').run(k.id);
    res.json(full(req, k.task_id));
  });

  return r;
}

// Reminders: "due tomorrow" the morning before, and "due today" that morning, in the time zone
// of the task's team's campus. Tasks made in the last few hours skip the reminder (they were
// just handed out).
export function sendTaskReminders(db) {
  const zones = new Map(db.prepare('SELECT id, timezone FROM campuses').all().map((c) => [c.id, c.timezone]));
  const fallback = db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';
  const rows = db.prepare(`SELECT t.id, t.title, t.due_date, t.due_time, t.assignee_id, t.reminded, t.created_at, tm.campus_id, COALESCE(tm.name, g.name) team
    FROM tasks t LEFT JOIN teams tm ON tm.id = t.team_id LEFT JOIN chats g ON g.id = t.chat_id
    WHERE t.done_at IS NULL AND t.due_date IS NOT NULL AND t.assignee_id IS NOT NULL AND t.reminded < 2 AND t.due_date <= date('now', '+2 days')`).all();
  let sent = 0;
  for (const t of rows) {
    const now = localNow(zones.get(t.campus_id) || fallback);
    const tomorrow = nextDue(now.date, 'daily');
    let stage = 0;
    if (t.due_date < now.date || (t.due_date === now.date && now.time >= '08:00')) stage = 2;
    else if (t.due_date === tomorrow && now.time >= '09:00' && t.reminded < 1) stage = 1;
    if (!stage || stage <= t.reminded) continue;
    db.prepare('UPDATE tasks SET reminded = ? WHERE id = ?').run(stage, t.id);
    if (Date.parse(`${t.created_at.replace(' ', 'T')}Z`) > Date.now() - 6 * 3600e3) continue;
    const uid = userOf(db, t.assignee_id);
    if (!uid) continue;
    const late = t.due_date < now.date;
    const at = t.due_time ? ` at ${new Date(`2000-01-01T${t.due_time}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
    notify(db, [uid], {
      kind: 'task',
      title: late ? `Overdue: ${t.title}` : stage === 2 ? `Due today${at}: ${t.title}` : `Due tomorrow${at}: ${t.title}`,
      body: t.team || 'Your task',
      ...links(t.id),
      tag: `task-${t.id}`,
      ...taskActions(t.id),
    });
    sent++;
  }
  return sent;
}
