// Shared scheduling helpers for a service's Who's serving tab and the Schedule page.
import { get, post, html, mount, icon, avatar, displayName, dialog, toast, fail, confirm, fmtDate, pickPerson } from './lib.js';

// Schedules one person, asking first if they're away or already serving then. Returns false if cancelled.
export async function scheduleOne(serviceId, positionId, person) {
  const body = { position_id: positionId, person_id: person.id };
  // Each 409 is one thing to confirm (a different campus, then away or double-booked); the server
  // asks again with the next one until everything has been agreed to.
  for (;;) {
    try {
      await post(`/services/${serviceId}/assignments`, body);
      return true;
    } catch (e) {
      if (e.status !== 409) throw e;
      const campus = Boolean(e.data?.other_campus);
      if (campus) {
        const pick = await askOtherCampus(person, e.data);
        if (!pick) return false;
        // Staff who can manage this person fix their list first; after that the server no longer asks.
        if (pick === 'add') await post(`/people/${person.id}/serving-campuses/add`, { campus_id: e.data.campus_id });
        else body.allow_other_campus = true;
        continue;
      }
      if (!(await confirm('Schedule anyway?', `${displayName(person)}: ${e.message}`, 'Schedule anyway'))) return false;
      body.force = true;
    }
  }
}

// "{Campus} isn't one of {name}'s serving campuses." Resolves to 'add' (staff who can manage them
// only), 'anyway', or null when they back out.
function askOtherCampus(person, info) {
  const campus = info.campus_name || 'This campus';
  let answer = null;
  return dialog({
    title: 'Not usually at this campus', submit: null, cancel: 'Cancel',
    body: html`<p>${campus} isn’t one of ${displayName(person)}’s serving campuses.</p>
      <div class="stack">${info.can_add_campus ? html`<button type="button" class="btn primary" data-add>Add ${campus} for them</button>` : ''}
        <button type="button" class="btn ${info.can_add_campus ? '' : 'primary'}" data-anyway>Schedule anyway</button></div>`,
    onOpen: (d, close) => {
      d.querySelector('[data-add]')?.addEventListener('click', () => { answer = 'add'; close(); });
      d.querySelector('[data-anyway]').addEventListener('click', () => { answer = 'anyway'; close(); });
    },
  }).then(() => answer);
}

// Picks someone for one position at one service: people who play that position first, best
// choices first. `taken` = person ids already on it.
export async function assignDialog(serviceId, pos, taken, reload) {
  const list = await get(`/services/${serviceId}/candidates?position_id=${pos.id}`);
  const available = list.filter((c) => !taken.has(c.id));
  let showAll = false;
  let picked;
  const why = (c) => html`${c.conflicts.map((x) => html`<span class="pill ${x.level === 'block' ? 'bad' : 'warn'}">${x.text}</span> `)}
    ${c.eligibility_reason ? html`<span class="pill ${c.eligible ? '' : 'warn'}">${c.eligibility_reason}</span> ` : ''}
    ${!c.plays_position ? html`<span class="pill">Not usually ${pos.name}</span> ` : ''}
    <div class="muted small">${c.last_served ? `Last served ${fmtDate(c.last_served)}` : 'Hasn’t served yet'}${c.recent_count ? ` · serving ${c.recent_count} other ${c.recent_count === 1 ? 'day' : 'days'} within 4 weeks` : ''}</div>`;
  // Only people assigned to this position, unless the scheduler asks for the whole team.
  const rows = () => (showAll ? available : available.filter((c) => c.plays_position));
  const others = available.filter((c) => !c.plays_position).length;
  const listHtml = () => (rows().length ? html`<div class="picker-list">${rows().map((c, i) => html`<button type="button" data-i="${i}" class="${c.eligible ? '' : 'dim'}">${avatar(c)}<span>${displayName(c)}</span><span class="why">${why(c)}</span></button>`)}</div>`
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
// Why a scheduling request can't reach someone (the server sends only the reason, never an address).
const REACH = {
  no_contact: ['No email or account', 'They have no email and no account, so requests can’t reach them. Add an email on their page, or let them know yourself.'],
  notices_off: ['Notices turned off', 'They turned off emails and schedule notices (My schedule → Choose which notices you get), so requests can’t reach them. Ask them to turn one back on, or let them know yourself.'],
};
export const reachShort = (code) => (REACH[code] || REACH.no_contact)[0];

// A "Can't be reached" pill; tapping it says why (works inside a row that's a link, too).
export const reachPill = (m) => (m.reachable === false
  ? html` <button type="button" class="pill warn pill-btn" data-reach="${m.unreachable_reason || 'no_contact'}" title="${reachShort(m.unreachable_reason)}">Can’t be reached</button>` : '');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reach]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toast((REACH[b.dataset.reach] || REACH.no_contact)[1]);
}, true);

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
      <div class="send-list">${people.map((spots) => html`<div class="send-row"><b>${displayName(spots[0])}</b>${spots[0].reachable ? '' : html` <span class="pill warn">${reachShort(spots[0].unreachable_reason)}</span>`}
        <span class="muted small">${spots.map((a) => `${fmtDate(a.starts_at)} ${a.position}`).join(' · ')}</span></div>`)}</div>
      ${unreachable.length ? html`<p class="small" style="margin-bottom:0">${icon('info', 'ic small-ic')} ${unreachable.length === 1 ? 'One person' : `${unreachable.length} people`} won’t get this: ${unreachable.map((spots) => `${displayName(spots[0])} (${reachShort(spots[0].unreachable_reason).toLowerCase()})`).join(', ')}. Let them know yourself, or fix it on their page.</p>` : ''}`,
    onSubmit: async () => {
      const body = { service_ids: serviceIds };
      if (teamId) body.team_id = teamId;
      result = await post('/assignments/send', body);
    },
  });
  if (result) {
    const sent = `Sent ${result.sent} ${result.sent === 1 ? 'request' : 'requests'} to ${result.people} ${result.people === 1 ? 'person' : 'people'}.`;
    // Sending isn't blocked, but say who won't hear about it.
    toast(unreachable.length ? `${sent} ${unreachable.length === 1 ? '1 person can’t' : `${unreachable.length} people can’t`} be reached: ${unreachable.map((spots) => `${displayName(spots[0])} (${reachShort(spots[0].unreachable_reason).toLowerCase()})`).join(', ')}.` : sent, unreachable.length ? 'bad' : '');
  }
  return Boolean(result);
}

// Team id -> the id of that team's chat, for the chats this person can see (so "Message team"
// only shows when it will open). Empty if chat can't be loaded.
export async function teamChats() {
  try {
    return new Map((await get('/chats')).chats.filter((c) => c.kind === 'team' && c.team_id).map((c) => [c.team_id, c.id]));
  } catch { return new Map(); }
}

// Asks, then re-sends the request to people on this service who were asked but haven't replied.
export async function remindUnanswered(serviceId, count, teamId = null) {
  if (!(await confirm('Remind people?', `Send a friendly reminder to ${count} ${count === 1 ? 'person' : 'people'} who haven’t replied yet? Anyone reminded in the last 12 hours is skipped.`, 'Send reminder', { danger: false }))) return false;
  const r = await post(`/services/${serviceId}/remind`, teamId ? { team_id: teamId } : {});
  toast(r.reminded ? `Reminded ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}${r.skipped ? ` (${r.skipped} reminded recently, skipped)` : ''}.` : 'Everyone was already reminded in the last 12 hours.');
  return true;
}
