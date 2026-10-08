// One service: order of service, who's serving, and attendance counts.
import { get, post, patch, put, del, html, raw, mount, icon, avatar, displayName, dialog, formData, options, toast, fail, confirm, fmtDate, fmtTime, fmtLength, parseLength, debounce, addDays, pickPerson } from '../lib.js';
import { state, can, setTitle, go } from '../app.js';
import { editServiceDialog, needsDialog, repeatLabel } from '../service-forms.js';
import { drawRollCall } from '../rollcall.js';

export default async function service(el, id) {
  const s = await get(`/services/${id}`);
  const staff = can('staff');
  setTitle(`${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(s.starts_at)}`,
    staff ? html`<button class="btn" data-edit>${icon('edit')} Details</button>` : '');
  const tab = sessionStorage.getItem('mb.service.tab') || 'plan';

  mount(el, html`
    <div class="row muted" style="margin:-6px 0 12px"><span class="campus-tag"><span class="dot" style="background:${s.campus.color}"></span>${s.campus.name}</span>
      ${s.type ? html`<span title="Repeating service">· ${icon('calendar', 'ic small-ic')} ${repeatLabel(s.type)}</span>` : ''}${s.series ? html`<span>· ${s.series}</span>` : ''}${s.title ? html`<span>· ${s.title}</span>` : ''}</div>
    ${s.notes ? html`<div class="alert info" style="margin-bottom:12px;white-space:pre-wrap">${s.notes}</div>` : ''}
    <div class="tabs" role="tablist">
      <button data-tab="plan" class="${tab === 'plan' ? 'on' : ''}">Order of service</button>
      <button data-tab="people" class="${tab === 'people' ? 'on' : ''}">Who’s serving</button>
      ${can('leader') ? html`<button data-tab="counts" class="${tab === 'counts' ? 'on' : ''}">Attendance</button>` : ''}
    </div>
    <div data-panel></div>`);
  const panel = el.querySelector('[data-panel]');
  const show = (name) => {
    sessionStorage.setItem('mb.service.tab', name);
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    ({ plan: drawPlan, people: drawPeople, counts: drawCounts })[name](panel, s);
  };
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  show(['plan', 'people', 'counts'].includes(tab) && (tab !== 'counts' || can('leader')) ? tab : 'plan');

  document.querySelector('[data-actions] [data-edit]')?.addEventListener('click', async () => {
    const r = await editServiceDialog(s);
    if (r === 'deleted') go('/services');
    else if (r) service(el, id);
  });
}

// ---------------------------------------------------------------- order of service
function drawPlan(panel, s) {
  const items = s.items;
  const total = items.reduce((a, i) => a + i.length_sec, 0);
  let clock = 0;
  const edit = s.can_edit_plan;
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Order of service</h2><span class="muted small">${total ? `Total ${fmtLength(total)}` : ''}</span>
      ${edit ? html`<button class="btn small" data-copy>${icon('copy')} Copy from…</button>` : ''}</div>
    ${items.length ? html`<div class="plan" data-plan>${items.map((i) => {
      const start = clock; clock += i.length_sec;
      return html`<div class="plan-item ${i.kind === 'header' ? 'header' : ''}" data-item="${i.id}" ${edit ? raw('draggable="true"') : ''}>
        <span class="grip">${edit ? '⋮⋮' : ''}</span>
        <span class="t">${i.kind === 'song' ? html`${icon('music')} ` : ''}${i.title || (i.kind === 'header' ? 'Section' : 'Item')}
          ${i.kind === 'song' && i.song_key ? html` <span class="pill">${i.song_key}</span>` : ''}
          ${i.kind !== 'header' && (i.first_name || i.notes) ? html`<small>${[i.first_name ? displayName(i) : '', i.notes].filter(Boolean).join(' · ')}</small>` : ''}</span>
        <span class="muted small num">${i.kind !== 'header' && i.length_sec ? html`${fmtLength(i.length_sec)} <span title="Starts at">(${fmtLength(start)})</span>` : ''}</span>
        <span>${edit ? html`<button class="icon-btn" data-edit-item="${i.id}" title="Edit">${icon('edit')}</button>` : ''}</span>
      </div>`;
    })}</div>` : html`<div class="empty">No order of service yet.</div>`}
    ${edit ? html`<div class="row" style="margin-top:12px">
      <button class="btn small" data-new="header">${icon('plus')} Section</button>
      <button class="btn small" data-new="song">${icon('music')} Song</button>
      <button class="btn small" data-new="item">${icon('plus')} Item</button></div>` : ''}
  </div>`);
  if (!edit) return;

  const save = (list) => { s.items = list; drawPlan(panel, s); };
  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.new) { const list = await itemDialog(s, { kind: b.dataset.new }); if (list) save(list); }
      if (b.dataset.editItem) { const list = await itemDialog(s, items.find((i) => i.id === Number(b.dataset.editItem))); if (list) save(list); }
      if (b.matches('[data-copy]')) {
        // Same day first (e.g. copy 9:00 to 11:00), then the last five weeks, newest first.
        const day = s.starts_at.slice(0, 10);
        const recent = await get(`/services?from=${addDays(day, -35)}&to=${addDays(day, 7)}`);
        const choices = recent.filter((x) => x.id !== s.id && x.starts_at.slice(0, 10) <= day)
          .sort((a, b) => (b.starts_at.slice(0, 10) === day) - (a.starts_at.slice(0, 10) === day) || b.starts_at.localeCompare(a.starts_at));
        if (!choices.length) { toast('No nearby services to copy from.'); return; }
        let list;
        await dialog({
          title: 'Copy order of service from', submit: 'Copy',
          body: html`<label class="field">Service<select name="from">${options(choices.map((c) => ({ value: c.id, label: `${fmtDate(c.starts_at)} ${fmtTime(c.starts_at)} · ${c.campus_short || c.campus_name}` })))}</select></label>
            ${items.length ? html`<label class="check" style="margin-top:10px"><input type="checkbox" name="replace" checked> Replace what’s here now</label>` : ''}`,
          onSubmit: async (f) => { list = await post(`/services/${s.id}/copy-plan`, { from_service_id: Number(f.from.value), replace: f.replace?.checked ?? false }); },
        });
        if (list) save(list);
      }
    } catch (err) { fail(err); }
  };

  // Drag to reorder.
  const plan = panel.querySelector('[data-plan]');
  if (!plan) return;
  let dragging;
  plan.addEventListener('dragstart', (e) => { dragging = e.target.closest('.plan-item'); dragging?.classList.add('dragging'); });
  plan.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('.plan-item');
    if (!dragging || !over || over === dragging) return;
    const after = e.clientY > over.getBoundingClientRect().top + over.offsetHeight / 2;
    over[after ? 'after' : 'before'](dragging);
  });
  plan.addEventListener('dragend', async () => {
    dragging?.classList.remove('dragging');
    dragging = null;
    try { save(await put(`/services/${s.id}/items/order`, { ids: [...plan.children].map((c) => Number(c.dataset.item)) })); } catch (err) { fail(err); }
  });
}

async function itemDialog(s, item) {
  const editing = Boolean(item.id);
  const kind = item.kind;
  let songs = [];
  if (kind === 'song') songs = await get('/songs');
  const people = [...new Map(s.positions.flatMap((p) => p.assignments).map((a) => [a.person_id, a])).values()];
  let result;
  await dialog({
    title: editing ? 'Edit' : ({ header: 'New section', song: 'Add a song', item: 'New item' })[kind],
    submit: 'Save',
    body: html`<div class="form">
      ${kind === 'song' ? html`<label class="field wide">Song<select name="song_id" required>${options(songs.map((x) => ({ value: x.id, label: `${x.title}${x.author ? ` — ${x.author}` : ''}` })), item.song_id, { blank: 'Choose…' })}</select>
        <span class="muted small">Not listed? Add it on the <a href="#/songs">Songs</a> page.</span></label>
        <label class="field">Key<input type="text" name="song_key" value="${item.song_key || ''}" placeholder="G"></label>` : ''}
      ${kind !== 'song' || editing ? html`<label class="field ${kind === 'song' ? '' : 'wide'}">Title<input type="text" name="title" value="${item.title || ''}" ${kind !== 'song' ? 'required' : ''} placeholder="${kind === 'header' ? 'Worship' : 'Welcome & announcements'}"></label>` : ''}
      ${kind !== 'header' ? html`
        <label class="field">Length (m:ss)<input type="text" name="length" value="${fmtLength(item.length_sec)}" placeholder="4:30" inputmode="numeric"></label>
        <label class="field">Led by<select name="person_id">${options(people.map((p) => ({ value: p.person_id, label: displayName(p) })), item.person_id, { blank: '—' })}</select></label>
        <label class="field wide">Notes<textarea name="notes">${item.notes || ''}</textarea></label>` : ''}
      ${editing ? html`<label class="check wide"><input type="checkbox" name="delete"> Remove from the order of service</label>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const b = formData(f);
      if (b.delete) { result = await del(`/items/${item.id}`); return; }
      const body = { kind, title: b.title, song_id: b.song_id, song_key: b.song_key, notes: b.notes, person_id: b.person_id };
      if (b.length !== undefined) body.length_sec = parseLength(b.length);
      Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
      result = editing ? await patch(`/items/${item.id}`, body) : await post(`/services/${s.id}/items`, body);
    },
  });
  return result;
}

// ---------------------------------------------------------------- who's serving
function drawPeople(panel, s) {
  const reload = async () => { Object.assign(s, await get(`/services/${s.id}`)); drawPeople(panel, s); };
  const anyScheduling = s.positions.some((p) => p.can_schedule);
  const badge = (a) => ({ pending: html`<span class="pill">Waiting</span>`, accepted: html`<span class="pill good">${icon('check')} Accepted</span>`, declined: html`<span class="pill bad" title="${a.decline_reason}">Declined</span>` })[a.status];
  const teams = [...new Set(s.positions.map((p) => p.team_name))];
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Who’s serving</h2>
      ${anyScheduling && s.positions.some((p) => p.needed) ? html`<button class="btn small" data-autofill title="Fill open spots with available people, rotating fairly">${icon('wand')} Fill open spots</button>` : ''}
      ${can('staff') ? html`<button class="btn small" data-needs>${icon('edit')} Positions needed</button>` : ''}
      ${anyScheduling ? html`<button class="btn small ghost" data-add-position title="Schedule someone in a position this service doesn't usually need">${icon('plus')} Extra position</button>` : ''}</div>
    ${s.positions.length ? teams.map((team) => html`<h3 style="margin-top:14px">${team}</h3><div class="grid three">
      ${s.positions.filter((p) => p.team_name === team).map((p) => {
        const live = p.assignments.filter((a) => a.status !== 'declined');
        const open = Math.max(0, p.needed - live.length);
        return html`<div class="position">
          <div class="position-head"><b>${p.name}</b>${p.needed ? html`<span class="muted small">${live.length}/${p.needed}</span>` : ''}</div>
          ${p.assignments.map((a) => html`<div class="slot">${avatar(a)}<a class="name" href="#/people/${a.person_id}" style="color:inherit">${displayName(a)}</a>${badge(a)}
            ${p.can_schedule ? html`<button class="icon-btn" data-unassign="${a.id}" title="Remove">${icon('x')}</button>` : ''}</div>`)}
          ${Array.from({ length: open }, () => html`<div class="slot open">${p.can_schedule ? html`<button class="btn small" data-assign="${p.id}">${icon('plus')} Schedule someone</button>` : 'Open'}</div>`)}
          ${!open && p.can_schedule ? html`<button class="btn small ghost" data-assign="${p.id}">${icon('plus')} Add another</button>` : ''}
        </div>`;
      })}</div>`)
      : html`<div class="empty">No positions for this service yet.${can('staff') ? ' Click Positions needed to choose who this service needs.' : ''}</div>`}
  </div>`);

  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.assign) await assign(s, s.positions.find((p) => p.id === Number(b.dataset.assign)) , reload);
      if (b.dataset.unassign) { await del(`/assignments/${b.dataset.unassign}`); reload(); }
      if (b.matches('[data-autofill]')) {
        const r = await post(`/services/${s.id}/autofill`);
        toast(r.added.length ? `Scheduled ${r.added.length}: ${r.added.map((a) => a.person).join(', ')}` : 'No one available to fill the open spots.');
        reload();
      }
      if (b.matches('[data-needs]')) {
        if (await needsDialog(s)) reload();
      }
      if (b.matches('[data-add-position]')) {
        const teams = (await get('/teams')).filter((t) => t.positions.length);
        const all = teams.flatMap((t) => t.positions.map((p) => ({ value: p.id, label: `${t.name} — ${p.name}`, team: t })));
        let pid;
        await dialog({ title: 'Schedule an extra position', submit: 'Next', body: html`<label class="field">Position<select name="p">${options(all)}</select></label>`, onSubmit: (f) => { pid = Number(f.p.value); } });
        if (pid) {
          const t = all.find((x) => x.value === pid);
          await assign(s, { id: pid, name: t.label }, reload);
        }
      }
    } catch (err) { fail(err); }
  };
}

async function assign(s, pos, reload) {
  const list = await get(`/services/${s.id}/candidates?position_id=${pos.id}`);
  const taken = new Set(s.positions.find((p) => p.id === pos.id)?.assignments.filter((a) => a.status !== 'declined').map((a) => a.person_id) || []);
  const rows = list.filter((c) => !taken.has(c.id));
  const why = (c) => html`${c.conflicts.map((x) => html`<span class="pill ${x.level === 'block' ? 'bad' : 'warn'}">${x.text}</span> `)}
    ${!c.plays_position ? html`<span class="pill">Not usually ${pos.name}</span> ` : ''}
    <div class="muted small">${c.last_served ? `Last served ${fmtDate(c.last_served)}` : 'Hasn’t served yet'}${c.recent_count ? ` · serving ${c.recent_count} other ${c.recent_count === 1 ? 'day' : 'days'} within 4 weeks` : ''}</div>`;
  let picked;
  await dialog({
    title: `Schedule ${pos.name}`, submit: null,
    body: html`${rows.length ? html`<p class="muted small">Best choices first: people who play this position, aren’t away or booked elsewhere, and haven’t served recently.</p>
      <div class="picker-list">${rows.map((c, i) => html`<button type="button" data-i="${i}">${avatar(c)}<span>${displayName(c)}</span><span class="why">${why(c)}</span></button>`)}</div>`
      : html`<p class="muted">No one on this team yet. Add members on the team’s page.</p>`}
      <button type="button" class="btn small ghost" data-anyone style="margin-top:10px">Someone not on the team…</button>`,
    onOpen: (d, close) => {
      d.querySelector('.picker-list')?.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { picked = rows[b.dataset.i]; close(); } });
      d.querySelector('[data-anyone]').onclick = async () => {
        close();
        const p = await pickPerson(`Schedule ${pos.name}`);
        if (p) await save(p);
      };
    },
  });
  if (picked) await save(picked);

  async function save(person) {
    try {
      await post(`/services/${s.id}/assignments`, { position_id: pos.id, person_id: person.id });
      toast(`${displayName(person)} scheduled. They’ll see it in My Schedule.`);
    } catch (e) {
      if (e.status !== 409) throw e;
      if (!(await confirm('Schedule anyway?', `${displayName(person)}: ${e.message}`, 'Schedule anyway'))) return;
      await post(`/services/${s.id}/assignments`, { position_id: pos.id, person_id: person.id, force: true });
    }
    reload();
  }
}

// ---------------------------------------------------------------- attendance
function drawCounts(panel, s) {
  drawRollCall(panel, s).catch(fail);
}
