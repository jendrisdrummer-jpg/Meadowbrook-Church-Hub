// Bible studies: for coordinators and staff. What's going on (tiles), who is waiting for a teacher,
// every study, who teaches, and the approved materials. Studies are personal and mostly one-on-one,
// so this page is the only place they show up; nobody else sees who studies with whom.
import { get, post, patch, del, html, mount, icon, dialog, formData, options, toast, fail, confirm, fmtDate, debounce, $ } from '../lib.js';
import { state, can, setTitle, visibleCampuses, hashQuery } from '../app.js';

const FORMATS = { one_on_one: 'One-on-one', small_group: 'Small group', either: 'One-on-one or a small group' };
const STATUS = { active: 'Active', paused: 'Paused', finished: 'Finished' };
const TABS = [['waiting', 'Waiting'], ['studies', 'Studies'], ['teachers', 'Teachers'], ['materials', 'Materials']];
const NOTE_MAX = 280;

// How far along a study is, in plain words. Every number is optional.
export function progressText(p) {
  if (p.lesson != null) return p.planned ? `Lesson ${p.lesson} of ${p.planned}` : `Lesson ${p.lesson}`;
  if (p.sessions) return `${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}`;
  const since = p.since ? new Date(`${p.since}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  return since ? `Active since ${since}` : 'Active';
}

// A person's name, linked to their page only for people who can open People (leaders and up).
const who = (p) => (can('leader') ? html`<a href="#/people/${p.id}">${p.name}</a>` : html`${p.name}`);

// Teachers should have an account so they can update their own study. This asks the coordinator to
// invite them; setting one up is an admin's job (Settings or the person's page), so others are pointed to an admin.
function invite(list) {
  if (!list?.length) return '';
  return html`<div class="alert" style="margin-top:12px"><b>${list.map((t) => t.name).join(', ')}</b> ${list.length === 1 ? 'doesn’t' : 'don’t'} have an account yet.
    Teachers do best with one, so they can update their own study. ${can('admin')
      ? html`Open ${list.length === 1 ? 'their page' : 'their pages'} and choose “Give more access” to invite them: ${list.map((t) => html`<a href="#/people/${t.id}">${t.name}</a> `)}`
      : 'Ask an admin to set one up. Until then you can keep their study up to date for them.'}</div>`;
}

export default async function studies(el) {
  let tab = TABS.some(([k]) => k === hashQuery().get('tab')) ? hashQuery().get('tab') : 'studies';
  const filters = { status: '', campus: '', group: 'teacher' };
  let year = String(new Date().getFullYear());
  let summary;

  setTitle('Bible studies', html`<button class="btn primary" data-new>${icon('plus')} New study</button>`);
  document.querySelector('[data-new]').onclick = async () => { if (await studyForm()) refresh(); };

  async function refresh() {
    summary = await get('/studies/summary');
    draw();
  }

  async function draw() {
    const tile = (n, label, to) => html`<button type="button" class="stat" style="text-align:left;cursor:pointer;font:inherit;color:inherit" data-go="${to}"><b>${n}</b><span>${label}</span></button>`;
    mount(el, html`<div class="stats">
        ${tile(summary.active, 'Active studies', 'studies:active')}${tile(summary.paused, 'Paused', 'studies:paused')}
        ${tile(summary.finished_this_year, 'Finished this year', 'studies:finished')}${tile(summary.waiting, 'Waiting for a match', 'waiting')}</div>
      <div class="tabs" role="tablist">${TABS.map(([k, label]) => html`<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-tab="${k}">${label}${k === 'waiting' && summary.waiting ? html` <span class="pill info">${summary.waiting}</span>` : ''}</button>`)}</div>
      <div data-panel><div class="muted">Loading…</div></div>`);
    el.onclick = (e) => {
      const t = e.target.closest('[data-tab]');
      const g = e.target.closest('[data-go]');
      if (t) { tab = t.dataset.tab; draw(); }
      if (g) {
        const [to, status] = g.dataset.go.split(':');
        tab = to;
        if (status) filters.status = status;
        draw();
      }
    };
    const panel = $('[data-panel]', el);
    try { await ({ waiting, studies: list, teachers, materials })[tab](panel); } catch (e) { fail(e); }
  }

  // ---------------------------------------------------------------- waiting
  async function waiting(panel) {
    const { requests } = await get('/studies/requests');
    mount(panel, requests.length ? html`<div class="grid two">${requests.map((q) => html`<div class="card">
        <div class="row"><b style="font-size:16px">${who(q)}</b><span class="spacer"></span><span class="muted small">Asked ${fmtDate(q.created_at.slice(0, 10))}${q.campus ? ` · ${q.campus}` : ''}</span></div>
        <div class="row" style="margin-top:8px"><span class="pill">${FORMATS[q.format]}</span>${q.material_title ? html`<span class="pill info">${q.material_title}</span>` : ''}${q.topic ? html`<span class="pill">${q.topic}</span>` : ''}</div>
        ${q.times ? html`<p class="small" style="margin:8px 0 0">Good times: ${q.times}</p>` : ''}
        <div class="row small" style="margin-top:8px">${q.phone ? html`<a href="tel:${q.phone}">${q.phone}</a>` : ''}${q.email ? html`<a href="mailto:${q.email}">${q.email}</a>` : ''}</div>
        <p class="muted small" style="margin:6px 0 0">${q.share_contact ? 'Happy for their teacher to have their phone and email.' : 'Please make the introduction: they haven’t shared their contact details with a teacher.'}</p>
        <div class="row" style="margin-top:12px"><button class="btn small primary" data-start="${q.id}">Start a study</button><button class="btn small" data-add-to="${q.id}">Add to an existing study</button>
          <span class="spacer"></span><button class="btn small ghost" data-close="${q.id}">Close</button></div></div>`)}</div>`
      : html`<div class="card empty">Nobody is waiting. When someone taps “I’d like to do a Bible study” in the church app, they’ll show up here and you’ll get a notice.</div>`);
    panel.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const q = requests.find((x) => x.id === Number(b.dataset.start || b.dataset.addTo || b.dataset.close));
      try {
        if (b.dataset.start && await studyForm({ request: q })) refresh();
        if (b.dataset.addTo) {
          const all = await get('/studies?status=active');
          const picked = await dialog({
            title: `Add ${q.name} to a study`, submit: 'Add',
            body: html`<label class="field">Which study?<select name="study_id" required>${options(all.map((s) => ({ value: s.id, label: `${s.teachers.map((t) => t.name).join(' & ')}: ${s.material_title || 'material not chosen yet'}` })), '', { blank: 'Choose…' })}</select></label>`,
            onSubmit: (f) => { const id = formData(f).study_id; if (!id) throw new Error('Choose a study.'); return post(`/studies/requests/${q.id}/match`, { study_id: Number(id) }); },
          });
          if (picked) { toast(`${q.name} added.`); refresh(); }
        }
        if (b.dataset.close) {
          const { close_reasons } = await get('/studies/requests');
          const done = await dialog({
            title: 'Close this request', submit: 'Close request',
            body: html`<label class="field">Why?<select name="reason">${options(Object.entries(close_reasons).map(([value, label]) => ({ value, label })), 'other')}</select></label>
              <p class="muted small">Pick the closest. Please keep the details out of the Hub.</p>`,
            onSubmit: (f) => post(`/studies/requests/${q.id}/close`, { reason: formData(f).reason }),
          });
          if (done) { toast('Closed.'); refresh(); }
        }
      } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------- studies
  async function list(panel) {
    const qs = new URLSearchParams();
    if (filters.status) qs.set('status', filters.status);
    if (filters.campus) qs.set('campus', filters.campus);
    const rows = await get(`/studies?${qs}`);
    const groups = new Map();
    for (const s of rows) {
      const keys = filters.group === 'material' ? [s.material_title || 'No material chosen yet'] : filters.group === 'none' ? ['All studies'] : (s.teachers.length ? s.teachers.map((t) => t.name) : ['No teacher']);
      for (const k of keys) groups.set(k, [...(groups.get(k) || []), s]);
    }
    const card = (s) => html`<button type="button" class="card" data-study="${s.id}" style="text-align:left;width:100%;cursor:pointer;font:inherit;color:inherit">
      <div class="row"><b>${s.students.map((p) => p.name).join(', ') || 'No students'}</b><span class="spacer"></span><span class="pill ${s.status === 'active' ? 'good' : s.status === 'paused' ? 'warn' : ''}">${STATUS[s.status]}</span></div>
      <div class="muted small" style="margin-top:4px">${s.material_title || 'Material not chosen yet'} · ${s.status === 'finished' ? `Finished ${fmtDate(s.finished_on)}` : progressText(s.progress)}</div>
      ${s.rhythm ? html`<div class="small" style="margin-top:4px">${s.rhythm}</div>` : ''}
      <div class="muted small" style="margin-top:4px">Taught by ${s.teachers.map((t) => t.name).join(' & ') || 'no one yet'}${s.campus ? ` · ${s.campus}` : ''}</div></button>`;
    const csv = `/api/studies/export.csv?${qs}`;
    mount(panel, html`<div class="row" style="margin-bottom:14px">
        <label class="field" style="min-width:140px">Status<select data-f="status">${options(Object.entries(STATUS).map(([value, label]) => ({ value, label })), filters.status, { blank: 'All' })}</select></label>
        <label class="field" style="min-width:140px">Campus<select data-f="campus">${options([...visibleCampuses().map((c) => ({ value: c.id, label: c.name })), { value: 'none', label: 'No campus set' }], filters.campus, { blank: 'All campuses' })}</select></label>
        <label class="field" style="min-width:140px">Group by<select data-f="group">${options([{ value: 'teacher', label: 'Teacher' }, { value: 'material', label: 'Material' }, { value: 'none', label: 'Nothing' }], filters.group)}</select></label>
        <span class="spacer"></span><a class="btn ghost" href="${csv}" download>${icon('download')} Download CSV</a></div>
      ${rows.length ? [...groups].map(([name, items]) => html`<h3 style="margin:18px 0 8px">${name} <span class="muted small">${items.length} ${items.length === 1 ? 'study' : 'studies'}</span></h3><div class="grid two">${items.map(card)}</div>`)
        : html`<div class="card empty">${filters.status || filters.campus ? 'No studies match those filters.' : 'No studies yet. Tap “New study” to start one, or wait for requests from the church app.'}</div>`}`);
    panel.onchange = (e) => { const f = e.target.closest('[data-f]'); if (f) { filters[f.dataset.f] = f.value; list(panel).catch(fail); } };
    panel.onclick = async (e) => {
      const c = e.target.closest('[data-study]');
      if (c) { await studyDialog(Number(c.dataset.study)); refresh(); }
    };
  }

  // ---------------------------------------------------------------- teachers
  async function teachers(panel) {
    const rows = await get('/studies/teachers');
    mount(panel, rows.length ? html`<div class="card table-scroll"><table class="list"><thead><tr><th scope="col">Teacher</th><th scope="col">Active studies</th><th scope="col">Taught, all time</th><th scope="col"></th></tr></thead>
      <tbody>${rows.map((t) => html`<tr><td><b>${who(t)}</b></td><td>${t.active_studies}</td><td>${t.taught}</td><td>${t.has_account ? '' : html`<span class="pill warn">No account yet</span>`}</td></tr>`)}</tbody></table></div>
      ${rows.some((t) => !t.has_account) ? html`<p class="muted small">Teachers with an account can update their own studies and mark students finished. ${can('admin') ? 'To invite one, open their page in People and choose “Give more access”.' : 'An admin can set up accounts for the others.'}</p>` : ''}`
      : html`<div class="card empty">No one is teaching yet. Teachers appear here once they’re part of a study.</div>`);
  }

  // ---------------------------------------------------------------- materials
  async function materials(panel) {
    const data = await get(`/studies/materials?year=${year}`);
    const years = Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - i));
    mount(panel, html`<div class="row" style="margin-bottom:12px"><p class="muted small" style="margin:0;flex:1">The approved list teachers choose from. Retire a material to take it off the list; finished studies keep it on record.</p>
        <label class="field" style="min-width:110px">Finished in<select data-year>${options(years.map((y) => ({ value: y, label: y })), year)}</select></label>
        <button class="btn primary" data-add-material>${icon('plus')} Add a material</button>
        ${can('admin') && !state.me.campusIds ? html`<button class="btn" data-import>${icon('upload')} Import past studies</button>` : ''}</div>
      ${data.materials.length ? html`<div class="card table-scroll"><table class="list"><thead><tr><th scope="col">Material</th><th scope="col">Lessons</th><th scope="col">In progress</th><th scope="col">Finished in ${year}</th><th scope="col">All time</th><th scope="col"></th></tr></thead>
        <tbody>${data.materials.map((m) => html`<tr class="${m.active ? '' : 'muted'}"><td><b>${m.title}</b>${m.author ? html`<br><span class="muted small">${m.author}</span>` : ''}${m.active ? '' : html` <span class="pill">Retired</span>`}</td>
          <td>${m.lessons ?? '—'}</td><td>${m.active_studies}</td><td>${m.completions_year}</td><td>${m.completions}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn small ghost" data-edit="${m.id}">${icon('edit')} Edit</button>
            <button class="btn small ghost" data-toggle="${m.id}">${m.active ? 'Retire' : 'Bring back'}</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="card empty">No materials yet. Add the ones your church approves for teaching, such as a workbook or a book of the Bible.</div>`}`);
    panel.onchange = (e) => { if (e.target.matches('[data-year]')) { year = e.target.value; materials(panel).catch(fail); } };
    panel.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const m = data.materials.find((x) => x.id === Number(b.dataset.edit || b.dataset.toggle));
      try {
        if (b.matches('[data-add-material]') && await materialForm()) materials(panel);
        if (b.dataset.edit && await materialForm(m)) materials(panel);
        if (b.dataset.toggle) {
          if (m.active && !(await confirm('Retire this material?', `${m.title} will leave the list teachers choose from. Studies already using it, and finished studies, keep it.`, 'Retire'))) return;
          await patch(`/studies/materials/${m.id}`, { active: !m.active });
          toast(m.active ? 'Retired.' : 'Back on the list.');
          materials(panel);
        }
        if (b.matches('[data-import]') && await importForm()) { refresh(); }
      } catch (err) { fail(err); }
    };
  }

  await refresh();
}

// ---------------------------------------------------------------- dialogs
function materialForm(m = {}) {
  return dialog({
    title: m.id ? 'Edit material' : 'Add a material',
    body: html`<div class="form">
      <label class="field wide">Title<input type="text" name="title" value="${m.title || ''}" required maxlength="160" placeholder="Foundations"></label>
      <label class="field">Author or publisher<input type="text" name="author" value="${m.author || ''}" maxlength="160"></label>
      <label class="field">Number of lessons (if it has one)<input type="number" name="lessons" min="1" max="500" value="${m.lessons ?? ''}"></label>
      <label class="field wide">Notes for teachers<textarea name="teacher_notes" maxlength="2000" placeholder="How to use it, where to get copies">${m.teacher_notes || ''}</textarea></label></div>`,
    onSubmit: (f) => { const b = formData(f); return m.id ? patch(`/studies/materials/${m.id}`, b) : post('/studies/materials', b); },
  });
}

// Choose one person by name. Names only: contact details stay out of the picker.
export function pickStudyPerson(title, exclude = []) {
  let chosen;
  return dialog({
    title, submit: null,
    body: html`<input type="search" aria-label="Search by name" placeholder="Search by name" data-q><div class="picker-list" data-list><div class="muted small">Start typing…</div></div>`,
    onOpen: (d, close) => {
      const listEl = $('[data-list]', d);
      let rows = [];
      const run = debounce(async (q) => {
        if (q.trim().length < 2) return;
        try {
          rows = (await get(`/studies/people?q=${encodeURIComponent(q)}`)).filter((p) => !exclude.includes(p.id));
          mount(listEl, rows.length ? rows.map((p, i) => html`<button type="button" data-i="${i}"><span>${p.name}<br><small class="muted">${p.campus || 'No campus'}${p.has_account ? '' : ' · no account'}</small></span></button>`) : html`<div class="muted small">No one found.</div>`);
        } catch (err) { fail(err); }
      });
      $('[data-q]', d).addEventListener('input', (e) => run(e.target.value));
      listEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { chosen = rows[b.dataset.i]; close(chosen); } });
    },
  }).then(() => chosen);
}

// A new study (optionally from a waiting request, whose person is the student). Resolves true if saved.
async function studyForm({ request } = {}) {
  const { materials } = await get('/studies/materials?active=1');
  const teachers = [];
  const students = request ? [{ id: request.person_id, name: request.name, share: request.share_contact, fixed: true }] : [];
  let made;
  await dialog({
    title: request ? `Start a study for ${request.name}` : 'New study', wide: true,
    body: html`<div class="form">
      <label class="field wide">Material<select name="material_id">${options(materials.map((m) => ({ value: m.id, label: m.title })), request?.material_id ?? '', { blank: 'The teacher will choose' })}</select>
        ${request?.topic ? html`<small class="muted">They said: ${request.topic}</small>` : ''}</label>
      <div class="field wide"><span>Teachers</span><div class="chips" data-teachers></div><div><button type="button" class="btn small" data-add-teacher>${icon('plus')} Add a teacher</button></div></div>
      <div class="field wide"><span>${request ? 'Student' : 'Students'}</span><div data-students></div>${request ? '' : html`<div><button type="button" class="btn small" data-add-student>${icon('plus')} Add a student</button></div>`}</div>
      <label class="field wide">When and where they meet (optional)<input type="text" name="rhythm" maxlength="120" placeholder="Tuesdays, coffee shop"></label>
      <label class="field">Planned lessons (optional)<input type="number" name="planned_lessons" min="0" max="500"></label>
      <label class="field">Campus (for reporting, optional)<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), request?.campus_id ?? '', { blank: 'Choose from the first student' })}</select></label>
      <label class="field wide">Note for coordinators (optional)<textarea name="coordinator_note" maxlength="${NOTE_MAX}" rows="2"></textarea>
        <small class="muted">Practical notes only, like “prefers mornings”. Keep personal matters out of the Hub. Only coordinators and staff see this.</small></label></div>`,
    onOpen: (d) => {
      const drawPeople = () => {
        mount($('[data-teachers]', d), teachers.length ? teachers.map((t, i) => html`<span class="chip">${t.name}<button type="button" class="icon-btn" aria-label="Remove ${t.name}" data-rm-t="${i}">${icon('x')}</button></span>`) : html`<span class="muted small">No one yet</span>`);
        mount($('[data-students]', d), students.length ? students.map((s, i) => html`<div class="row" style="padding:3px 0"><span class="chip">${s.name}${s.fixed ? '' : html`<button type="button" class="icon-btn" aria-label="Remove ${s.name}" data-rm-s="${i}">${icon('x')}</button>`}</span>
          <label class="check small"><input type="checkbox" data-share="${i}" ${s.share ? 'checked' : ''}> Share contact details with their teacher</label></div>`) : html`<span class="muted small">No one yet</span>`);
      };
      drawPeople();
      d.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.rmT) { teachers.splice(Number(b.dataset.rmT), 1); drawPeople(); }
        if (b.dataset.rmS) { students.splice(Number(b.dataset.rmS), 1); drawPeople(); }
        if (b.matches('[data-add-teacher]')) { const p = await pickStudyPerson('Who will teach?', [...teachers, ...students].map((x) => x.id)); if (p) { teachers.push(p); drawPeople(); } }
        if (b.matches('[data-add-student]')) { const p = await pickStudyPerson('Who will study?', [...teachers, ...students].map((x) => x.id)); if (p) { students.push({ ...p, share: false }); drawPeople(); } }
      });
      d.addEventListener('change', (e) => { if (e.target.dataset.share !== undefined) students[Number(e.target.dataset.share)].share = e.target.checked; });
    },
    onSubmit: async (f) => {
      const b = formData(f);
      const body = {
        material_id: b.material_id ? Number(b.material_id) : null, teacher_ids: teachers.map((t) => t.id), rhythm: b.rhythm,
        planned_lessons: b.planned_lessons === '' ? null : Number(b.planned_lessons), coordinator_note: b.coordinator_note,
        ...(b.campus_id ? { campus_id: Number(b.campus_id) } : {}),
      };
      if (request) made = await post(`/studies/requests/${request.id}/match`, body);
      else made = await post('/studies', { ...body, students: students.map((s) => ({ person_id: s.id, share_contact: s.share })) });
    },
  });
  if (made) {
    toast('Study started.');
    if (made.teachers_without_account?.length) {
      await dialog({ title: 'Invite your teacher?', submit: null, cancel: 'Done', body: invite(made.teachers_without_account) });
    }
  }
  return Boolean(made);
}

// One study: who is in it, how it's going, and the things a coordinator does with it.
async function studyDialog(id) {
  for (;;) {
    const s = await get(`/studies/${id}`);
    const again = await dialog({
      title: s.material_title || 'Bible study', submit: null, cancel: 'Close', wide: true,
      body: html`<div class="stack">
        <div class="row"><span class="pill ${s.status === 'active' ? 'good' : s.status === 'paused' ? 'warn' : ''}">${STATUS[s.status]}</span>
          <span>${s.status === 'finished' ? `Finished ${fmtDate(s.finished_on)}` : progressText(s.progress)}</span>${s.campus ? html`<span class="campus-tag">${s.campus}</span>` : ''}</div>
        ${s.rhythm ? html`<div class="small">Meets: ${s.rhythm}</div>` : ''}
        ${s.material_title ? '' : html`<div class="alert">The material hasn’t been chosen yet. The teacher, or you, can choose it under Edit details.</div>`}
        <div><h3 style="margin:0 0 6px">Teachers</h3>${s.teachers.length ? s.teachers.map((t) => html`<div class="row small" style="padding:3px 0"><b>${t.name}</b>${t.has_account ? '' : html`<span class="pill warn">No account yet</span>`}
          ${t.phone ? html`<a href="tel:${t.phone}">${t.phone}</a>` : ''}${t.email ? html`<a href="mailto:${t.email}">${t.email}</a>` : ''}<span class="spacer"></span>
          <button type="button" class="icon-btn" data-rm="${t.id}" aria-label="Remove ${t.name}" title="Remove">${icon('x')}</button></div>`) : html`<span class="muted small">No teacher</span>`}
          <button type="button" class="btn small" data-add="teacher">${icon('plus')} Add a teacher</button></div>
        <div><h3 style="margin:0 0 6px">Students</h3>${s.students.length ? s.students.map((t) => html`<div class="row small" style="padding:3px 0"><b>${t.name}</b>
          <span class="muted">${t.share_contact ? 'shares contact with teachers' : 'contact not shared'}</span>${t.phone ? html`<a href="tel:${t.phone}">${t.phone}</a>` : ''}${t.email ? html`<a href="mailto:${t.email}">${t.email}</a>` : ''}<span class="spacer"></span>
          <button type="button" class="btn small" data-finish="${t.id}">${icon('check')} Finished</button>
          <button type="button" class="icon-btn" data-rm="${t.id}" aria-label="Remove ${t.name}" title="Remove">${icon('x')}</button></div>`) : html`<span class="muted small">No students</span>`}
          ${s.status === 'finished' ? '' : html`<button type="button" class="btn small" data-add="student">${icon('plus')} Add a student</button>`}</div>
        ${s.coordinator_note ? html`<div class="small"><b>Note:</b> ${s.coordinator_note}</div>` : ''}
        ${invite(s.teachers_without_account)}
        <div class="row" style="margin-top:6px"><button type="button" class="btn" data-edit>${icon('edit')} Edit details</button>
          ${s.status === 'active' ? html`<button type="button" class="btn" data-status="paused">Pause</button>` : ''}
          ${s.status === 'paused' ? html`<button type="button" class="btn" data-status="active">Resume</button>` : ''}
          ${s.status !== 'finished' ? html`<button type="button" class="btn" data-status="finished">Finish the study</button>` : html`<button type="button" class="btn" data-status="active">Reopen</button>`}
          <span class="spacer"></span>${can('admin') ? html`<button type="button" class="btn danger small" data-delete>${icon('trash')} Delete (made by mistake)</button>` : ''}</div></div>`,
      onOpen: (d, close) => {
        d.addEventListener('click', async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          try {
            if (b.matches('[data-edit]')) { if (await detailsForm(s)) close('again'); }
            if (b.dataset.status) { await post(`/studies/${id}/progress`, { status: b.dataset.status }); close('again'); }
            if (b.dataset.add) {
              const p = await pickStudyPerson(b.dataset.add === 'teacher' ? 'Who will teach?' : 'Who will study?', [...s.teachers, ...s.students].map((x) => x.id));
              if (!p) return;
              const share = b.dataset.add === 'student' ? await confirm(`Share ${p.name}’s phone and email?`, 'Should their teacher be able to see their phone and email? Say no if you’d rather make the introduction yourself.', 'Share', { danger: false }) : false;
              const out = await post(`/studies/${id}/people`, { person_id: p.id, role: b.dataset.add, share_contact: Boolean(share) });
              if (out.teachers_without_account?.length) await dialog({ title: 'Invite your teacher?', submit: null, cancel: 'Done', body: invite(out.teachers_without_account) });
              close('again');
            }
            if (b.dataset.rm) {
              const person = [...s.teachers, ...s.students].find((x) => x.id === Number(b.dataset.rm));
              if (await confirm(`Take ${person.name} out of this study?`, 'They’ll no longer appear in the study. Anything they finished stays on their record.', 'Take out')) { await del(`/studies/${id}/people/${person.id}`); close('again'); }
            }
            if (b.dataset.finish) {
              const person = s.students.find((x) => x.id === Number(b.dataset.finish));
              if (!s.material_id) { toast('Choose the study material first, under Edit details.', 'bad'); return; }
              const ok = await dialog({
                title: `${person.name} finished?`, submit: 'Mark finished',
                body: html`<p>Record that ${person.name} finished <b>${s.material_title}</b>. You can undo this later from their page.</p><label class="field">Finished on<input type="date" name="completed_on" value="${new Date().toLocaleDateString('en-CA')}" required></label>`,
                onSubmit: (f) => post(`/studies/${id}/complete`, { person_ids: [person.id], completed_on: formData(f).completed_on }),
              });
              if (ok) { toast(`${person.name} marked finished.`); close('again'); }
            }
            if (b.matches('[data-delete]') && await confirm('Delete this study?', 'Only for a study made by mistake. It can’t be deleted once someone has finished it.', 'Delete')) { await del(`/studies/${id}`); toast('Deleted.'); close('gone'); }
          } catch (err) { fail(err); }
        });
      },
    });
    if (again !== 'again') return;
  }
}

function detailsForm(s) {
  return get('/studies/materials').then(({ materials }) => dialog({
    title: 'Edit details',
    body: html`<div class="form">
      <label class="field wide">Material<select name="material_id">${options(materials.filter((m) => m.active || m.id === s.material_id).map((m) => ({ value: m.id, label: m.active ? m.title : `${m.title} (retired)` })), s.material_id ?? '', { blank: 'Not chosen yet' })}</select></label>
      <label class="field wide">When and where they meet<input type="text" name="rhythm" maxlength="120" value="${s.rhythm}" placeholder="Tuesdays, coffee shop"></label>
      <label class="field">Lesson they’re on<input type="number" name="lesson" min="0" max="999" value="${s.lesson ?? ''}"></label>
      <label class="field">Planned lessons<input type="number" name="planned_lessons" min="0" max="500" value="${s.planned_lessons ?? ''}" placeholder="${s.progress.planned ?? ''}"></label>
      <label class="field">Times they’ve met<input type="number" name="sessions" min="0" max="9999" value="${s.sessions ?? ''}"></label>
      <label class="field">Campus (for reporting)<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), s.campus_id ?? '', { blank: 'None' })}</select></label>
      <label class="field wide">Note for coordinators<textarea name="coordinator_note" maxlength="${NOTE_MAX}" rows="2">${s.coordinator_note}</textarea>
        <small class="muted">Practical notes only, like “prefers mornings”. Keep personal matters out of the Hub.</small></label></div>`,
    onSubmit: (f) => {
      const b = formData(f);
      const num = (v) => (v === '' ? null : Number(v));
      return patch(`/studies/${s.id}`, { material_id: num(b.material_id), rhythm: b.rhythm, lesson: num(b.lesson), planned_lessons: num(b.planned_lessons), sessions: num(b.sessions), campus_id: num(b.campus_id), coordinator_note: b.coordinator_note });
    },
  }));
}

// Admins: past completions from a spreadsheet. A preview first; people are matched by their People
// id or an exact, unique email, and nobody is created.
function importForm() {
  let csv = '';
  let previewed = false;
  return dialog({
    title: 'Import past studies', submit: 'Import', wide: true,
    body: html`<div class="stack"><p class="muted small" style="margin:0">A spreadsheet saved as CSV with the columns <b>person_id</b> or <b>email</b>, <b>material</b>, <b>completed_on</b> (2024-05-05) and, if you like, <b>teacher</b>.
        People are matched by their People id or an exact email that belongs to one person. Nobody is added to People.</p>
      <input type="file" accept=".csv,text/csv" data-file aria-label="Choose a CSV file">
      <label class="check"><input type="checkbox" name="create_materials"> <span>Add materials that aren’t on the list yet, as retired materials (so history reads right).</span></label>
      <div data-preview class="muted small">Choose a file to see a preview.</div></div>`,
    onOpen: (d) => {
      const prev = $('[data-preview]', d);
      $('[data-file]', d).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          csv = await file.text();
          const r = await post('/studies/import/preview', { csv });
          previewed = true;
          const label = { ok: 'ready to import', unmatched: 'no matching person', ambiguous: 'email belongs to more than one person', unknown_material: 'material not on the list', bad_date: 'date missing or not valid', duplicate: 'already recorded' };
          mount(prev, html`<p><b>${r.total}</b> rows. ${Object.entries(r.counts).map(([k, n]) => html`<span class="pill ${k === 'ok' ? 'good' : ''}">${n} ${label[k]}</span> `)}</p>
            ${r.new_materials.length ? html`<p class="small">New materials: ${r.new_materials.join(', ')}</p>` : ''}
            <div class="table-scroll"><table class="list small"><thead><tr><th>Row</th><th>Material</th><th>Date</th><th>Result</th></tr></thead><tbody>${r.rows.slice(0, 50).map((x) => html`<tr><td>${x.line}</td><td>${x.material}</td><td>${x.completed_on}</td><td>${label[x.status]}</td></tr>`)}</tbody></table></div>`);
        } catch (err) { previewed = false; fail(err); }
      });
    },
    onSubmit: async (f) => {
      if (!previewed) throw new Error('Choose a file and check the preview first.');
      const r = await post('/studies/import', { csv, create_materials: formData(f).create_materials });
      toast(`${r.imported} added, ${r.skipped} skipped.`);
    },
  });
}

