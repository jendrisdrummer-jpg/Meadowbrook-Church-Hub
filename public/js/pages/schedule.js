// Schedule a team for a whole month: positions down the side, that month's services across the
// top. Pick someone from the team list, then click open spots (or drag them onto a spot).
import { get, post, del, html, raw, mount, icon, avatar, displayName, dialog, toast, fail, fmtDate, fmtTime, today } from '../lib.js';
import { state, setTitle, campusName, can } from '../app.js';
import { assignDialog, scheduleOne, sendRequests, reachPill, reachShort } from '../scheduling.js';

const KEY = 'mb.schedule';
const STATUS = { pending: 'Waiting for a reply', accepted: 'Accepted', declined: 'Declined', draft: 'Not asked yet' };
const statusOf = (a) => (!a.sent_at && a.status !== 'declined' ? 'draft' : a.status);

export default async function schedule(el) {
  const prefs = JSON.parse(sessionStorage.getItem(KEY) || '{}');
  let month = prefs.month || today().slice(0, 7);
  let seriesId = prefs.seriesId ?? null;
  let teamId = prefs.teamId ?? null;
  let picked = null; // person id chosen in the side panel
  let grid;

  setTitle('Volunteer schedule', html`<button class="btn primary hidden" data-send></button><button class="btn hidden" data-remind></button><button class="btn" data-fill>${icon('wand')} Fill the month</button>`);
  const sendBtn = document.querySelector('[data-actions] [data-send]');
  const remindBtn = document.querySelector('[data-actions] [data-remind]');
  const [allSeries, allTeams] = await Promise.all([get('/series'), get('/teams')]);
  const inCampus = (cid) => !state.campusId || cid == null || cid === state.campusId;
  const series = allSeries.filter((t) => inCampus(t.campus_id));
  // A leader who isn't staff can only schedule (and see in full) the teams they lead, so the picker
  // lists just those. The server says which ones; staff get null and see every team.
  const ledIds = can('staff') ? null : (await get(`/schedule?month=${month}`)).led_team_ids;
  const teams = allTeams.filter((t) => !t.archived && inCampus(t.campus_id) && (!ledIds || ledIds.includes(t.id)));
  if (seriesId !== null && !series.some((t) => t.id === seriesId)) seriesId = null;
  if (prefs.seriesId === undefined && series.length) seriesId = series[0].id;
  if (teamId !== null && !teams.some((t) => t.id === teamId)) teamId = null;

  const remember = () => sessionStorage.setItem(KEY, JSON.stringify({ month, seriesId, teamId }));
  const monthLabel = () => new Date(`${month}-15T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (n) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    month = d.toISOString().slice(0, 7);
  };

  async function load() {
    remember();
    const q = new URLSearchParams({ month });
    if (seriesId) q.set('series_id', seriesId);
    else if (state.campusId) q.set('campus_id', state.campusId);
    if (teamId) q.set('team_id', teamId);
    grid = await get(`/schedule?${q}`);
    if (picked && !grid.members.some((m) => m.id === picked)) picked = null;
    draw();
  }

  // ---------------------------------------------------------------- drawing
  // Services dated before today (in the campus's own time zone) are history: read-only here.
  const dayAt = (cid) => {
    const tz = state.campuses?.find((c) => c.id === cid)?.timezone;
    try { return new Date().toLocaleDateString('en-CA', { timeZone: tz || undefined }); } catch { return today(); }
  };
  const isPast = (s) => s.starts_at.slice(0, 10) < dayAt(s.campus_id);
  const live = (cell) => (cell?.assignments || []).filter((a) => a.status !== 'declined');
  const isAway = (m, day) => m.away.some((b) => b.start_date <= day && b.end_date >= day);
  const serving = (personId, serviceId) => Object.entries(grid.cells).some(([k, c]) => k.startsWith(`${serviceId}:`) && live(c).some((a) => a.person_id === personId));

  // Per upcoming service the team can be reminded in: how many people were asked and haven't replied.
  function waitingFor() {
    if (!teamId) return [];
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    return grid.services.filter((s) => s.starts_at > nowLocal && s.can_schedule[teamId]).map((s) => ({
      id: s.id,
      n: grid.positions.filter((p) => p.team_id === teamId)
        .flatMap((p) => grid.cells[`${s.id}:${p.id}`]?.assignments || []).filter((a) => a.sent_at && a.status === 'pending').length,
    })).filter((w) => w.n);
  }

  function draw() {
    const { services, positions, cells, members } = grid;
    // Drafts this person can send, across the services and team shown.
    const drafts = services.filter((sv) => !isPast(sv)).flatMap((sv) => positions.filter((p) => sv.can_schedule[p.team_id])
      .flatMap((p) => (cells[`${sv.id}:${p.id}`]?.assignments || []).filter((a) => statusOf(a) === 'draft'))).length;
    const fillBtn = document.querySelector('[data-actions] [data-fill]');
    if (fillBtn) {
      const t = teams.find((x) => x.id === teamId);
      fillBtn.disabled = !t;
      fillBtn.title = t ? `Fill every open spot for ${t.name} this month` : 'Pick a team to fill';
      mount(fillBtn, html`${icon('wand')} ${t ? html`Fill the month <span class="fill-team">· ${t.name}</span>` : 'Fill the month'}`);
    }
    // Asked but not replied, for the chosen team, in services still to come.
    const waiting = waitingFor();
    const waitCount = waiting.reduce((a, w) => a + w.n, 0);
    remindBtn.classList.toggle('hidden', !teamId || !waitCount);
    remindBtn.textContent = (`Remind ${waitCount} who ${waitCount === 1 ? 'hasn’t' : 'haven’t'} replied`);
    sendBtn.classList.toggle('hidden', !drafts);
    sendBtn.textContent = `Send ${drafts} ${drafts === 1 ? 'request' : 'requests'}`;
    const multiCampus = new Set(services.map((s) => s.campus_id)).size > 1;
    const byTeam = [];
    for (const p of positions) {
      let g = byTeam.find((x) => x.id === p.team_id);
      if (!g) byTeam.push(g = { id: p.team_id, name: p.team_name, color: p.team_color, positions: [] });
      g.positions.push(p);
    }
    const team = teams.find((t) => t.id === teamId);
    // Teams belong to the whole church unless they have a campus; name the campus only when it
    // isn't obvious (no campus picked), instead of tagging every team "(all campuses)".
    const teamCampus = (t) => (t.campus_id && !state.campusId && !t.name.includes(campusName(t.campus_id)) ? ` · ${campusName(t.campus_id)}` : '');
    const sel = members.find((m) => m.id === picked);
    const openIn = (s) => isPast(s) ? 0 : positions.reduce((a, p) => a + Math.max(0, (cells[`${s.id}:${p.id}`]?.needed || 0) - live(cells[`${s.id}:${p.id}`]).length), 0);
    const totalOpen = services.reduce((a, s) => a + openIn(s), 0);

    mount(el, html`<div class="card sched-filters">
        <div class="row">
          <button class="btn small" data-shift="-1" aria-label="Previous month">←</button>
          <button class="btn small" data-shift="0">This month</button>
          <button class="btn small" data-shift="1" aria-label="Next month">→</button>
          <h2 style="margin:0 0 0 6px">${monthLabel()}</h2>
          ${services.length ? html`<span class="pill ${totalOpen ? 'warn' : 'good'}">${totalOpen ? `${totalOpen} open ${totalOpen === 1 ? 'spot' : 'spots'}` : html`${icon('check')} All filled`}</span>` : ''}
        </div>
        <div class="sched-selects">
          <label class="field sched-pick"><span>Services</span><span class="pick"><select data-series>
            <option value="">All services${state.campusId ? ` at ${campusName(state.campusId)}` : ''}</option>
            ${series.map((t) => html`<option value="${t.id}" ${t.id === seriesId ? raw('selected') : ''}>${t.campus_short || t.campus_name} · ${t.default_title || t.name}</option>`)}
          </select>${icon('down')}</span></label>
          <label class="field sched-pick"><span>Team</span><span class="pick ${team ? 'has-dot' : ''}">${team ? html`<span class="dot" style="background:${team.color}"></span>` : ''}<select data-team>
            <option value="">All teams</option>
            ${teams.map((t) => html`<option value="${t.id}" ${t.id === teamId ? raw('selected') : ''}>${t.name}${teamCampus(t)}</option>`)}
          </select>${icon('down')}</span></label>
          ${teamId ? '' : html`<p class="muted small sched-hint">Pick a team to fill the month.</p>`}
        </div>
      </div>
      <div class="sched-layout ${teamId ? 'with-side' : ''}">
        <div class="card sched-card">
          ${!services.length ? html`<div class="empty">No services this month${seriesId ? ' for this repeating service' : ''}.</div>`
            : !positions.length ? html`<div class="empty">${teamId ? 'This team has no positions yet. Add them on the Teams page.' : 'None of these services need anyone yet. Set Positions needed on a service or repeating service, or pick a team to schedule it anyway.'}</div>`
            : html`<div class="sched-scroll"><table class="sched">
              <thead><tr><th scope="col" class="pos-col">${sel ? html`<span class="small">Placing <b>${displayName(sel)}</b></span>` : html`<span class="sr-only">Position</span>`}</th>
                ${services.map((s) => {
                  const day = s.starts_at.slice(0, 10);
                  const open = openIn(s);
                  const note = sel ? (isAway(sel, day) ? html`<span class="pill bad">Away</span>` : serving(sel.id, s.id) ? html`<span class="pill info">Serving</span>` : '') : '';
                  return html`<th scope="col" class="${sel && isAway(sel, day) ? 'away' : ''}"><a href="#/services/${s.id}" class="sched-day">
                    <b>${fmtDate(s.starts_at)}</b><span class="muted small">${fmtTime(s.starts_at)}${multiCampus ? ` · ${s.campus_short || s.campus_name}` : ''}</span></a>
                    <div class="sched-th-flags">${isPast(s) ? html`<span class="muted small">Past</span>` : open ? html`<span class="cal-flag warn">${open}</span>` : html`<span class="cal-flag good" title="All positions filled">${icon('check')}<span class="sr-only">All positions filled</span></span>`}${s.locked ? html`<span title="Locked">${icon('lock', 'ic small-ic')}</span>` : ''}${note}</div></th>`;
                })}</tr></thead>
              <tbody>${byTeam.map((g) => html`
                ${byTeam.length > 1 || !teamId ? html`<tr class="team-row"><th scope="row" colspan="${services.length + 1}"><span class="dot" style="background:${g.color}"></span> ${g.name}</th></tr>` : ''}
                ${g.positions.map((p) => html`<tr><th scope="row" class="pos-col">${p.name}</th>
                  ${services.map((s) => cell(s, p, cells[`${s.id}:${p.id}`], sel))}</tr>`)}`)}
              </tbody></table></div>
              <p class="muted small" style="margin:10px 0 0">${teamId ? 'Pick someone from the team list, then click open spots to place them, or drag them onto a spot. ' : 'Pick a team to see its people alongside. '}Click a name to remove it or see their reply.</p>`}
        </div>
        ${teamId ? side(members, positions, sel) : ''}
      </div>`);
  }

  function cell(s, p, c, sel) {
    const can = s.can_schedule[p.team_id] && !isPast(s);
    const needed = c?.needed || 0;
    const list = c?.assignments || [];
    const open = isPast(s) ? 0 : Math.max(0, needed - live(c).length);
    const day = s.starts_at.slice(0, 10);
    // With someone picked, open spots they can take (their position, not away, not already serving then) offer them.
    const ready = sel && sel.position_ids.includes(p.id) && !isAway(sel, day) && !serving(sel.id, s.id);
    const dropHere = can ? raw(`data-drop="${s.id}:${p.id}"`) : '';
    return html`<td class="${needed ? '' : 'not-needed'} ${open ? 'has-open' : ''}" ${dropHere}>
      ${list.map((a) => html`<button type="button" class="sch-chip st-${statusOf(a)} ${a.person_id === picked ? 'mine' : ''}" data-chip="${a.id}" data-svc="${s.id}" title="${displayName(a)} · ${STATUS[statusOf(a)]}">
        <span class="sch-dot" aria-hidden="true"></span>${displayName(a)}<span class="sr-only">, ${STATUS[statusOf(a)]}</span></button>`)}
      ${can ? Array.from({ length: open }, () => html`<button type="button" class="sch-open ${ready ? 'ready' : ''}" data-add="${s.id}:${p.id}" title="${ready ? `Schedule ${displayName(sel)}` : 'Choose someone'}">${icon('plus')} ${ready ? sel.nickname || sel.first_name : 'Open'}</button>`)
        : open ? html`<span class="muted small">${open} open</span>` : ''}
      ${can && !open ? html`<button type="button" class="sch-more" data-add="${s.id}:${p.id}" title="${needed ? 'Add another' : 'Schedule someone (not usually needed)'}">${icon('plus')}</button>` : ''}
    </td>`;
  }

  function side(members, positions, sel) {
    const posName = Object.fromEntries(positions.map((p) => [p.id, p.name]));
    const month1 = `${month}-01`;
    return html`<aside class="card sched-side">
      <div class="card-head"><h2>Team</h2>${sel ? html`<button class="btn small ghost" data-unpick>Done</button>` : ''}</div>
      ${members.length ? html`<div class="sched-people">${members.map((m) => html`<button type="button" class="sched-person ${m.id === picked ? 'on' : ''}" data-person="${m.id}" draggable="true">
          ${avatar(m)}<span class="who"><b>${displayName(m)}</b>${m.is_leader ? html` <span class="pill info">Leader</span>` : ''}${reachPill(m)}
            ${m.reachable === false ? html`<span class="muted small">${reachShort(m.unreachable_reason)}</span>` : ''}
            <span class="muted small">${m.position_ids.map((id) => posName[id]).filter(Boolean).join(', ') || 'No position yet'}</span>
            ${m.away.map((b) => html`<span class="small away-note">Away ${fmtDate(b.start_date < month1 ? month1 : b.start_date, { month: 'short', day: 'numeric' })}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date, { month: 'short', day: 'numeric' })}` : ''}</span>`)}</span>
          <span class="count ${m.month_count ? '' : 'zero'}" title="Days serving this month">${m.month_count}×</span></button>`)}</div>`
        : html`<p class="muted small">No one is on this team yet. Add people on the Teams page.</p>`}
    </aside>`;
  }

  // ---------------------------------------------------------------- actions
  const findCell = (key) => {
    const [sid, pid] = key.split(':').map(Number);
    return { s: grid.services.find((x) => x.id === sid), p: grid.positions.find((x) => x.id === pid), c: grid.cells[key] };
  };

  async function place(key, personId) {
    const { s, p } = findCell(key);
    const m = grid.members.find((x) => x.id === personId);
    if (await scheduleOne(s.id, p.id, m)) toast(`${displayName(m)} scheduled for ${p.name}, ${fmtDate(s.starts_at)}.`);
    await load();
  }

  async function chipMenu(id, serviceId) {
    const s = grid.services.find((x) => x.id === serviceId);
    const a = Object.values(grid.cells).flatMap((c) => c.assignments).find((x) => x.id === id);
    const pos = grid.positions.find((p) => p.id === a.position_id);
    const can = s.can_schedule[pos.team_id] && !isPast(s);
    const r = await dialog({
      title: displayName(a), submit: can ? 'Remove from this service' : null, danger: true, cancel: 'Close',
      body: html`<p>${pos.name} · ${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} at ${fmtTime(s.starts_at)}</p>
        ${a.status === 'declined' && a.decline_reason ? html`<p class="muted small">“${a.decline_reason}”</p>` : ''}
        <p><span class="pill ${a.status === 'accepted' ? 'good' : a.status === 'declined' ? 'bad' : statusOf(a) === 'draft' ? 'draft' : ''}">${STATUS[statusOf(a)]}</span></p>
        ${can && a.sent_at && a.status !== 'declined' ? html`<p class="small">${icon('info', 'ic small-ic')} If you remove them, they'll get a “No longer needed” notice.</p>` : ''}
        <p class="small"><a href="#/people/${a.person_id}">Open their profile</a> · <a href="#/services/${s.id}">Open the service</a></p>`,
    });
    if (r) { await del(`/assignments/${id}`); await load(); }
  }

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.shift !== undefined) {
        const n = Number(b.dataset.shift);
        if (n) shift(n); else month = today().slice(0, 7);
        return await load();
      }
      if (b.dataset.person) { picked = picked === Number(b.dataset.person) ? null : Number(b.dataset.person); return draw(); }
      if (b.matches('[data-unpick]')) { picked = null; return draw(); }
      if (b.dataset.chip) return await chipMenu(Number(b.dataset.chip), Number(b.dataset.svc));
      if (b.dataset.add) {
        const { s, p, c } = findCell(b.dataset.add);
        const sel = grid.members.find((m) => m.id === picked);
        if (sel && b.classList.contains('ready')) return await place(b.dataset.add, sel.id);
        const taken = new Set(live(c).map((a) => a.person_id));
        return await assignDialog(s.id, p, taken, () => load().catch(fail));
      }
    } catch (err) { fail(err); }
  };
  el.onchange = (e) => {
    if (e.target.matches('[data-series]')) seriesId = Number(e.target.value) || null;
    else if (e.target.matches('[data-team]')) { teamId = Number(e.target.value) || null; picked = null; }
    else return;
    load().catch(fail);
  };

  // Drag a team member onto a spot.
  el.ondragstart = (e) => {
    const b = e.target.closest('[data-person]');
    if (b) e.dataTransfer.setData('text/x-person', b.dataset.person);
  };
  el.ondragover = (e) => {
    const td = e.target.closest('td[data-drop]');
    if (!td || !e.dataTransfer.types.includes('text/x-person')) return;
    e.preventDefault();
    el.querySelectorAll('td.drop-over').forEach((x) => x !== td && x.classList.remove('drop-over'));
    td.classList.add('drop-over');
  };
  el.ondragleave = (e) => e.target.closest?.('td[data-drop]')?.classList.remove('drop-over');
  el.ondrop = (e) => {
    const td = e.target.closest('td[data-drop]');
    const person = Number(e.dataTransfer.getData('text/x-person'));
    if (!td || !person) return;
    e.preventDefault();
    td.classList.remove('drop-over');
    place(td.dataset.drop, person).catch(fail);
  };

  sendBtn.addEventListener('click', async () => {
    try { if (await sendRequests(grid.services.filter((sv) => !isPast(sv)).map((sv) => sv.id), teamId)) await load(); } catch (err) { fail(err); }
  });

  // Remind one team across the month: the same reminder as on a service, once per upcoming service.
  remindBtn.addEventListener('click', async () => {
    const team = teams.find((t) => t.id === teamId);
    const list = waitingFor();
    const n = list.reduce((a, w) => a + w.n, 0);
    if (!team || !n) return;
    const ok = await dialog({
      title: 'Remind people?', submit: 'Send reminders',
      body: html`<p>Send a friendly reminder to ${n} ${n === 1 ? 'person' : 'people'} on <b>${team.name}</b> who haven’t replied yet, across ${list.length} upcoming ${list.length === 1 ? 'service' : 'services'}? Anyone reminded in the last 12 hours is skipped.</p>`,
    });
    if (!ok) return;
    let reminded = 0;
    let skipped = 0;
    try {
      for (const w of list) {
        try { const r = await post(`/services/${w.id}/remind`, { team_id: teamId }); reminded += r.reminded; skipped += r.skipped; } catch (err) { if (err.status === 403) throw err; /* a service that already happened */ }
      }
      toast(reminded ? `Reminded ${reminded} ${reminded === 1 ? 'person' : 'people'}${skipped ? ` (${skipped} reminded recently, skipped)` : ''}.` : 'Everyone was already reminded in the last 12 hours.');
    } catch (err) { fail(err); }
  });

  document.querySelector('[data-actions] [data-fill]').addEventListener('click', async () => {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return toast('Choose a team to fill.');
    const ids = grid.services.map((s) => s.id);
    if (!ids.length) return toast('No services this month.');
    const ok = await dialog({
      title: 'Fill the month', submit: 'Fill open spots',
      body: html`<p>Fill every open spot for <b>${team.name}</b> in ${monthLabel()} (${ids.length} ${ids.length === 1 ? 'service' : 'services'} shown)?</p>
        <p class="muted small">Only people assigned to each position, never anyone away or already serving at that time, spreading the Sundays out fairly. Everyone already scheduled stays. Nobody is told yet: look it over, then use Send requests.</p>`,
    });
    if (!ok) return;
    try {
      const r = await post('/schedule/autofill', { service_ids: ids, team_id: teamId });
      toast(r.added.length ? `Added ${r.added.length} ${r.added.length === 1 ? 'person' : 'people'}. Look it over, then Send requests.` : r.open === 0 ? 'Every spot is already filled.' : 'No one available to fill the open spots. Check who’s on the team, who’s away, and who serves at this campus.');
      await load();
    } catch (err) { fail(err); }
  });

  await load();
}
