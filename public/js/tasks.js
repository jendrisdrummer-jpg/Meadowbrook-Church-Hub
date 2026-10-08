// Tasks, shared by the dashboard and the member app: lists grouped by when they're due, and one
// task with its team, person, due date, service, repeat, checklist and comments.
import { get, post, patch, del, html, mount, icon, avatar, displayName, toast, toastAction, fail, confirm, fmtDate, fmtTime } from './lib.js';

const REPEATS = [['', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']];
const today = () => new Date().toLocaleDateString('en-CA');
const plusDays = (d, n) => { const x = new Date(`${d}T12:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const clock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function bucket(t) {
  const d = today();
  if (!t.due_date) return 'none';
  if (t.due_date < d) return 'late';
  if (t.due_date === d) return 'today';
  if (t.due_date === plusDays(d, 1)) return 'tomorrow';
  if (t.due_date <= plusDays(d, 6)) return 'week';
  return 'later';
}
const BUCKETS = [['late', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['none', 'No due date']];

export function dueLabel(t) {
  if (!t.due_date) return '';
  const b = bucket(t);
  const day = b === 'today' ? 'Today' : b === 'tomorrow' ? 'Tomorrow' : fmtDate(t.due_date, b === 'week' ? { weekday: 'long' } : { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}${t.due_time ? ` ${clock(t.due_time)}` : ''}`;
}

export function taskRow(t, { showWho = true, href = (x) => `#/tasks/${x.id}` } = {}) {
  const late = !t.done_at && bucket(t) === 'late';
  return html`<div class="task-row ${t.done_at ? 'done' : ''}">
    <button type="button" class="task-check ${t.done_at ? 'on' : ''}" data-done="${t.id}" aria-label="${t.done_at ? 'Mark not done' : 'Mark done'}">${icon('check')}</button>
    <a class="task-main" href="${href(t)}"><span class="task-title">${t.title}</span>
      <span class="task-meta">${t.due_date ? html`<span class="${late ? 'late' : ''}">${icon('clock', 'ic small-ic')} ${dueLabel(t)}</span>` : ''}
        ${t.repeat ? html`<span title="Repeats">↻</span>` : ''}
        ${t.team_name ? html`<span><span class="dot" style="background:${t.team_color}"></span> ${t.team_name}</span>` : html`<span>Personal</span>`}
        ${t.items ? html`<span>${icon('check', 'ic small-ic')} ${t.items_done}/${t.items}</span>` : ''}
        ${t.comments ? html`<span>${icon('chat', 'ic small-ic')} ${t.comments}</span>` : ''}
        ${t.service ? html`<span>${icon('calendar', 'ic small-ic')} ${fmtDate(t.service.starts_at)} ${fmtTime(t.service.starts_at)}</span>` : ''}</span></a>
    ${showWho ? (t.assignee ? html`<span class="task-who" title="${displayName(t.assignee)}">${avatar(t.assignee)}</span>` : html`<span class="task-who muted small">Unassigned</span>`) : ''}
  </div>`;
}

// Tick a task from a list; Undo puts it back.
async function toggleDone(id, done, after) {
  const t = await patch(`/tasks/${id}`, { done });
  after();
  if (done) {
    toastAction(t.next_id ? `Done. The next one is due ${dueLabel(await get(`/tasks/${t.next_id}`))}.` : 'Done.', 'Undo', async () => { await patch(`/tasks/${id}`, { done: false }).catch(fail); after(); });
  }
  return t;
}

// ---------------------------------------------------------------- the lists
// q: URLSearchParams from the address (view, team, done). base: '#/tasks'.
export async function taskList(el, { setTitle, q, base = '#/tasks', onChange = () => {} }) {
  const view = ['mine', 'given', 'team'].includes(q.get('view')) ? q.get('view') : 'mine';
  const done = q.get('done') === '1';
  const teams = await get('/tasks/teams');
  const teamId = Number(q.get('team')) || null;
  const link = (o) => {
    const p = new URLSearchParams({ view, ...(teamId ? { team: teamId } : {}), ...(done ? { done: 1 } : {}), ...o });
    for (const [k, v] of [...p]) if (v === '' || v === 'null') p.delete(k);
    if (p.get('view') === 'mine') p.delete('view');
    return `${base}${p.toString() ? `?${p}` : ''}`;
  };
  setTitle('Tasks', html`<a class="btn primary small" href="${base}/new${teamId && view === 'team' ? `?team=${teamId}` : ''}">${icon('plus')} New task</a>`);

  async function draw() {
    const list = await get(`/tasks?view=${view}${view === 'team' && teamId ? `&team_id=${teamId}` : ''}${done ? '&done=1' : ''}`);
    const groups = done ? [['done', 'Finished in the last 60 days', list]] : BUCKETS.map(([k, label]) => [k, label, list.filter((t) => bucket(t) === k)]).filter(([, , ts]) => ts.length);
    const empty = {
      mine: 'Nothing on your list. Tasks people give you show up here, and you can add your own.',
      given: 'Tasks you give to other people show up here, so you can see how they’re going.',
      team: teams.length ? 'No open tasks for this team.' : 'You’re not on a team yet.',
    }[view];
    mount(el, html`<div class="task-filters">
        <div class="seg" role="tablist"><a href="${link({ view: 'mine', team: '' })}" class="${view === 'mine' ? 'on' : ''}">My tasks</a><a href="${link({ view: 'given', team: '' })}" class="${view === 'given' ? 'on' : ''}">I gave out</a>${teams.length ? html`<a href="${link({ view: 'team' })}" class="${view === 'team' ? 'on' : ''}">Teams</a>` : ''}</div>
        ${view === 'team' && teams.length > 1 ? html`<select data-team aria-label="Team"><option value="">All my teams</option>${teams.map((t) => html`<option value="${t.id}" ${t.id === teamId ? 'selected' : ''}>${t.name}</option>`)}</select>` : ''}
        <a class="chip link ${done ? 'on' : ''}" href="${link({ done: done ? '' : '1' })}">${done ? 'Showing finished' : 'Show finished'}</a>
      </div>
      ${groups.length ? groups.map(([k, label, ts]) => html`<div class="task-group ${k}"><h3>${label} <span class="muted">${ts.length}</span></h3>
        <div class="card task-list">${ts.map((t) => taskRow(t, { showWho: view !== 'mine', href: (x) => `${base}/${x.id}` }))}</div></div>`)
        : html`<div class="card empty">${done ? 'Nothing finished lately.' : empty}</div>`}`);
  }

  el.onchange = (e) => { if (e.target.matches('[data-team]')) location.hash = link({ team: e.target.value }); };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-done]');
    if (!b) return;
    b.disabled = true;
    try { await toggleDone(Number(b.dataset.done), !b.classList.contains('on'), () => { draw(); onChange(); }); } catch (err) { fail(err); b.disabled = false; }
  };
  await draw();
}

// ---------------------------------------------------------------- one task
// id: a task id, or 'new' (q may carry team, title, service, due from where it was started).
export async function taskPage(el, id, { setTitle, q, base = '#/tasks', me, onChange = () => {} }) {
  const isNew = id === 'new';
  const teams = await get('/tasks/teams');
  let t = isNew
    ? { title: q.get('title') || '', notes: '', team_id: Number(q.get('team')) || null, assignee_id: q.get('team') ? null : me, due_date: q.get('due') || '', due_time: '', repeat: '', service_id: Number(q.get('service')) || null, checklist: [], thread: [], can_edit: true }
    : await get(`/tasks/${id}`);
  if (isNew && t.team_id && !teams.some((x) => x.id === t.team_id)) t.team_id = null;
  setTitle(isNew ? 'New task' : 'Task', html`<a class="btn small ghost" href="${base}">${icon('back')} Tasks</a>`);
  let services = [];

  async function loadServices() {
    const campus = teams.find((x) => x.id === t.team_id)?.campus_id;
    const from = today();
    services = await get(`/services?all=1&from=${from}&to=${plusDays(from, 70)}${campus ? `&campus_id=${campus}` : ''}`).catch(() => []);
    if (t.service_id && !services.some((s) => s.id === t.service_id) && t.service) services.unshift({ id: t.service_id, starts_at: t.service.starts_at, campus_short: t.service.campus, title: t.service.title });
  }

  function draw() {
    const team = teams.find((x) => x.id === t.team_id);
    const people = team ? team.members : [];
    const doneCount = t.checklist.filter((i) => i.done).length;
    mount(el, html`<form class="card task-detail" data-form autocomplete="off">
        <div class="task-top">
          ${isNew ? '' : html`<button type="button" class="task-check big ${t.done_at ? 'on' : ''}" data-toggle-done aria-label="${t.done_at ? 'Mark not done' : 'Mark done'}">${icon('check')}</button>`}
          <textarea name="title" rows="1" class="task-title-input" placeholder="What needs doing?" maxlength="200" required>${t.title}</textarea>
        </div>
        ${t.done_at ? html`<div class="alert good small" style="margin:0 0 12px">Done ${fmtDate(t.done_at.slice(0, 10))}.</div>` : ''}
        <div class="form task-fields">
          <label class="field">Team<select name="team_id"><option value="">Personal (just me)</option>${teams.map((x) => html`<option value="${x.id}" ${x.id === t.team_id ? 'selected' : ''}>${x.name}</option>`)}</select></label>
          <label class="field">Assigned to<select name="assignee_id" ${team ? '' : 'disabled'}>
            ${team ? html`<option value="">Unassigned</option>${people.map((p) => html`<option value="${p.id}" ${p.id === t.assignee_id ? 'selected' : ''}>${displayName(p)}${p.id === me ? ' (me)' : ''}</option>`)}` : html`<option>Me</option>`}</select></label>
          <label class="field">Due<span class="row nowrap" style="gap:6px"><input type="date" name="due_date" value="${t.due_date || ''}"><input type="time" name="due_time" value="${t.due_time || ''}" ${t.due_date ? '' : 'disabled'} aria-label="Time (optional)"></span></label>
          <label class="field">Repeats<select name="repeat">${REPEATS.map(([v, l]) => html`<option value="${v}" ${v === (t.repeat || '') ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field wide">For a service (optional)<select name="service_id"><option value="">None</option>${services.map((s) => html`<option value="${s.id}" ${s.id === t.service_id ? 'selected' : ''}>${fmtDate(s.starts_at)} · ${fmtTime(s.starts_at)} · ${s.campus_short || s.campus_name || ''}${s.title ? ` · ${s.title}` : ''}</option>`)}</select></label>
          <label class="field wide">Notes<textarea name="notes" rows="3" placeholder="Details, links, anything that helps">${t.notes}</textarea></label>
        </div>
        ${!isNew && t.created_by_name ? html`<p class="muted small" style="margin:10px 0 0">Added by ${t.created_by_name} · ${fmtDate(t.created_at.slice(0, 10))}${t.repeat ? ' · when it’s done, the next one is made' : ''}</p>` : ''}
      </form>
      <div class="card"><div class="card-head"><h2>Checklist</h2>${t.checklist.length ? html`<span class="muted small">${doneCount} of ${t.checklist.length}</span>` : ''}</div>
        ${t.checklist.length ? html`<div class="task-steps">${t.checklist.map((i, n) => html`<div class="task-step ${i.done ? 'done' : ''}">
          <input type="checkbox" data-step="${i.id ?? n}" ${i.done ? 'checked' : ''} aria-label="Done">
          <input type="text" class="task-step-text" data-step-text="${i.id ?? n}" value="${i.text}" maxlength="300" aria-label="Step">
          <button type="button" class="icon-btn" data-unstep="${i.id ?? n}" aria-label="Remove step">${icon('x')}</button></div>`)}</div>` : ''}
        <input type="text" data-new-step placeholder="Add a step, then press Enter" maxlength="300" class="task-new-step"></div>
      ${isNew ? html`<div class="row" style="margin-top:14px"><span class="spacer"></span><a class="btn ghost" href="${base}">Cancel</a><button class="btn primary" data-create>${icon('check')} Create task</button></div>`
        : html`<div class="card"><h2>Comments</h2>
          ${t.thread.length ? html`<div class="task-thread">${t.thread.map((k) => html`<div class="task-comment">${avatar({ first_name: k.name.split(' ')[0], last_name: k.name.split(' ').slice(1).join(' '), photo: k.photo })}
            <div class="grow"><div><b>${k.name}</b> <span class="muted small">${new Date(`${k.created_at.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            ${k.mine ? html`<button type="button" class="icon-btn" data-uncomment="${k.id}" aria-label="Delete comment">${icon('trash')}</button>` : ''}</div>
            <div class="task-comment-body">${k.body}</div></div></div>`)}</div>` : html`<p class="muted small">No comments yet. Ask a question or give an update.</p>`}
          <form class="task-comment-form" data-comment><textarea name="body" rows="2" placeholder="Write a comment" required maxlength="2000"></textarea><button class="btn">Post</button></form></div>
          ${t.can_delete ? html`<div class="row" style="margin-top:14px"><span class="spacer"></span><button type="button" class="btn danger ghost small" data-delete>${icon('trash')} Delete task</button></div>` : ''}`}`);
    const title = el.querySelector('.task-title-input');
    const grow = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
    grow();
    title.addEventListener('input', grow);
    if (isNew && !t.title) title.focus();
  }

  // Saved as soon as something changes (new tasks wait for Create).
  async function save(field, value) {
    if (isNew) { t[field] = value; return; }
    try { t = { ...t, ...(await patch(`/tasks/${t.id}`, { [field]: value })) }; onChange(); } catch (err) { fail(err); }
  }

  el.addEventListener('change', async (e) => {
    const f = e.target;
    if (f.dataset.step !== undefined) {
      const key = f.dataset.step;
      if (isNew) { t.checklist[key].done = f.checked ? 1 : 0; return draw(); }
      t = await patch(`/task-items/${key}`, { done: f.checked }).catch(fail) || t;
      return draw();
    }
    if (f.dataset.stepText !== undefined) {
      const key = f.dataset.stepText;
      if (!f.value.trim()) return draw();
      if (isNew) { t.checklist[key].text = f.value; return; }
      t = await patch(`/task-items/${key}`, { text: f.value }).catch(fail) || t;
      return;
    }
    if (!f.name || f.closest('[data-comment]')) return;
    const v = ['team_id', 'assignee_id', 'service_id'].includes(f.name) ? (Number(f.value) || null) : f.value;
    if (f.name === 'title' && !v.trim()) { f.value = t.title; return; }
    await save(f.name, v);
    if (f.name === 'team_id') {
      if (isNew) t.assignee_id = null;
      await loadServices();
    }
    if (['team_id', 'due_date', 'assignee_id'].includes(f.name) || isNew) draw();
  });

  el.addEventListener('keydown', async (e) => {
    if (e.target.matches('[data-new-step]') && e.key === 'Enter') {
      e.preventDefault();
      const text = e.target.value.trim();
      if (!text) return;
      if (isNew) t.checklist.push({ text, done: 0 });
      else t = await post(`/tasks/${t.id}/checklist`, { text }).catch(fail) || t;
      draw();
      el.querySelector('[data-new-step]').focus();
    }
    if (e.target.matches('.task-title-input') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.matches('[data-comment]')) {
      const body = e.target.body.value.trim();
      if (!body) return;
      try { t = await post(`/tasks/${t.id}/comments`, { body }); draw(); } catch (err) { fail(err); }
    }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-create]')) {
        e.preventDefault();
        const f = el.querySelector('[data-form]');
        t.title = f.title.value.trim();
        t.notes = f.notes.value;
        if (!t.title) { f.title.focus(); return toast('Say what needs doing.'); }
        const pending = el.querySelector('[data-new-step]').value.trim();
        const made = await post('/tasks', {
          title: t.title, notes: t.notes, team_id: t.team_id, ...(t.team_id ? { assignee_id: t.assignee_id } : {}), due_date: t.due_date || null,
          due_time: t.due_time || null, repeat: t.repeat, service_id: t.service_id, checklist: [...t.checklist.map((i) => i.text), ...(pending ? [pending] : [])],
        });
        onChange();
        toast(made.assignee && made.assignee_id !== me ? `Sent to ${displayName(made.assignee)}.` : 'Task added.');
        location.replace(`${base}/${made.id}`);
        return;
      }
      if (b.matches('[data-toggle-done]')) {
        const r = await patch(`/tasks/${t.id}`, { done: !t.done_at });
        t = { ...t, ...r };
        onChange();
        if (r.next_id) toast(`Done. The next one is due ${dueLabel(await get(`/tasks/${r.next_id}`))}.`);
        return draw();
      }
      if (b.dataset.unstep !== undefined) {
        if (isNew) t.checklist.splice(Number(b.dataset.unstep), 1);
        else t = await del(`/task-items/${b.dataset.unstep}`);
        return draw();
      }
      if (b.dataset.uncomment) { t = await del(`/task-comments/${b.dataset.uncomment}`); return draw(); }
      if (b.matches('[data-delete]')) {
        if (!(await confirm('Delete this task?', 'Its checklist and comments go too.'))) return;
        await del(`/tasks/${t.id}`);
        onChange();
        location.hash = base;
      }
    } catch (err) { fail(err); }
  });

  await loadServices();
  draw();
}
