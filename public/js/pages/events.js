// Events: what's coming up, for the app's calendar. Each event can take sign-ups.
import { get, html, mount, icon, fmtDate, fmtTime } from '../lib.js';
import { state, setTitle, go } from '../app.js';

const money = (c) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function eventWhen(e) {
  const day = fmtDate(e.starts_at.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return e.all_day ? day : `${day} · ${fmtTime(e.starts_at)}`;
}

export default async function events(el) {
  const past = new URLSearchParams(location.hash.split('?')[1] || '').get('view') === 'past';
  setTitle('Events', html`<a class="btn primary" href="#/events/new">${icon('plus')} New event</a>`);
  const list = (await get(`/admin/events${past ? '?scope=past' : ''}`)).filter((e) => !state.campusId || !e.campus_id || e.campus_id === state.campusId);
  mount(el, html`<p class="muted" style="margin-top:-6px">Published events show on the church app’s calendar (turn on the Events tab or add an Upcoming events widget in the App Builder). Turn on sign-ups to collect RSVPs, answers and payments.</p>
    <div class="tabs"><button class="${past ? '' : 'on'}" data-view="">Upcoming</button><button class="${past ? 'on' : ''}" data-view="past">Past</button></div>
    ${list.length ? html`<div class="card"><table class="list"><thead><tr><th>Event</th><th>When</th><th>Sign-ups</th><th></th></tr></thead><tbody>
      ${list.map((e) => html`<tr data-id="${e.id}" class="clickable">
        <td><div class="row" style="gap:10px;flex-wrap:nowrap">${e.image ? html`<img src="${e.image}" alt="" class="ev-mini">` : html`<span class="ev-mini ev-mini-blank">${icon('calendar')}</span>`}
          <span><b>${e.title}</b><br><span class="muted small">${[e.location, e.campus_short || e.campus_name || 'All campuses'].filter(Boolean).join(' · ')}</span></span></div></td>
        <td class="nowrap">${eventWhen(e)}</td>
        <td>${e.signup ? html`<b>${e.people}</b> ${e.people === 1 ? 'person' : 'people'}${e.capacity ? html` <span class="muted">of ${e.capacity}</span>` : ''}${e.paid ? html`<div class="muted small">${money(e.paid)} paid</div>` : ''}` : html`<span class="muted">—</span>`}</td>
        <td style="text-align:right">${e.published ? (e.visibility === 'members' ? html`<span class="pill info">Members only</span>` : html`<span class="pill good">Published</span>`) : html`<span class="pill">Draft</span>`}</td></tr>`)}
      </tbody></table></div>`
    : html`<div class="card empty">${past ? 'No past events.' : html`No upcoming events. <a href="#/events/new">Add one</a>.`}</div>`}`);
  el.onclick = (e) => {
    const t = e.target.closest('[data-view]');
    if (t) return go(`/events${t.dataset.view ? `?view=${t.dataset.view}` : ''}`);
    const row = e.target.closest('tr[data-id]');
    if (row) go(`/events/${row.dataset.id}`);
  };
}
