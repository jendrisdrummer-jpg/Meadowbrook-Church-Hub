// Take attendance: the services an attendance account can record, then the roll call and headcount
// for one (which screen opens first is the campus's attendance mode). Leaders and above can use it
// too. It reuses the roll call from the service page, with no links to people.
import { get, html, mount, fmtDate, fmtTime, fail } from '../lib.js';
import { setTitle, go } from '../app.js';
import { drawRollCall } from '../rollcall.js';

const modeLabel = { names: 'Names', headcount: 'Headcount', both: 'Names and headcount' };
const dayKey = (s) => s.starts_at.slice(0, 10);

export default async function takeAttendance(el, id) {
  if (id) return oneService(el, Number(id));
  setTitle('Take attendance');
  const picked = new URLSearchParams(location.hash.split('?')[1] || '').get('date') || '';
  const d = await get(`/attendance/services${picked ? `?from=${picked}&to=${picked}` : ''}`);
  const days = [...new Set(d.services.map(dayKey))].sort().reverse();
  const today = new Date().toLocaleDateString('en-CA');
  mount(el, html`<div class="stack" style="max-width:640px">
    <form class="card row" data-date style="gap:10px;align-items:end;flex-wrap:wrap">
      <label class="field" style="margin:0;flex:1;min-width:160px">Another date<input type="date" name="date" value="${picked}"></label>
      <button class="btn">Show services</button>${picked ? html`<button type="button" class="btn ghost" data-recent>Back to recent</button>` : ''}
    </form>
    ${d.services.length ? days.map((day) => html`<div><h2 style="margin:8px 0">${day === today ? 'Today' : fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      ${d.services.filter((s) => dayKey(s) === day).map((s) => html`<a class="card row" href="#/take-attendance/${s.id}" style="color:inherit;gap:12px;margin-bottom:8px">
        <span style="flex:1"><b>${s.title || 'Service'}</b><span class="muted small" style="display:block">${fmtTime(s.starts_at)} · ${s.campus_short || s.campus_name}</span></span>
        <span class="muted small" style="text-align:right">${s.roll_count ? `${s.roll_count} on the roll` : ''}${s.roll_count && s.headcount_total ? html`<br>` : ''}${s.headcount_total ? `${s.headcount_total} counted` : ''}${!s.roll_count && !s.headcount_total ? 'Nothing yet' : ''}</span></a>`)}</div>`)
      : html`<div class="card empty">${picked ? 'No services on that date.' : 'No recent services at your campuses. Pick another date above.'}</div>`}
    <p class="muted small">Showing the last two weeks and tomorrow. Pick a date to record or correct an older service.</p>
  </div>`);
  el.querySelector('[data-date]').onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.date.value;
    location.hash = v ? `#/take-attendance?date=${v}` : '#/take-attendance';
  };
  el.querySelector('[data-recent]')?.addEventListener('click', () => { location.hash = '#/take-attendance'; });
}

async function oneService(el, id) {
  setTitle('Take attendance');
  // The service comes from the same list (it knows the campus's mode and the headcounts); an older one is found by its own date.
  let d = await get('/attendance/services');
  let s = d.services.find((x) => x.id === id);
  if (!s) {
    const day = new URLSearchParams(location.hash.split('?')[1] || '').get('date');
    if (day) { d = await get(`/attendance/services?from=${day}&to=${day}`); s = d.services.find((x) => x.id === id); }
  }
  if (!s) {
    // Not in the recent list: it may be an older service reached by a link. Ask for it by its roll to confirm access.
    await get(`/services/${id}/roll`).catch(fail);
    const meta = await get(`/services/${id}`);
    s = { id, title: meta.title, starts_at: meta.starts_at, campus_id: meta.campus_id, attendance_mode: meta.campus?.attendance_mode || 'both', headcounts: meta.headcounts };
  }
  setTitle(s.title || 'Take attendance');
  mount(el, html`<div class="stack" style="max-width:640px">
    <a href="#/take-attendance" class="muted small">← All services</a>
    <div><h2 style="margin:0">${s.title || 'Service'}</h2><div class="muted small">${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtTime(s.starts_at)}${s.campus_short ? ` · ${s.campus_short}` : ''} · ${modeLabel[s.attendance_mode] || modeLabel.both}</div></div>
    <div data-roll></div></div>`);
  await drawRollCall(el.querySelector('[data-roll]'), s, { mode: s.attendance_mode });
}
