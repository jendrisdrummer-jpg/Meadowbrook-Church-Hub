// Shared scheduling helpers for a service's Who's serving tab and the Schedule page.
import { get, post, html, mount, avatar, displayName, dialog, toast, fail, confirm, fmtDate, pickPerson } from './lib.js';

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
      if (await scheduleOne(serviceId, pos.id, person)) toast(`${displayName(person)} scheduled. They’ll see it in My Schedule.`);
    } catch (e) { fail(e); }
    reload();
  }
}
