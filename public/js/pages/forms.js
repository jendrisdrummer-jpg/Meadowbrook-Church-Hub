// Forms: simple forms staff set up once (volunteer interest, a request, a survey). People fill them
// in on their phone from a link; responses are listed here for staff. Not a form builder.
import { get, post, patch, del, html, mount, icon, options, toast, fail, confirm, formData, fmtDate } from '../lib.js';
import { state, setTitle, go, visibleCampuses, can } from '../app.js';

const QTYPES = { text: 'Short answer', longtext: 'Long answer', choice: 'Pick one', multichoice: 'Pick any', yesno: 'Yes / No', date: 'Date' };
const MODES = [{ value: 'off', label: 'Don’t ask' }, { value: 'optional', label: 'Ask (optional)' }, { value: 'required', label: 'Ask (required)' }];
const publicLink = (f) => `${location.origin}/app/#/form/${f.slug}`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied.'); } catch { toast(`Copy this link: ${text}`); }
}

export default async function forms(el, id, tab) {
  if (id === 'new') return editor(el, null);
  if (id && tab === 'responses') return responses(el, await get(`/admin/forms/${id}`));
  if (id) return editor(el, await get(`/admin/forms/${id}`));
  return list(el);
}

// ---------------------------------------------------------------- the list
async function list(el) {
  setTitle('Forms', html`<a class="btn primary" href="#/forms/new">${icon('plus')} New form</a>`);
  const all = (await get('/admin/forms')).filter((f) => !state.campusId || !f.campus_id || f.campus_id === state.campusId);
  const on = all.filter((f) => f.active);
  const off = all.filter((f) => !f.active);
  const row = (f) => html`<tr data-id="${f.id}" data-manage="${f.can_manage}" class="clickable">
    <td><b>${f.title}</b><br><span class="muted small">${f.campus_short || f.campus_name || 'All campuses'} · ${f.audience === 'signed_in' ? 'Signed-in people' : 'Anyone with the link'}</span></td>
    <td>${f.can_manage ? html`<b>${f.total}</b> ${f.total === 1 ? 'response' : 'responses'}${f.new_count ? html` <span class="pill info">${f.new_count} new</span>` : ''}` : html`<span class="muted small">Church-wide: office staff only</span>`}</td>
    <td style="text-align:right">${f.active ? html`<button class="btn small ghost" data-copy="${f.slug}">${icon('copy')} Copy link</button>` : html`<span class="pill">Turned off</span>`}</td></tr>`;
  mount(el, html`<p class="muted" style="margin-top:-6px">Set up a form once, share its link (a text, a bulletin QR code, the church app), and read the answers here. Only staff can see responses.</p>
    ${all.length ? html`<div class="card table-scroll"><table class="list"><thead><tr><th>Form</th><th>Responses</th><th></th></tr></thead><tbody>${[...on, ...off].map(row)}</tbody></table></div>`
      : html`<div class="card empty">No forms yet. <a href="#/forms/new">Make the first one</a>.</div>`}`);
  el.onclick = (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) return copy(`${location.origin}/app/#/form/${c.dataset.copy}`);
    const tr = e.target.closest('tr[data-id]');
    if (tr) go(tr.dataset.manage === 'true' ? `/forms/${tr.dataset.id}/responses` : `/forms/${tr.dataset.id}`);
  };
}

// ---------------------------------------------------------------- the editor
async function editor(el, e) {
  const limited = Boolean(state.me.campusIds);
  const staff = await get('/admin/forms/notify-options');
  const f = e ? structuredClone(e) : {
    title: '', intro: '', campus_id: limited ? state.campusId || state.me.campusIds[0] : null, audience: 'public', active: true, notify_user_id: null,
    ask_contact: { name: 'required', email: 'optional', phone: 'off' }, questions: [],
  };
  const editable = !e || e.can_manage;
  let dirty = false;
  setTitle(e ? e.title : 'New form', html`${e ? html`<a class="btn ghost" href="#/forms/${e.id}/responses">Responses</a>` : ''}${editable ? html`<button class="btn primary" data-save>${e ? 'Save' : 'Create form'}</button>` : ''}`);

  function draw() {
    const campusOk = (u) => (f.campus_id == null ? !u.campus_ids : !u.campus_ids || u.campus_ids.includes(Number(f.campus_id)));
    mount(el, html`${!editable ? html`<div class="alert">This form is for the whole church, so only staff who aren’t limited to one campus can change it.</div>` : ''}
      <form class="grid two" data-form novalidate><fieldset class="stack" style="border:0;padding:0;margin:0;min-width:0" ${editable ? '' : 'disabled'}>
        <div class="card stack"><h2 style="margin:0">The form</h2>
          <label class="field">Title<input type="text" name="title" value="${f.title}" maxlength="140" required placeholder="Volunteer interest"></label>
          <label class="field">A few kind words at the top<textarea name="intro" rows="3" maxlength="2000" placeholder="Tell us a bit about you and we’ll be in touch.">${f.intro}</textarea></label>
          <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), f.campus_id, limited ? {} : { blank: 'All campuses (church-wide)' })}</select></label>
          <label class="field">Who can fill it in<select name="audience">${options([{ value: 'public', label: 'Anyone with the link' }, { value: 'signed_in', label: 'Only people signed in to the app' }], f.audience)}</select></label>
          <div class="form">${['name', 'email', 'phone'].map((k) => html`<label class="field">${{ name: 'Their name', email: 'Their email', phone: 'Their phone' }[k]}<select name="c_${k}">${options(MODES, f.ask_contact[k])}</select></label>`)}</div>
          <label class="field">Tell this person about new responses<select name="notify_user_id">${options(staff.filter(campusOk).map((u) => ({ value: u.id, label: u.name })), f.notify_user_id, { blank: 'No one' })}</select>
            <span class="muted small">They get a notice, never the answers. They read those here.</span></label>
          <label class="toggle-row"><span><b>Open for responses</b><br><span class="muted small">Turn off to close the form. The link stops working; responses stay here.</span></span><input type="checkbox" class="switch" name="active" ${f.active ? 'checked' : ''}></label>
          ${e ? html`<div class="field"><span>Link to share</span><div class="row"><input type="text" readonly value="${publicLink(e)}" style="flex:1" data-link><button type="button" class="btn small" data-copy>${icon('copy')} Copy link</button></div></div>` : html`<p class="muted small" style="margin:0">You’ll get a link to share once it’s created.</p>`}
        </div>
        <div class="card stack"><h2 style="margin:0">Questions</h2>
          <div class="q-list q-wide">${f.questions.map((q, i) => html`<div class="q-row" data-q="${i}">
            <input type="text" data-qk="label" value="${q.label}" placeholder="Question, e.g. Where would you like to serve?" maxlength="200">
            <select data-qk="type">${options(Object.entries(QTYPES).map(([value, label]) => ({ value, label })), q.type)}</select>
            <label class="check small"><input type="checkbox" data-qk="required" ${q.required ? 'checked' : ''}> Required</label>
            <span class="row" style="gap:2px;flex-wrap:nowrap"><button type="button" class="icon-btn" data-qup="${i}" title="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button><button type="button" class="icon-btn" data-qdown="${i}" title="Move down" ${i < f.questions.length - 1 ? '' : 'disabled'}>${icon('down')}</button><button type="button" class="icon-btn danger" data-qdel="${i}" title="Remove">${icon('x')}</button></span>
            ${['choice', 'multichoice'].includes(q.type) ? html`<input type="text" data-qk="options" class="q-opts" value="${(q.options || []).join(', ')}" placeholder="Choices, separated by commas: Kids, Music, Welcome team">` : ''}
          </div>`)}</div>
          ${f.questions.length < 30 ? html`<div><button type="button" class="btn small ghost" data-qadd>${icon('plus')} Add a question</button></div>` : ''}
          ${f.questions.length ? '' : html`<p class="muted small" style="margin:0">No questions yet. Name and contact details above are enough for a simple “get in touch” form.</p>`}
        </div></fieldset></form>`);
  }

  // Keep the screen's values in f, so redraws (adding a question…) don't lose typing.
  function read() {
    const d = formData(el.querySelector('[data-form]'));
    Object.assign(f, {
      title: d.title, intro: d.intro, campus_id: d.campus_id ? Number(d.campus_id) : null, audience: d.audience, active: Boolean(d.active),
      notify_user_id: d.notify_user_id ? Number(d.notify_user_id) : null,
      ask_contact: { name: d.c_name, email: d.c_email, phone: d.c_phone },
    });
    el.querySelectorAll('[data-q]').forEach((row) => {
      const q = f.questions[row.dataset.q];
      q.label = row.querySelector('[data-qk=label]').value;
      q.type = row.querySelector('[data-qk=type]').value;
      q.required = row.querySelector('[data-qk=required]').checked;
      const opts = row.querySelector('[data-qk=options]');
      if (opts) q.options = opts.value.split(',').map((x) => x.trim()).filter(Boolean);
    });
  }

  draw();
  el.oninput = () => { dirty = true; };
  el.onchange = (x) => { dirty = true; if (x.target.dataset.qk === 'type' || x.target.name === 'campus_id') { read(); draw(); } };
  el.onclick = (x) => {
    const b = x.target.closest('button');
    if (!b) return;
    if (b.matches('[data-copy]')) return copy(publicLink(e));
    if (b.matches('[data-save]')) return save();
    const at = (k) => Number(b.dataset[k]);
    if (b.matches('[data-qadd]')) { read(); f.questions.push({ id: `q${Date.now().toString(36)}`, label: '', type: 'text', required: false }); dirty = true; return draw(); }
    if (b.dataset.qdel !== undefined) { read(); f.questions.splice(at('qdel'), 1); dirty = true; return draw(); }
    if (b.dataset.qup !== undefined) { read(); const i = at('qup'); [f.questions[i - 1], f.questions[i]] = [f.questions[i], f.questions[i - 1]]; dirty = true; return draw(); }
    if (b.dataset.qdown !== undefined) { read(); const i = at('qdown'); [f.questions[i + 1], f.questions[i]] = [f.questions[i], f.questions[i + 1]]; dirty = true; return draw(); }
  };
  async function save() {
    read();
    try {
      const saved = e ? await patch(`/admin/forms/${e.id}`, f) : await post('/admin/forms', f);
      dirty = false;
      toast(saved.active ? 'Saved. Here’s the link to share.' : 'Saved. This form is turned off.');
      if (!e) go(`/forms/${saved.id}`); else editor(el, { ...saved, can_manage: true });
    } catch (err) { fail(err); }
  }
  window.onbeforeunload = () => (dirty ? true : undefined);
}

// ---------------------------------------------------------------- responses
async function responses(el, f) {
  let status = 'new';
  const { rows: all, form } = await get(`/admin/forms/${f.id}/responses`);
  let rows = all;
  setTitle(form.title, html`<a class="btn ghost" href="#/forms/${f.id}">Edit form</a><a class="btn" href="/api/admin/forms/${f.id}/responses.csv" download>${icon('download')} CSV</a>`);

  const answer = (q, v) => (Array.isArray(v) ? v.join(', ') : v);
  function draw() {
    const shown = rows.filter((x) => (status === 'new' ? x.status === 'new' : x.status === 'done'));
    mount(el, html`<div class="tabs"><button class="${status === 'new' ? 'on' : ''}" data-status="new">To follow up (${rows.filter((x) => x.status === 'new').length})</button><button class="${status === 'done' ? 'on' : ''}" data-status="done">Done</button></div>
      ${shown.length ? html`<div class="grid two">${shown.map((x) => html`<div class="card stack" style="gap:8px">
        <div class="row"><b style="font-size:16px">${x.name || (x.person_first ? `${x.person_first} ${x.person_last}` : 'Someone')}</b><span class="spacer"></span><span class="muted small">${fmtDate(x.created_at.slice(0, 10))}</span></div>
        <div class="row small">${x.email ? html`<a href="mailto:${x.email}">${x.email}</a>` : ''}${x.phone ? html`<a href="tel:${x.phone}">${x.phone}</a>` : ''}${x.person_id ? html`<a href="#/people/${x.person_id}">${icon('user')} ${x.person_first} ${x.person_last}</a>` : ''}</div>
        ${form.questions.filter((q) => x.answers[q.id] !== undefined).map((q) => html`<div><div class="muted small">${q.label}</div><div style="white-space:pre-line">${answer(q, x.answers[q.id])}</div></div>`)}
        <div class="row" style="margin-top:4px">
          ${x.status === 'done' ? html`<span class="muted small">Done${x.done_by_name ? ` by ${x.done_by_name}` : ''}</span><button class="btn small ghost" data-reopen="${x.id}">Reopen</button>`
            : html`<button class="btn small primary" data-done="${x.id}">${icon('check')} Done</button>`}
          <span class="spacer"></span>
          ${can('admin') ? html`<button class="icon-btn danger" data-del="${x.id}" title="Delete">${icon('trash')}</button>` : ''}
        </div></div>`)}</div>`
        : html`<div class="card empty">${status === 'new' ? (all.length ? 'All caught up.' : html`No responses yet. Share the form’s link to get started.`) : 'Nothing marked done yet.'}</div>`}`);
  }
  draw();
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.status) { status = b.dataset.status; return draw(); }
      const mark = async (id, done) => { await patch(`/admin/form-responses/${id}`, { done }); rows = (await get(`/admin/forms/${f.id}/responses`)).rows; draw(); };
      if (b.dataset.done) await mark(b.dataset.done, true);
      if (b.dataset.reopen) await mark(b.dataset.reopen, false);
      if (b.dataset.del && await confirm('Delete this response?', 'It’s removed for good. Mark it done instead if you only want it out of the way.')) {
        await del(`/admin/form-responses/${b.dataset.del}`);
        rows = rows.filter((x) => String(x.id) !== b.dataset.del);
        draw();
      }
    } catch (err) { fail(err); }
  };
}
