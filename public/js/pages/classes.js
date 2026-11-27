// Classes (Life Group Training and the like): staff build a class from steps, enrol people and see
// how everyone is getting on. Class managers (named by staff) get the roster and attendance only.
import { get, post, patch, del, html, mount, icon, options, toast, fail, confirm, dialog, formData, fmtDate, pickPerson, displayName, debounce } from '../lib.js';
import { state, setTitle, go, visibleCampuses } from '../app.js';

const KIND = { session: 'Session', video: 'Video', quiz: 'Quiz' };
const KIND_ICON = { session: 'calendar', video: 'play', quiz: 'check' };
const UNLISTED = html`Upload the recording to YouTube as <b>Unlisted</b> (not Public), then paste its address here. Unlisted videos stay out of searches, but anyone who has the link can watch them.`;

export default async function classes(el, id, tab, stepId) {
  if (!id) return list(el);
  return classPage(el, Number(id), tab || 'roster', stepId ? Number(stepId) : null);
}

// ---------------------------------------------------------------- the list
async function list(el) {
  const staff = state.me.role === 'staff' || state.me.role === 'admin';
  setTitle('Classes', staff ? html`<button class="btn primary" data-new>${icon('plus')} New class</button>` : '');
  const all = (await get('/classes')).filter((c) => !state.campusId || !c.campus_id || c.campus_id === state.campusId);
  const row = (c) => html`<tr class="clickable" data-id="${c.id}">
    <td><b>${c.title}</b><br><span class="muted small">${c.campus || 'All campuses'}${c.archived ? ' · Archived' : ''}</span></td>
    <td>${c.steps} ${c.steps === 1 ? 'step' : 'steps'}</td>
    <td><b>${c.completed}</b> of ${c.enrolled} finished</td></tr>`;
  mount(el, html`<p class="muted" style="margin-top:-6px">A class is a few steps: come to a session, watch a video, take a quiz. Add people, and see who has done what.</p>
    ${all.length ? html`<div class="card table-scroll"><table class="list"><thead><tr><th>Class</th><th>Steps</th><th>Finished</th></tr></thead><tbody>${all.map(row)}</tbody></table></div>`
      : html`<div class="card empty">${staff ? 'No classes yet. Make the first one with “New class”.' : 'You aren’t looking after any classes yet.'}</div>`}`);
  const open = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go(`/classes/${tr.dataset.id}`); };
  el.onclick = open;
  document.querySelector('[data-actions] [data-new]')?.addEventListener('click', () => editClass(null).then((made) => made && go(`/classes/${made.id}`)));
}

// New class, or its title, words and campus.
function editClass(c) {
  const limited = Boolean(state.me.campusIds);
  return dialog({
    title: c ? 'Class details' : 'New class',
    submit: c ? 'Save' : 'Create class',
    body: html`<label class="field">Name<input type="text" name="title" maxlength="140" required value="${c?.title || ''}" placeholder="Life Group Training"></label>
      <label class="field">A few kind words about it<textarea name="description" rows="3" maxlength="2000">${c?.description || ''}</textarea></label>
      <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((x) => ({ value: x.id, label: x.name })), c ? c.campus_id : limited ? state.campusId || state.me.campusIds[0] : '', limited ? {} : { blank: 'All campuses (church-wide)' })}</select></label>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const body = { title: d.title, description: d.description, campus_id: d.campus_id ? Number(d.campus_id) : null };
      if (c) { await patch(`/classes/${c.id}`, body); return { id: c.id }; }
      return post('/classes', body);
    },
  });
}

// ---------------------------------------------------------------- one class
async function classPage(el, id, tab, stepId) {
  let c;
  try { c = await get(`/classes/${id}`); } catch {
    setTitle('Classes');
    return mount(el, html`<div class="card empty">That class isn’t one you can open. <a href="#/classes">See your classes</a>.</div>`);
  }
  const tabs = c.can_manage ? [['roster', 'Roster'], ['steps', 'Steps'], ['people', 'People'], ['managers', 'Managers'], ['details', 'Details']] : [['roster', 'Roster']];
  if (!tabs.some(([k]) => k === tab) && tab !== 'attendance') tab = 'roster';
  setTitle(c.title, html`<a class="btn ghost" href="#/classes">All classes</a>`);
  const frame = (inner) => html`${c.archived ? html`<div class="alert">This class is archived. People keep their records; nothing new can be added.</div>` : ''}
    <div class="tabs">${tabs.map(([k, label]) => html`<a class="${tab === k ? 'on' : ''}" href="#/classes/${id}/${k}" style="text-decoration:none">${label}</a>`)}</div>${inner}`;
  const redraw = () => classPage(el, id, tab, stepId);
  if (tab === 'attendance') return attendance(el, c, stepId, frame);
  if (tab === 'steps') return stepsTab(el, c, frame, redraw);
  if (tab === 'people') return peopleTab(el, c, frame, redraw);
  if (tab === 'managers') return managersTab(el, c, frame, redraw);
  if (tab === 'details') return detailsTab(el, c, frame, redraw);
  return rosterTab(el, c, frame, redraw);
}

// ---------------------------------------------------------------- roster
function cell(s, g) {
  if (!g) return html`<span class="muted">—</span>`;
  if (g.state === 'done') {
    const label = { attended: 'Here', makeup: 'Make-up done', watched: 'Watched', passed: g.score != null ? `Passed ${g.score}%` : 'Passed', manual: 'Done' }[g.method] || 'Done';
    return html`<span class="pill good">${icon('check')} ${label}</span>`;
  }
  if (g.method === 'absent') return html`<span class="pill warn">Absent</span>`;
  if (g.score != null) return html`<span class="pill info">${g.score}% so far</span>`;
  return html`<span class="pill info">${s.kind === 'video' ? 'Watching' : 'Started'}</span>`;
}

async function rosterTab(el, c, frame, redraw) {
  const r = await get(`/classes/${c.id}/roster`);
  const when = (s) => (s.starts_on ? fmtDate(s.starts_on, { month: 'short', day: 'numeric' }) : '');
  const body = r.people.length ? html`<div class="card table-scroll"><table class="list class-roster"><thead><tr><th>Name</th>
      ${r.steps.map((s) => html`<th>${s.title}<br><span class="muted small" style="text-transform:none;letter-spacing:0">${KIND[s.kind]}${when(s) ? ` · ${when(s)}` : ''}</span>${s.kind === 'session' ? html`<br><a class="small" href="#/classes/${c.id}/attendance/${s.id}" style="text-transform:none;letter-spacing:0">Take attendance</a>` : ''}</th>`)}
      <th>Class</th></tr></thead>
    <tbody>${r.people.map((p) => html`<tr><td><b>${p.name}</b></td>${r.steps.map((s) => html`<td>${cell(s, p.steps[s.id])}</td>`)}
      <td>${p.completion ? html`<span class="pill good">${icon('check')} Finished</span>${r.can_manage ? html`<br><button class="btn small ghost" data-undo="${p.completion.id}" data-name="${p.name}">Undo</button>` : ''}`
        : r.can_manage ? html`<button class="btn small ghost" data-finish="${p.person_id}" data-name="${p.name}">Mark finished</button>` : html`<span class="muted small">Not yet</span>`}</td></tr>`)}</tbody></table></div>
    <p class="muted small">Scores and attendance are shown to staff and this class’s managers only.</p>`
    : html`<div class="card empty">${r.can_manage ? 'No one is in this class yet. Add people on the People tab.' : 'No one has been added to this class yet.'}</div>`;
  mount(el, frame(body));
  el.onclick = async (e) => {
    const f = e.target.closest('[data-finish]');
    const u = e.target.closest('[data-undo]');
    try {
      if (f) {
        const ok = await dialog({ title: `Mark ${f.dataset.name} as finished`, submit: 'Mark finished', body: html`<label class="field">Why? (kept in the record)<textarea name="note" rows="3" maxlength="500" required placeholder="For example: did this in person with Pastor Lee"></textarea></label>`,
          onSubmit: (form) => post(`/classes/${c.id}/complete`, { person_id: Number(f.dataset.finish), note: formData(form).note }) });
        if (ok) { toast('Marked as finished.'); redraw(); }
      }
      if (u && await confirm('Undo finished?', `${u.dataset.name} will show as not finished again. The record of it stays.`, 'Undo', { danger: false })) {
        await post(`/classes/${c.id}/completions/${u.dataset.undo}/revoke`, {});
        redraw();
      }
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- attendance
async function attendance(el, c, stepId, frame) {
  const r = await get(`/classes/${c.id}/roster`);
  const step = r.steps.find((s) => s.id === stepId && s.kind === 'session');
  if (!step) return mount(el, frame(html`<div class="card empty">Pick a session from the roster to take attendance.</div>`));
  const was = Object.fromEntries(r.people.map((p) => [p.person_id, p.steps[step.id]?.method === 'attended' ? true : p.steps[step.id]?.method === 'absent' ? false : null]));
  const now = { ...was };
  setTitle(`${c.title}: ${step.title}`, html`<a class="btn ghost" href="#/classes/${c.id}/roster">Back to roster</a>`);
  const draw = () => {
    const here = Object.values(now).filter((v) => v === true).length;
    mount(el, frame(html`<div class="card stack">
      <div class="row"><b>${step.title}</b>${step.starts_on ? html`<span class="muted">${fmtDate(step.starts_on)}</span>` : ''}<span class="spacer"></span><span class="pill ${here ? 'good' : ''}">${here} here</span>
        <button class="btn small" data-all>Mark everyone here</button></div>
      ${r.people.length ? html`<div class="att-list">${r.people.map((p) => html`<div class="att-row"><span class="grow"><b>${p.name}</b></span>
        <span class="seg" role="group" aria-label="${p.name}"><button type="button" data-set="${p.person_id}:true" aria-pressed="${now[p.person_id] === true}" class="${now[p.person_id] === true ? 'on' : ''}">Here</button><button type="button" data-set="${p.person_id}:false" aria-pressed="${now[p.person_id] === false}" class="${now[p.person_id] === false ? 'on' : ''}">Absent</button></span></div>`)}</div>`
        : html`<p class="muted">No one is in this class yet.</p>`}
      <p class="muted small" style="margin:0">Anyone marked absent gets a note that their make-up is ready${step.has_makeup ? '' : ' (this session has no make-up set up yet, so staff will need to follow up)'}. Tap a choice again to clear it.</p>
      <div><button class="btn primary" data-save>Save attendance</button></div></div>`));
  };
  draw();
  el.onclick = async (e) => {
    const s = e.target.closest('[data-set]');
    if (s) { const [pid, v] = s.dataset.set.split(':'); now[pid] = now[pid] === (v === 'true') ? null : v === 'true'; return draw(); }
    if (e.target.closest('[data-all]')) { for (const p of r.people) now[p.person_id] = true; return draw(); }
    if (e.target.closest('[data-save]')) {
      try {
        for (const value of [true, false, null]) {
          const person_ids = r.people.map((p) => p.person_id).filter((pid) => now[pid] === value && was[pid] !== value);
          if (person_ids.length) await post(`/classes/${c.id}/steps/${step.id}/attendance`, { person_ids, present: value });
        }
        toast('Attendance saved.');
        go(`/classes/${c.id}/roster`);
      } catch (err) { fail(err); }
    }
  };
}

// ---------------------------------------------------------------- steps
async function stepsTab(el, c, frame, redraw) {
  const steps = c.steps;
  const line = (s) => {
    const bits = s.kind === 'session' ? [s.starts_on ? fmtDate(s.starts_on) : 'No date yet', s.makeup_video_id || s.makeup_questions.length ? 'Make-up ready' : 'No make-up']
      : s.kind === 'video' ? [s.video_title || 'YouTube video', s.video_sec ? `${Math.round(s.video_sec / 60)} min` : ''] : [`${s.questions.length} ${s.questions.length === 1 ? 'question' : 'questions'}`];
    return bits.filter(Boolean).join(' · ');
  };
  mount(el, frame(html`<div class="card stack">
    ${steps.length ? steps.map((s, i) => html`<div class="step-row ${s.archived ? 'muted' : ''}"><span class="step-ic">${icon(KIND_ICON[s.kind])}</span>
      <span class="grow"><b>${s.title}</b>${s.archived ? html` <span class="pill">Retired</span>` : ''}<br><span class="muted small">${KIND[s.kind]} · ${line(s)}</span></span>
      ${s.archived ? '' : html`<span class="row" style="gap:2px;flex-wrap:nowrap"><button class="icon-btn" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn" data-down="${i}" aria-label="Move down" ${i < steps.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
        <button class="icon-btn" data-edit="${s.id}" aria-label="Edit ${s.title}">${icon('edit')}</button><button class="icon-btn" data-del="${s.id}" aria-label="Remove ${s.title}">${icon('x')}</button></span>`}</div>`)
      : html`<p class="muted" style="margin:0">No steps yet. Add the first one below.</p>`}
    <div class="row"><button class="btn" data-add="session">${icon('calendar')} Add a session</button><button class="btn" data-add="video">${icon('play')} Add a video</button><button class="btn" data-add="quiz">${icon('check')} Add a quiz</button></div>
    <p class="muted small" style="margin:0">People finish the class when every step is done. A step with history is retired, never lost.</p></div>`));
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      const live = steps.filter((s) => !s.archived);
      const move = async (i, d) => { const ids = live.map((s) => s.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await post(`/classes/${c.id}/steps/reorder`, { ids: [...ids, ...steps.filter((s) => s.archived).map((s) => s.id)] }); redraw(); };
      if (b.dataset.up !== undefined) return move(Number(b.dataset.up), -1);
      if (b.dataset.down !== undefined) return move(Number(b.dataset.down), 1);
      if (b.dataset.add) { if (await stepDialog(c, b.dataset.add, null)) redraw(); return; }
      if (b.dataset.edit) { if (await stepDialog(c, null, steps.find((s) => s.id === Number(b.dataset.edit)))) redraw(); return; }
      if (b.dataset.del) {
        const s = steps.find((x) => x.id === Number(b.dataset.del));
        if (await confirm('Remove this step?', `“${s.title}” will be taken out of the class. If anyone has already done it, it’s kept in the records.`, 'Remove')) { await del(`/classes/${c.id}/steps/${s.id}`); redraw(); }
      }
    } catch (err) { fail(err); }
  };
}

// A quiz builder: questions with 2 to 6 answers, and a tick on each right one.
function questionEditor(box, initial) {
  const qs = structuredClone(initial);
  const read = () => box.querySelectorAll('[data-q]').forEach((row, i) => {
    const q = qs[i];
    q.text = row.querySelector('[data-text]').value;
    q.choices = [...row.querySelectorAll('[data-choice]')].map((x) => x.value);
    q.correct = [...row.querySelectorAll('[data-right]')].flatMap((x, k) => (x.checked ? [k] : []));
  });
  const draw = () => mount(box, html`${qs.map((q, i) => html`<div class="q-card" data-q="${i}">
      <div class="row"><b>Question ${i + 1}</b><span class="spacer"></span><button type="button" class="icon-btn" data-delq="${i}" aria-label="Remove question ${i + 1}">${icon('x')}</button></div>
      <input type="text" data-text value="${q.text}" maxlength="300" placeholder="What would you like to ask?" aria-label="Question ${i + 1}">
      ${q.choices.map((ch, k) => html`<div class="row q-choice"><label class="check" title="This is a right answer"><input type="checkbox" data-right ${q.correct.includes(k) ? 'checked' : ''} aria-label="Answer ${k + 1} is right"></label>
        <input type="text" data-choice value="${ch}" maxlength="150" placeholder="Answer ${k + 1}" aria-label="Answer ${k + 1}" style="flex:1">
        <button type="button" class="icon-btn" data-delc="${i}:${k}" aria-label="Remove answer ${k + 1}" ${q.choices.length <= 2 ? 'disabled' : ''}>${icon('x')}</button></div>`)}
      ${q.choices.length < 6 ? html`<div><button type="button" class="btn small ghost" data-addc="${i}">${icon('plus')} Add an answer</button></div>` : ''}
      <p class="muted small" style="margin:0">Tick the right answer. Tick more than one if people must choose them all.</p></div>`)}
    ${qs.length < 30 ? html`<div><button type="button" class="btn small" data-addq>${icon('plus')} Add a question</button></div>` : ''}`);
  draw();
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    read();
    if (b.matches('[data-addq]')) qs.push({ id: `q${Date.now().toString(36)}`, text: '', choices: ['', ''], correct: [] });
    else if (b.dataset.delq !== undefined) qs.splice(Number(b.dataset.delq), 1);
    else if (b.dataset.addc !== undefined) qs[Number(b.dataset.addc)].choices.push('');
    else if (b.dataset.delc !== undefined) {
      const [i, k] = b.dataset.delc.split(':').map(Number);
      qs[i].choices.splice(k, 1);
      qs[i].correct = qs[i].correct.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x));
    } else return;
    draw();
  };
  return { get: () => { read(); return qs; } };
}

function stepDialog(c, kind, s) {
  kind = s ? s.kind : kind;
  let quiz;
  let makeup;
  return dialog({
    title: `${s ? 'Edit' : 'Add'} ${KIND[kind].toLowerCase() === 'quiz' ? 'a quiz' : KIND[kind].toLowerCase() === 'video' ? 'a video' : 'a session'}`,
    wide: true,
    submit: s ? 'Save step' : 'Add step',
    body: html`<label class="field">Title<input type="text" name="title" maxlength="140" required value="${s?.title || ''}" placeholder="${{ session: 'Week 1: Welcome', video: 'Watch: Caring for your group', quiz: 'Check what you remember' }[kind]}"></label>
      <label class="field">Words for the person (optional)<textarea name="body" rows="2" maxlength="4000">${s?.body || ''}</textarea></label>
      ${kind === 'session' ? html`<label class="field">Date of the session<input type="date" name="starts_on" value="${s?.starts_on || ''}"></label>
        <h3 style="margin:8px 0 0">Make-up for anyone who misses it</h3>
        <p class="muted small" style="margin:0">If someone is marked absent, or the date passes without them being marked here, they can watch the recording and take a short test instead.</p>
        <label class="field">Recording on YouTube<input type="url" name="makeup_video" value="${s?.makeup_video_id ? `https://youtu.be/${s.makeup_video_id}` : ''}" placeholder="https://youtu.be/…"><span class="muted small">${UNLISTED}</span></label>
        <div class="field"><span>Make-up test (optional)</span><div data-makeup class="stack"></div></div>` : ''}
      ${kind === 'video' ? html`<label class="field">Video on YouTube<input type="url" name="video" required value="${s?.video_id ? `https://youtu.be/${s.video_id}` : ''}" placeholder="https://youtu.be/…"><span class="muted small">${UNLISTED}</span></label>` : ''}
      ${kind === 'quiz' ? html`<div class="field"><span>Questions</span><div data-quiz class="stack"></div><span class="muted small">People pass with 80% right. They can try as many times as they like.</span></div>` : ''}`,
    onOpen: (d) => {
      if (kind === 'quiz') quiz = questionEditor(d.querySelector('[data-quiz]'), s?.questions || [{ id: 'q1', text: '', choices: ['', ''], correct: [] }]);
      if (kind === 'session') makeup = questionEditor(d.querySelector('[data-makeup]'), s?.makeup_questions || []);
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const body = { kind, title: d.title, body: d.body };
      if (kind === 'session') Object.assign(body, { starts_on: d.starts_on || null, makeup_video: d.makeup_video, makeup_questions: makeup.get() });
      if (kind === 'video') body.video = d.video;
      if (kind === 'quiz') body.questions = quiz.get();
      return s ? patch(`/classes/${c.id}/steps/${s.id}`, body) : post(`/classes/${c.id}/steps`, body);
    },
  });
}

// ---------------------------------------------------------------- people
async function peopleTab(el, c, frame, redraw) {
  const r = await get(`/classes/${c.id}/roster`);
  mount(el, frame(html`<div class="card stack"><div class="row"><b>${r.people.length} ${r.people.length === 1 ? 'person' : 'people'}</b><span class="spacer"></span><button class="btn primary" data-add>${icon('plus')} Add a person</button></div>
    ${r.people.length ? html`<table class="list pair"><tbody>${r.people.map((p) => html`<tr><td><a href="#/people/${p.person_id}"><b>${p.name}</b></a>${p.completion ? html`<br><span class="muted small">Finished ${fmtDate(p.completion.completed_at)}</span>` : ''}</td>
      <td style="text-align:right"><button class="btn small ghost" data-remove="${p.person_id}" data-name="${p.name}">Remove</button></td></tr>`)}</tbody></table>` : html`<p class="muted" style="margin:0">No one yet. Search for people to add them.</p>`}
    <p class="muted small" style="margin:0">Only staff add people. Removing someone keeps their record.</p></div>`));
  el.onclick = async (e) => {
    try {
      if (e.target.closest('[data-add]')) {
        const p = await pickPerson('Add a person to this class');
        if (p) { const out = await post(`/classes/${c.id}/enrol`, { person_ids: [p.id] }); toast(out.added ? `${displayName(p)} was added.` : `${displayName(p)} is already in this class.`); redraw(); }
      }
      const rm = e.target.closest('[data-remove]');
      if (rm && await confirm('Remove from this class?', `${rm.dataset.name} will no longer see this class. Their progress is kept if they’re added again.`, 'Remove')) { await del(`/classes/${c.id}/enrolments/${rm.dataset.remove}`); redraw(); }
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- managers
function managersTab(el, c, frame, redraw) {
  mount(el, frame(html`<div class="card stack"><div class="row"><b>Class managers</b><span class="spacer"></span><button class="btn primary" data-add>${icon('plus')} Add a manager</button></div>
    <p class="muted small" style="margin:0">A manager (for example the Life Group leader) can see this class’s roster and scores and take attendance. They can’t add people or see any other class.</p>
    ${c.managers.length ? html`<table class="list pair"><tbody>${c.managers.map((m) => html`<tr><td><b>${m.name}</b><br><span class="muted small">${m.role}</span></td><td style="text-align:right"><button class="btn small ghost" data-remove="${m.id}" data-name="${m.name}">Remove</button></td></tr>`)}</tbody></table>`
      : html`<p class="muted" style="margin:0">No managers yet.</p>`}</div>`));
  el.onclick = async (e) => {
    try {
      if (e.target.closest('[data-add]')) {
        let chosen;
        await dialog({
          title: 'Add a class manager', submit: null,
          body: html`<input type="search" placeholder="Search by name" data-q><div class="picker-list" data-list><div class="muted small">Start typing…</div></div>`,
          onOpen: (d, close) => {
            const list = d.querySelector('[data-list]');
            let rows = [];
            const run = debounce(async (q) => {
              if (q.trim().length < 2) return;
              rows = await get(`/classes/manager-options?q=${encodeURIComponent(q)}`);
              mount(list, rows.length ? rows.map((u, i) => html`<button type="button" data-i="${i}"><span>${u.name}<br><small class="muted">${u.role}</small></span></button>`) : html`<div class="muted small">No one with an account was found.</div>`);
            });
            d.querySelector('[data-q]').addEventListener('input', (ev) => run(ev.target.value));
            list.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-i]'); if (b) { chosen = rows[b.dataset.i]; close(chosen); } });
          },
        });
        if (chosen) { await post(`/classes/${c.id}/managers`, { user_id: chosen.id }); toast(`${chosen.name} can now look after this class.`); redraw(); }
      }
      const rm = e.target.closest('[data-remove]');
      if (rm && await confirm('Remove this manager?', `${rm.dataset.name} will no longer see this class.`, 'Remove')) { await del(`/classes/${c.id}/managers/${rm.dataset.remove}`); redraw(); }
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- details
function detailsTab(el, c, frame, redraw) {
  mount(el, frame(html`<div class="card stack"><div><b>${c.title}</b><br><span class="muted">${c.campus || 'All campuses'}</span></div>${c.description ? html`<p style="margin:0;white-space:pre-line">${c.description}</p>` : ''}
    <div class="row"><button class="btn" data-edit>${icon('edit')} Change name or campus</button>
      <button class="btn ${c.archived ? '' : 'danger'}" data-archive>${c.archived ? 'Bring this class back' : 'Archive this class'}</button></div>
    <p class="muted small" style="margin:0">Archiving hides the class from people but keeps every record.</p></div>`));
  el.onclick = async (e) => {
    try {
      if (e.target.closest('[data-edit]') && await editClass(c)) redraw();
      if (e.target.closest('[data-archive]')) {
        if (c.archived || await confirm('Archive this class?', 'People won’t see it any more, and no one can be added. All records are kept, and you can bring it back.', 'Archive')) {
          await post(`/classes/${c.id}/archive`, { archived: !c.archived });
          redraw();
        }
      }
    } catch (err) { fail(err); }
  };
}
