// Dialogs for creating and editing services, repeating services and the positions they need.
import { get, post, patch, put, del, html, mount, icon, dialog, formData, options, confirm, toast, DAYS } from './lib.js';
import { state, visibleCampuses } from './app.js';

const REPEATS = [
  { value: 0, label: 'Does not repeat' },
  { value: 1, label: 'Every week' },
  { value: 2, label: 'Every 2 weeks' },
  { value: 3, label: 'Every 3 weeks' },
  { value: 4, label: 'Every 4 weeks' },
];

export function repeatLabel(series) {
  if (!series) return '';
  const every = series.every_weeks > 1 ? `Every ${series.every_weeks} weeks on ${DAYS[series.day_of_week]}` : `Every ${DAYS[series.day_of_week]}`;
  return `${every} at ${fmtClock(series.start_time)}${series.ends_on ? `, until ${new Date(`${series.ends_on}T12:00`).toLocaleDateString()}` : ''}`;
}

export const fmtClock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Position counts grouped by team, with − / + steppers. Returns { get() → [{position_id, count}] }.
export async function needsPicker(el, campusId, initial = []) {
  const teams = (await get('/teams')).filter((t) => t.positions.length && (t.campus_id == null || t.campus_id === Number(campusId)));
  const counts = new Map(initial.map((n) => [n.position_id, n.count]));
  const draw = () => mount(el, teams.length ? html`<div class="needs">${teams.map((t) => html`<div class="needs-team">
      <div class="needs-head"><span class="dot" style="background:${t.color}"></span>${t.name}</div>
      ${t.positions.map((p) => {
        const n = counts.get(p.id) || 0;
        return html`<div class="needs-row ${n ? 'on' : ''}"><span>${p.name}</span>
          <span class="stepper"><button type="button" data-dec="${p.id}" aria-label="Fewer ${p.name}" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button type="button" data-inc="${p.id}" aria-label="More ${p.name}">+</button></span></div>`;
      })}</div>`)}</div>`
    : html`<p class="muted small">No teams with positions yet. Create them on the <a href="#/teams">Teams</a> page.</p>`);
  el.onclick = (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) counts.set(Number(inc.dataset.inc), (counts.get(Number(inc.dataset.inc)) || 0) + 1);
    else if (dec) counts.set(Number(dec.dataset.dec), Math.max(0, (counts.get(Number(dec.dataset.dec)) || 0) - 1));
    else return;
    draw();
  };
  draw();
  return { get: () => [...counts].filter(([, c]) => c > 0).map(([position_id, count]) => ({ position_id, count })) };
}

// New service (one-off or repeating). Resolves to the id of the service to open, if created.
export async function newServiceDialog(date) {
  const camps = visibleCampuses();
  const templates = await get('/templates').catch(() => []);
  let picker;
  let openId;
  await dialog({
    title: 'New service', wide: true, submit: 'Create',
    body: html`<div class="form">
      <label class="field">Campus<select name="campus_id" required>${options(camps.map((c) => ({ value: c.id, label: c.name })), state.campusId ?? camps[0]?.id)}</select></label>
      <label class="field">Date<input type="date" name="date" value="${date || ''}" required></label>
      <label class="field">Starts<input type="time" name="time" value="09:00" required></label>
      <label class="field">Length (minutes)<input type="number" name="duration_min" value="75" min="5"></label>
      <label class="field">Repeats<select name="every_weeks">${options(REPEATS, 1)}</select></label>
      <label class="field" data-ends>Ends<input type="date" name="ends_on"><span class="muted small">Leave empty to keep going.</span></label>
      <label class="field">Title (optional)<input type="text" name="title" placeholder="Sunday Morning"></label>
      <label class="field">Start from template<select name="template_id">${options(templates.map((t) => ({ value: t.id, label: t.name, campus: t.campus_id })), '', { blank: 'Blank order of service' })}</select>
        <span class="muted small" data-tpl-note>Repeating services fill each new date from it.</span></label>
    </div>
    <h3 style="margin-top:16px">Positions needed</h3>
    <p class="muted small">How many people each service needs. You can change it for a single Sunday later. Leave empty to use the template’s.</p>
    <div data-needs></div>`,
    onOpen: async (d) => {
      const f = d.querySelector('form');
      const ends = d.querySelector('[data-ends]');
      const sync = () => ends.classList.toggle('hidden', f.every_weeks.value === '0');
      f.every_weeks.onchange = sync;
      sync();
      picker = await needsPicker(d.querySelector('[data-needs]'), f.campus_id.value);
      f.campus_id.onchange = async () => { picker = await needsPicker(d.querySelector('[data-needs]'), f.campus_id.value, picker.get()); };
    },
    onSubmit: async (f) => {
      const b = formData(f);
      const needs = picker?.get() || [];
      if (b.every_weeks !== '0') {
        const r = await post('/series', { campus_id: b.campus_id, starts_on: b.date, start_time: b.time, duration_min: b.duration_min, every_weeks: b.every_weeks, ends_on: b.ends_on || null, title: b.title, needs, template_id: b.template_id || null });
        openId = r.first_service_id;
        toast('Repeating service created.');
      } else {
        openId = (await post('/services', { campus_id: b.campus_id, starts_at: `${b.date}T${b.time}`, duration_min: b.duration_min, title: b.title, needs, template_id: b.template_id || null })).id;
      }
    },
  });
  return openId;
}

// Asks "just this one or this and all following?" for a service in a series. null = cancelled.
async function askScope(s, verb) {
  if (!s.type) return 'one';
  let scope = null;
  await dialog({
    title: `${verb} repeating service`, submit: null, cancel: 'Cancel',
    body: html`<p class="muted">${repeatLabel(s.type)}</p><div class="stack">
      <button type="button" class="btn" data-one>Just this service</button>
      <button type="button" class="btn" data-future>This and all following services</button></div>`,
    onOpen: (d, close) => {
      d.querySelector('[data-one]').onclick = () => { scope = 'one'; close(); };
      d.querySelector('[data-future]').onclick = () => { scope = 'future'; close(); };
    },
  });
  return scope;
}

// Edit date/time/length/title/notes. Resolves to 'deleted', true (saved) or undefined.
export async function editServiceDialog(s) {
  let outcome;
  const templates = s.type ? await get('/templates').catch(() => []) : [];
  await dialog({
    title: 'Service details', submit: 'Save',
    body: html`<div class="form">
      ${s.type ? html`<div class="alert info wide small">${icon('calendar')} ${repeatLabel(s.type)}</div>` : ''}
      <label class="field">Date<input type="date" name="date" value="${s.starts_at.slice(0, 10)}" required></label>
      <label class="field">Starts<input type="time" name="time" value="${s.starts_at.slice(11)}" required></label>
      <label class="field">Length (minutes)<input type="number" name="duration_min" value="${s.duration_min}"></label>
      <label class="field">Sermon series<input type="text" name="series" value="${s.series}"></label>
      <label class="field wide">Title<input type="text" name="title" value="${s.title}"></label>
      <label class="field wide">Notes for the team<textarea name="notes">${s.notes}</textarea></label>
      ${s.type && templates.length ? html`<label class="field wide">Template for new services in this series<select name="series_template">${options(templates.map((t) => ({ value: t.id, label: t.name })), s.type.template_id, { blank: 'None' })}</select>
        <span class="muted small">Upcoming services that don’t have a plan yet get it too.</span></label>` : ''}
    </div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn danger small" data-delete>${icon('trash')} Delete service</button>
      ${s.type ? html`<button type="button" class="btn danger small ghost" data-stop>Stop repeating</button>` : ''}</div>`,
    onOpen: (d, close) => {
      d.querySelector('[data-delete]').onclick = async () => {
        const scope = await askScope(s, 'Delete');
        if (!scope) return;
        if (scope === 'future') {
          if (!(await confirm('Delete this and all following?', 'Their orders of service and schedules will be removed too.'))) return;
          await del(`/series/${s.type.id}?from=${s.starts_at.slice(0, 10)}`);
        } else {
          if (!(await confirm('Delete this service?', 'Its order of service and schedule will be removed.'))) return;
          await del(`/services/${s.id}`);
        }
        outcome = 'deleted';
        close();
      };
      d.querySelector('[data-stop]')?.addEventListener('click', async () => {
        if (!(await confirm('Stop repeating?', 'This service stays. Services after it are removed, along with their plans and schedules.', 'Stop repeating'))) return;
        await patch(`/series/${s.type.id}`, { ends_on: s.starts_at.slice(0, 10) });
        toast('This is now the last one.');
        outcome = true;
        close();
      });
    },
    onSubmit: async (f) => {
      const b = formData(f);
      // The series' template is a setting of the whole series, separate from "this one or all".
      if (s.type && b.series_template !== undefined && Number(b.series_template || 0) !== Number(s.type.template_id || 0)) {
        await patch(`/series/${s.type.id}`, { from_date: s.starts_at.slice(0, 10), template_id: b.series_template || null });
      }
      const changed = b.date !== s.starts_at.slice(0, 10) || b.time !== s.starts_at.slice(11) || Number(b.duration_min) !== s.duration_min
        || b.title !== s.title || b.series !== s.series || b.notes !== s.notes;
      if (!changed) { outcome = true; return; }
      const scope = await askScope(s, 'Change');
      if (!scope) return false;
      if (scope === 'future') {
        // A series keeps its day of the week; only time, length and title change from here on.
        await patch(`/series/${s.type.id}`, { from_date: s.starts_at.slice(0, 10), start_time: b.time, duration_min: b.duration_min, title: b.title });
        // Series, notes are per service; apply them to this one too.
        await patch(`/services/${s.id}`, { series: b.series, notes: b.notes });
      } else {
        await patch(`/services/${s.id}`, { starts_at: `${b.date}T${b.time}`, duration_min: b.duration_min, title: b.title, series: b.series, notes: b.notes });
      }
      outcome = true;
    },
  });
  return outcome;
}

// Positions needed for this service (or the series from here on).
export async function needsDialog(s) {
  let picker;
  const current = s.positions.filter((p) => p.needed).map((p) => ({ position_id: p.id, count: p.needed }));
  const ok = await dialog({
    title: 'Positions needed', wide: true, submit: 'Save',
    body: html`<div data-needs></div>`,
    onOpen: async (d) => { picker = await needsPicker(d.querySelector('[data-needs]'), s.campus_id, current); },
    onSubmit: async () => {
      const scope = await askScope(s, 'Change');
      if (!scope) return false;
      if (scope === 'future') await patch(`/series/${s.type.id}`, { from_date: s.starts_at.slice(0, 10), needs: picker.get() });
      else await put(`/services/${s.id}/needs`, { needs: picker.get() });
    },
  });
  return ok;
}

// Edit or delete a whole repeating service from today on. Resolves to true when something changed.
export async function seriesDialog(t) {
  const templates = await get('/templates').catch(() => []);
  const today = new Date().toLocaleDateString('en-CA');
  let picker;
  let outcome;
  await dialog({
    title: 'Edit repeating service', wide: true, submit: 'Save',
    body: html`<div class="alert info small">${icon('calendar')} ${repeatLabel(t)}. Changes apply to upcoming services; past ones stay as they were.</div>
    <div class="form">
      <label class="field">Name<input type="text" name="name" value="${t.name}" required></label>
      <label class="field">Title on each service (optional)<input type="text" name="title" value="${t.default_title}" placeholder="Sunday Morning"></label>
      <label class="field">Starts<input type="time" name="start_time" value="${t.start_time}" required></label>
      <label class="field">Length (minutes)<input type="number" name="duration_min" value="${t.duration_min}" min="5"></label>
      <label class="field">Ends<input type="date" name="ends_on" value="${t.ends_on || ''}" min="${today}"><span class="muted small">Leave empty to keep going.</span></label>
      <label class="field">Template<select name="template_id">${options(templates.map((x) => ({ value: x.id, label: x.name })), t.template_id, { blank: 'None' })}</select>
        <span class="muted small">Upcoming services without a plan yet get it too.</span></label>
    </div>
    <p class="muted small">It always repeats on ${DAYS[t.day_of_week]}. To move it to another day, delete it and add a new repeating service.</p>
    <h3 style="margin-top:16px">Positions needed</h3>
    <p class="muted small">Saving a change here resets the positions on every upcoming service in this series.</p>
    <div data-needs></div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn danger small" data-delete>${icon('trash')} Delete repeating service</button></div>`,
    onOpen: async (d, close) => {
      picker = await needsPicker(d.querySelector('[data-needs]'), t.campus_id, t.needs);
      d.querySelector('[data-delete]').onclick = async () => {
        if (await deleteSeries(t)) { outcome = true; close(); }
      };
    },
    onSubmit: async (f) => {
      const b = formData(f);
      const body = { from_date: today, name: b.name, title: b.title, start_time: b.start_time, duration_min: b.duration_min, ends_on: b.ends_on || null, template_id: b.template_id || null };
      const needs = picker.get();
      const key = (list) => JSON.stringify([...list].map((n) => [n.position_id, n.count]).sort((x, y) => x[0] - y[0]));
      if (key(needs) !== key(t.needs)) body.needs = needs;
      if (b.ends_on && b.ends_on !== t.ends_on && !(await confirm('End this repeating service?', `Services after ${new Date(`${b.ends_on}T12:00`).toLocaleDateString()} will be removed, with their plans and schedules.`, 'End it'))) return false;
      await patch(`/series/${t.id}`, body);
      toast('Repeating service updated.');
      outcome = true;
    },
  });
  return outcome;
}

// Deletes a repeating service's upcoming services (past ones, with their attendance, stay).
export async function deleteSeries(t) {
  const today = new Date().toLocaleDateString('en-CA');
  let ok = false;
  await dialog({
    title: 'Delete repeating service?', submit: 'Delete', danger: true,
    body: html`<p><b>${t.default_title || t.name}</b> · ${repeatLabel(t)}</p>
      <label class="field">Remove services from<input type="date" name="from" value="${today}" min="${today}" required></label>
      <p class="muted small">Services from that date on are deleted, with their orders of service and schedules. Past services and their attendance stay.</p>`,
    onSubmit: async (f) => {
      const r = await del(`/series/${t.id}?from=${f.from.value}`);
      toast(`Deleted ${r.removed} upcoming ${r.removed === 1 ? 'service' : 'services'}.`);
      ok = true;
    },
  });
  return ok;
}
