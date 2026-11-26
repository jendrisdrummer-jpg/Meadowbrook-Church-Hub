// One service: order of service, who's serving, and attendance counts.
import { get, post, patch, put, del, html, raw, mount, icon, avatar, displayName, dialog, formData, options, toast, fail, confirm, fmtDate, fmtTime, fmtLength, parseLength, debounce, addDays, pickPerson } from '../lib.js';
import { state, can, setTitle, go } from '../app.js';
import { editServiceDialog, needsDialog, repeatLabel } from '../service-forms.js';
import { drawRollCall } from '../rollcall.js';
import { drawPlan } from '../plan.js';
import { assignDialog, sendRequests, remindUnanswered, teamChats } from '../scheduling.js';

const taken = (s, positionId) => new Set(s.positions.find((p) => p.id === positionId)?.assignments.filter((a) => a.status !== 'declined').map((a) => a.person_id) || []);

export default async function service(el, id) {
  const s = await get(`/services/${id}`);
  const staff = can('staff');
  const title = `${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(s.starts_at)}`;
  const canEdit = staff && (!s.locked || can('admin'));
  const lockTip = s.locked ? 'Let people edit the plan and schedule again' : 'Stop changes to the plan and schedule (admins can still edit)';
  const lockLabel = s.locked ? 'Unlock' : 'Lock';
  // On phones the two buttons share one "…" menu so the top bar stays on one row.
  const phone = window.matchMedia('(max-width: 820px)');
  let menuOpen = false;
  const drawActions = () => {
    if (!phone.matches) {
      setTitle(title, html`${s.can_lock ? html`<button class="btn" data-lock title="${lockTip}">${icon(s.locked ? 'unlock' : 'lock')} ${lockLabel}</button>` : ''}
        ${canEdit ? html`<button class="btn" data-edit>${icon('edit')} Details</button>` : ''}`);
    } else if (s.can_lock || canEdit) {
      setTitle(title, html`<span style="position:relative"><button class="icon-btn" data-svc-menu aria-label="More for this service" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('dots')}</button>
        ${menuOpen ? html`<div class="menu" role="menu" style="top:calc(100% + 6px);bottom:auto;left:0;right:auto;width:200px">
          ${s.can_lock ? html`<button type="button" role="menuitem" data-lock>${icon(s.locked ? 'unlock' : 'lock')} ${lockLabel}</button>` : ''}
          ${canEdit ? html`<button type="button" role="menuitem" data-edit>${icon('edit')} Details</button>` : ''}</div>` : ''}</span>`);
    } else setTitle(title);
  };
  drawActions();
  phone.onchange = () => { if (el.isConnected) { menuOpen = false; drawActions(); } };
  const onLock = async () => {
    try {
      await patch(`/services/${s.id}`, { locked: !s.locked });
      toast(s.locked ? 'Unlocked.' : 'Locked. Only admins can change it now.');
      service(el, id);
    } catch (e) { fail(e); }
  };
  const onEdit = async () => {
    const r = await editServiceDialog(s);
    if (r === 'deleted') go('/services');
    else if (r) service(el, id);
  };
  const actions = document.querySelector('[data-actions]');
  actions.onclick = (e) => {
    if (!el.isConnected) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-svc-menu]')) { menuOpen = !menuOpen; drawActions(); actions.querySelector('[data-svc-menu]')?.focus(); return; }
    const was = menuOpen;
    menuOpen = false;
    if (was) drawActions();
    if (b.matches('[data-lock]')) onLock();
    if (b.matches('[data-edit]')) onEdit();
  };
  // Tap anywhere else (or press Escape) to close the menu.
  const closeMenu = (e) => {
    if (!el.isConnected) { document.removeEventListener('click', closeMenu, true); document.removeEventListener('keydown', closeMenu); return; }
    if (menuOpen && (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('[data-actions]'))) { menuOpen = false; drawActions(); }
  };
  document.addEventListener('click', closeMenu, true);
  document.addEventListener('keydown', closeMenu);
  const tab = sessionStorage.getItem('mb.service.tab') || 'plan';

  mount(el, html`
    <div class="row muted" style="margin:-6px 0 12px"><span class="campus-tag"><span class="dot" style="background:${s.campus.color}"></span>${s.campus.name}</span>
      ${s.type ? html`<span title="Repeating service">· ${icon('calendar', 'ic small-ic')} ${repeatLabel(s.type)}</span>` : ''}${s.series ? html`<span title="Series">· Series: ${s.series}</span>` : ''}${s.title ? html`<span>· ${s.title}</span>` : ''}</div>
    ${s.locked ? html`<div class="alert" style="margin-bottom:12px">${icon('lock', 'ic small-ic')} This service is locked, so its order of service and schedule can’t be changed${can('admin') ? ' (you can still edit as an admin)' : ''}.</div>` : ''}
    ${s.notes ? html`<div class="alert info" style="margin-bottom:12px;white-space:pre-wrap">${s.notes}</div>` : ''}
    <style>@media (max-width: 520px) { .svc-tabs button { padding: 10px 9px; font-size: 13.5px; } }</style>
    <div class="tabs svc-tabs" role="tablist">
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

}

// ---------------------------------------------------------------- who's serving
async function drawPeople(panel, s, chats) {
  chats ||= await teamChats();
  const reload = async () => { Object.assign(s, await get(`/services/${s.id}`)); drawPeople(panel, s, chats); };
  const anyScheduling = s.positions.some((p) => p.can_schedule);
  // Drafts haven't been sent yet; the volunteer doesn't know about them.
  const badge = (a) => (!a.sent_at && a.status !== 'declined' ? html`<span class="pill draft" title="Use Send requests to let them know">Not asked yet</span>` : ({ pending: html`<span class="pill">Waiting</span>`, accepted: html`<span class="pill good">${icon('check')} Accepted</span>`, declined: html`<span class="pill bad" title="${a.decline_reason}">Declined</span>` })[a.status]);
  // The reason (when the server sent one) as a quiet line, since a phone can't hover.
  const reason = (a) => (a.status === 'declined' && a.decline_reason ? html`<div class="muted small" style="margin:-2px 0 4px 36px">“${a.decline_reason}”</div>` : '');
  const drafts = s.positions.filter((p) => p.can_schedule).flatMap((p) => p.assignments).filter((a) => !a.sent_at && a.status !== 'declined').length;
  // A team is "in" this service when it needs someone or has someone scheduled; the rest can be shown on demand.
  const active = (teamId) => s.positions.some((p) => p.team_id === teamId && (p.needed || p.assignments.length));
  // Asked but not answered yet, in positions this person can schedule.
  const past = s.starts_at <= new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const waiting = past ? 0 : s.positions.filter((p) => p.can_schedule).flatMap((p) => p.assignments).filter((a) => a.sent_at && a.status === 'pending').length;
  const allTeams = [...new Map(s.positions.map((p) => [p.team_id, { id: p.team_id, name: p.team_name, color: p.team_color, active: active(p.team_id) }])).values()]
    .sort((a, b) => (b.active - a.active));
  // The scheduler's team pick (one team, or all), remembered across services.
  let only = JSON.parse(localStorage.getItem('mb.serving.teams') || '[]').filter((id) => allTeams.some((t) => t.id === id)).slice(0, 1);
  const picked = allTeams.find((t) => t.id === only[0]);
  // "All teams" lists every team: the ones in this service first, then the rest, so anyone can be scheduled.
  const shown = only.length ? allTeams.filter((t) => only.includes(t.id)) : allTeams;
  const teamStats = (t) => {
    const ps = s.positions.filter((p) => p.team_id === t.id);
    const open = ps.reduce((a, p) => a + Math.max(0, p.needed - p.assignments.filter((x) => x.status !== 'declined').length), 0);
    return open;
  };
  mount(panel, html`<div class="card">
    ${allTeams.length > 1 ? html`<div class="team-filter">
      <label class="field sched-pick"><span>Team</span><span class="pick ${picked ? 'has-dot' : ''}">${picked ? html`<span class="dot" style="background:${picked.color}"></span>` : ''}<select data-team-pick>
        <option value="">All teams</option>
        ${allTeams.map((t) => html`<option value="${t.id}" ${picked?.id === t.id ? raw('selected') : ''}>${t.name}${teamStats(t) ? ` · ${teamStats(t)} open` : ''}${t.active ? '' : ' · not set up'}</option>`)}
      </select>${icon('down')}</span></label>
    </div>` : ''}
    <div class="card-head"><h2>Who’s serving</h2>
      ${drafts ? html`<button class="btn small primary" data-send title="Let everyone you've scheduled know, all at once">${icon('bell')} Send ${drafts} ${drafts === 1 ? 'request' : 'requests'}</button>` : ''}
      ${waiting ? html`<button class="btn small" data-remind title="Send a reminder to people who were asked but haven't replied">${icon('bell')} Remind ${waiting} who ${waiting === 1 ? 'hasn’t' : 'haven’t'} replied</button>` : ''}
      ${can('staff') && (!s.locked || can('admin')) ? html`<button class="btn small" data-needs>${icon('edit')} Positions needed</button>` : ''}
      ${anyScheduling ? html`<button class="btn small ghost" data-add-position title="Schedule someone in a position this service doesn't usually need">${icon('plus')} Extra position</button>` : ''}</div>
    ${shown.length ? shown.map((team) => html`<h3 style="margin-top:14px;display:flex;flex-wrap:wrap;align-items:center;gap:8px"><span class="dot" style="background:${team.color}"></span> ${team.name}
        ${s.positions.some((p) => p.team_id === team.id && p.can_schedule) && teamStats(team) ? html`<button class="btn small" data-autofill="${team.id}" title="Fill this team’s open spots with available people, rotating fairly">${icon('wand')} Fill open spots</button>` : ''}
        ${chats.has(team.id) ? html`<a class="btn small ghost" href="#/chat/${chats.get(team.id)}" data-message-team style="margin-left:8px">${icon('chat')} Message team</a>` : ''}</h3>
      ${team.active || !s.positions.some((p) => p.team_id === team.id && p.detail !== false) ? '' : html`<p class="muted small">This team isn’t set up for this service. Schedule people anyway, or use <b>Positions needed</b> to add it to this service (and future ones).</p>`}
      <div class="grid three">
      ${s.positions.filter((p) => p.team_id === team.id).map((p) => {
        const live = p.assignments.filter((a) => a.status !== 'declined');
        // Teams you don't lead (detail === false) show who was asked or accepted, names only.
        const open = p.detail === false ? 0 : Math.max(0, p.needed - live.length);
        return html`<div class="position">
          <div class="position-head"><b>${p.name}</b>${p.needed && p.detail !== false ? html`<span class="muted small">${live.length}/${p.needed}</span>` : ''}</div>
          ${p.assignments.map((a) => html`<div class="slot ${!a.sent_at && a.status !== 'declined' ? 'draft' : ''}">${avatar(a)}<a class="name" href="#/people/${a.person_id}" style="color:inherit">${displayName(a)}</a>${badge(a)}
            ${p.can_schedule && a.status === 'declined' && p.detail !== false ? html`<button class="btn small" data-replace="${p.id}" title="Pick someone else for ${p.name}. They’re added as a draft until you Send requests.">Find a replacement</button>` : ''}
            ${p.can_schedule ? html`<button class="icon-btn" data-unassign="${a.id}" title="Remove">${icon('x')}</button>` : ''}</div>${reason(a)}`)}
          ${Array.from({ length: open }, () => html`<div class="slot open">${p.can_schedule ? html`<button class="btn small" data-assign="${p.id}">${icon('plus')} Schedule someone</button>` : 'Open'}</div>`)}
          ${!open && p.can_schedule ? html`<button class="btn small ghost" data-assign="${p.id}">${icon('plus')} Add another</button>` : ''}
        </div>`;
      })}</div>`)
      : html`<div class="empty">No teams are set up for this service yet.${can('staff') ? ' Click Positions needed to choose who it needs, or pick a team above.' : ''}</div>`}
  </div>`);

  panel.querySelector('[data-team-pick]')?.addEventListener('change', (e) => {
    only = e.target.value ? [Number(e.target.value)] : [];
    try { localStorage.setItem('mb.serving.teams', JSON.stringify(only)); } catch { /* private mode: not remembered */ }
    drawPeople(panel, s, chats);
  });
  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      // “Find a replacement” opens the same picker as “Schedule someone”.
      const assignId = Number(b.dataset.assign || b.dataset.replace);
      if (assignId) await assignDialog(s.id, s.positions.find((p) => p.id === assignId), taken(s, assignId), reload);
      if (b.dataset.unassign) {
        // Someone already asked (or who accepted) hears that they're no longer needed, so check first.
        // Drafts nobody has heard about yet still go with one tap.
        const pos = s.positions.find((p) => p.assignments.some((a) => a.id === Number(b.dataset.unassign)));
        const a = pos?.assignments.find((x) => x.id === Number(b.dataset.unassign));
        if (a?.sent_at && a.status !== 'declined') {
          const ok = await confirm(`Remove ${displayName(a)}?`,
            `${displayName(a)} ${a.status === 'accepted' ? 'accepted' : 'was asked to serve'} as ${pos.name} on ${fmtDate(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}. They'll get a “No longer needed” notice.`, 'Remove');
          if (!ok) return;
        }
        await del(`/assignments/${b.dataset.unassign}`); reload();
      }
      if (b.matches('[data-remind]') && (await remindUnanswered(s.id, waiting))) reload();
      if (b.matches('[data-send]') && (await sendRequests([s.id]))) reload();
      if (b.matches('[data-autofill]')) {
        const team = allTeams.find((t) => t.id === Number(b.dataset.autofill));
        const n = teamStats(team);
        const label = `${team.name}${s.campus?.name ? ` · ${s.campus.name}` : ''}`;
        const ok = await dialog({
          title: 'Fill open spots', submit: 'Fill open spots',
          body: html`<p>Fill ${n} open ${n === 1 ? 'spot' : 'spots'} for <b>${label}</b>?</p><p class="muted small">Nobody is told until you send requests.</p>`,
        });
        if (!ok) return;
        const r = await post(`/services/${s.id}/autofill`, { team_id: team.id });
        toast(r.added.length ? `Added ${r.added.length}: ${r.added.map((a) => a.person).join(', ')}. Send requests when you’re ready.` : 'No one available to fill the open spots.');
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
