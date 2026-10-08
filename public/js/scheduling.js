// Shared scheduling helpers for a service's Who's serving tab and the Schedule page.
import { get, post, html, mount, icon, avatar, displayName, dialog, toast, fail, confirm, fmtDate, pickPerson } from './lib.js';

// Schedules one person, asking first if they're away or already serving then. Returns false if cancelled.
export async function scheduleOne(serviceId, positionId, person) {
  try {
    await post(`/services/${serviceId}/assignments`, { position_id: positionId, person_id: person.id });
  } catch (e) {
    if (e.status !== 409) throw e;
    if (!(await confirm('Schedule anyway?', `${displayName(person)}: ${e.message}`, 'Schedule anyway'))) return false;
    await post(`/services/${serviceId}/assignments`, { position_id: positionId, person_id: person.id, force: true });
  }
  return true;
}

// Picks someone for one position at one service: people who play that position first, best
// choices first. `taken` = person ids already on it.
export async function assignDialog(serviceId, pos, taken, reload) {
  const list = await get(`/services/${serviceId}/candidates?position_id=${pos.id}`);
  const available = list.filter((c) => !taken.has(c.id));
  let showAll = false;
  let picked;
  const why = (c) => html`${c.conflicts.map((x) => html`<span class="pill ${x.level === 'block' ? 'bad' : 'warn'}">${x.text}</span> `)}
    ${!c.plays_position ? html`<span class="pill">Not usually ${pos.name}</span> ` : ''}
    <div class="muted small">${c.last_served ? `Last served ${fmtDate(c.last_served)}` : 'Hasn’t served yet'}${c.recent_count ? ` · serving ${c.recent_count} other ${c.recent_count === 1 ? 'day' : 'days'} within 4 weeks` : ''}</div>`;
  // Only people assigned to this position, unless the scheduler asks for the whole team.
  const rows = () => (showAll ? available : available.filter((c) => c.plays_position));
  const others = available.filter((c) => !c.plays_position).length;
  const listHtml = () => (rows().length ? html`<div class="picker-list">${rows().map((c, i) => html`<button type="button" data-i="${i}">${avatar(c)}<span>${displayName(c)}</span><span class="why">${why(c)}</span></button>`)}</div>`
    : html`<p class="muted">No one is assigned to ${pos.name} yet. Tick people for it in the team’s roster.</p>`);
  await dialog({
    title: `Schedule ${pos.name}`, submit: null,
    body: html`<p class="muted small">People assigned to ${pos.name}, best choices first: not away or booked elsewhere, and haven’t served recently.</p>
      <div data-rows>${listHtml()}</div>
      <div class="row" style="margin-top:10px">${others ? html`<button type="button" class="btn small ghost" data-all>Show everyone on the team (${others} more)</button>` : ''}
        <button type="button" class="btn small ghost" data-anyone>Someone not on the team…</button></div>`,
    onOpen: (d, close) => {
      d.querySelector('[data-rows]').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { picked = rows()[b.dataset.i]; close(); } });
      d.querySelector('[data-all]')?.addEventListener('click', (e) => { showAll = true; e.target.remove(); mount(d.querySelector('[data-rows]'), listHtml()); });
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
      if (await scheduleOne(serviceId, pos.id, person)) toast(`${displayName(person)} added. Send requests when you’re ready to let them know.`);
    } catch (e) { fail(e); }
    reload();
  }
}

// Sends the drafts in these services (optionally one team's): shows who'll be asked for what,
// then tells each person once. Resolves to true when sent.
export async function sendRequests(serviceIds, teamId = null) {
  const q = new URLSearchParams({ service_ids: serviceIds.join(',') });
  if (teamId) q.set('team_id', teamId);
  const list = await get(`/assignments/unsent?${q}`);
  if (!list.length) { toast('Everyone here has already been asked.'); return false; }
  const people = [...Map.groupBy(list, (a) => a.person_id).values()];
  const unreachable = people.filter((spots) => !spots[0].reachable);
  let result;
  await dialog({
    title: `Send ${list.length} ${list.length === 1 ? 'request' : 'requests'}`, wide: true, submit: `Send to ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
    body: html`<p class="muted small" style="margin-top:0">Each person gets one email and app notification listing their spots, with buttons to accept or decline.</p>
      <div class="send-list">${people.map((spots) => html`<div class="send-row"><b>${displayName(spots[0])}</b>${spots[0].reachable ? '' : html` <span class="pill warn">No email or app</span>`}
        <span class="muted small">${spots.map((a) => `${fmtDate(a.starts_at)} ${a.position}`).join(' · ')}</span></div>`)}</div>
      ${unreachable.length ? html`<p class="small" style="margin-bottom:0">${icon('info', 'ic small-ic')} ${unreachable.length === 1 ? 'One person has' : `${unreachable.length} people have`} no email and no app account. Let them know yourself, or add an email to their profile.</p>` : ''}`,
    onSubmit: async () => {
      const body = { service_ids: serviceIds };
      if (teamId) body.team_id = teamId;
      result = await post('/assignments/send', body);
    },
  });
  if (result) toast(`Sent ${result.sent} ${result.sent === 1 ? 'request' : 'requests'} to ${result.people} ${result.people === 1 ? 'person' : 'people'}.`);
  return Boolean(result);
}
