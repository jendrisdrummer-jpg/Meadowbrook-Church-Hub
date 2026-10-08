// One service: order of service, who's serving, and attendance counts.
import { get, post, patch, put, del, html, raw, mount, icon, avatar, displayName, dialog, formData, options, toast, fail, confirm, fmtDate, fmtTime, fmtLength, parseLength, debounce, addDays, pickPerson } from '../lib.js';
import { state, can, setTitle, go } from '../app.js';
import { editServiceDialog, needsDialog, repeatLabel } from '../service-forms.js';
import { drawRollCall } from '../rollcall.js';
import { drawPlan } from '../plan.js';
import { assignDialog } from '../scheduling.js';

const taken = (s, positionId) => new Set(s.positions.find((p) => p.id === positionId)?.assignments.filter((a) => a.status !== 'declined').map((a) => a.person_id) || []);

export default async function service(el, id) {
  const s = await get(`/services/${id}`);
  const staff = can('staff');
  setTitle(`${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(s.starts_at)}`,
    html`${s.can_lock ? html`<button class="btn" data-lock title="${s.locked ? 'Let people edit the plan and schedule again' : 'Stop changes to the plan and schedule (admins can still edit)'}">${icon(s.locked ? 'unlock' : 'lock')} ${s.locked ? 'Unlock' : 'Lock'}</button>` : ''}
      ${staff && (!s.locked || can('admin')) ? html`<button class="btn" data-edit>${icon('edit')} Details</button>` : ''}`);
  const tab = sessionStorage.getItem('mb.service.tab') || 'plan';

  mount(el, html`
    <div class="row muted" style="margin:-6px 0 12px"><span class="campus-tag"><span class="dot" style="background:${s.campus.color}"></span>${s.campus.name}</span>
      ${s.type ? html`<span title="Repeating service">· ${icon('calendar', 'ic small-ic')} ${repeatLabel(s.type)}</span>` : ''}${s.series ? html`<span>· ${s.series}</span>` : ''}${s.title ? html`<span>· ${s.title}</span>` : ''}</div>
    ${s.locked ? html`<div class="alert" style="margin-bottom:12px">${icon('lock', 'ic small-ic')} This service is locked, so its order of service and schedule can’t be changed${can('admin') ? ' (you can still edit as an admin)' : ''}.</div>` : ''}
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
    const plan = (p) => drawPlan(p, s, { canSaveTemplate: can('staff'), onChange: () => service(el, id) });
    ({ plan, people: drawPeople, counts: drawCounts })[name](panel, s);
  };
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  show(['plan', 'people', 'counts'].includes(tab) && (tab !== 'counts' || can('leader')) ? tab : 'plan');

  document.querySelector('[data-actions] [data-lock]')?.addEventListener('click', async () => {
    try {
      await patch(`/services/${s.id}`, { locked: !s.locked });
      toast(s.locked ? 'Unlocked.' : 'Locked. Only admins can change it now.');
      service(el, id);
    } catch (e) { fail(e); }
  });
  document.querySelector('[data-actions] [data-edit]')?.addEventListener('click', async () => {
    const r = await editServiceDialog(s);
    if (r === 'deleted') go('/services');
    else if (r) service(el, id);
  });
}

// ---------------------------------------------------------------- who's serving
function drawPeople(panel, s) {
  const reload = async () => { Object.assign(s, await get(`/services/${s.id}`)); drawPeople(panel, s); };
  const anyScheduling = s.positions.some((p) => p.can_schedule);
  const badge = (a) => ({ pending: html`<span class="pill">Waiting</span>`, accepted: html`<span class="pill good">${icon('check')} Accepted</span>`, declined: html`<span class="pill bad" title="${a.decline_reason}">Declined</span>` })[a.status];
  // A team is "in" this service when it needs someone or has someone scheduled; the rest can be shown on demand.
  const active = (teamId) => s.positions.some((p) => p.team_id === teamId && (p.needed || p.assignments.length));
  const allTeams = [...new Map(s.positions.map((p) => [p.team_id, { id: p.team_id, name: p.team_name, color: p.team_color, active: active(p.team_id) }])).values()]
    .sort((a, b) => (b.active - a.active));
  // The scheduler's team filter, remembered across services.
  let only = JSON.parse(localStorage.getItem('mb.serving.teams') || '[]').filter((id) => allTeams.some((t) => t.id === id));
  const shown = only.length ? allTeams.filter((t) => only.includes(t.id)) : allTeams.filter((t) => t.active);
  const teamStats = (t) => {
    const ps = s.positions.filter((p) => p.team_id === t.id);
    const open = ps.reduce((a, p) => a + Math.max(0, p.needed - p.assignments.filter((x) => x.status !== 'declined').length), 0);
    return open;
  };
  mount(panel, html`<div class="card">
    ${allTeams.length > 1 ? html`<div class="team-filter" data-team-filter>
      <button type="button" class="chip link ${only.length ? '' : 'on'}" data-team="all">All teams</button>
      ${allTeams.map((t) => html`<button type="button" class="chip link ${only.includes(t.id) ? 'on' : ''} ${t.active ? '' : 'idle'}" data-team="${t.id}" title="${t.active ? '' : 'Not set up for this service yet'}"><span class="dot" style="background:${t.color}"></span>${t.name}
        ${teamStats(t) ? html`<span class="cal-flag warn">${teamStats(t)}</span>` : ''}</button>`)}
    </div>` : ''}
    <div class="card-head"><h2>Who’s serving</h2>
      ${anyScheduling && s.positions.some((p) => p.needed) ? html`<button class="btn small" data-autofill title="Fill open spots with available people, rotating fairly">${icon('wand')} Fill open spots</button>` : ''}
      ${can('staff') && (!s.locked || can('admin')) ? html`<button class="btn small" data-needs>${icon('edit')} Positions needed</button>` : ''}
      ${anyScheduling ? html`<button class="btn small ghost" data-add-position title="Schedule someone in a position this service doesn't usually need">${icon('plus')} Extra position</button>` : ''}</div>
    ${shown.length ? shown.map((team) => html`<h3 style="margin-top:14px"><span class="dot" style="background:${team.color}"></span> ${team.name}</h3>
      ${team.active ? '' : html`<p class="muted small">This team isn’t set up for this service. Schedule people anyway, or use <b>Positions needed</b> to add it to this service (and future ones).</p>`}
      <div class="grid three">
      ${s.positions.filter((p) => p.team_id === team.id).map((p) => {
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
      : html`<div class="empty">No teams are set up for this service yet.${can('staff') ? ' Click Positions needed to choose who it needs, or pick a team above.' : ''}</div>`}
  </div>`);

  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.team) {
      // Click a team to show just it; click more to add them; "All teams" clears the filter.
      if (b.dataset.team === 'all') only = [];
      else {
        const id = Number(b.dataset.team);
        only = only.includes(id) ? only.filter((x) => x !== id) : [...only, id];
      }
      localStorage.setItem('mb.serving.teams', JSON.stringify(only));
      return drawPeople(panel, s);
    }
    try {
      if (b.dataset.assign) await assignDialog(s.id, s.positions.find((p) => p.id === Number(b.dataset.assign)), taken(s, Number(b.dataset.assign)), reload);
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
          await assignDialog(s.id, { id: pid, name: t.label }, taken(s, pid), reload);
        }
      }
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- attendance
function drawCounts(panel, s) {
  drawRollCall(panel, s).catch(fail);
}
