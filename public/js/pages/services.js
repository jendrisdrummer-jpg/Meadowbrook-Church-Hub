// Services: a month calendar (or list) of every service across campuses, plus repeating services.
import { get, html, mount, icon, fmtDate, fmtTime, today, addDays } from '../lib.js';
import { can, setTitle, go, campusQuery } from '../app.js';
import { newServiceDialog, repeatLabel } from '../service-forms.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function services(el) {
  const prefs = JSON.parse(sessionStorage.getItem('mb.services') || '{}');
  let view = prefs.view || 'month';
  let month = prefs.month || today().slice(0, 7);
  let from = prefs.from || today();
  const staff = can('staff');
  const leader = can('leader');

  setTitle('Services', html`${leader ? html`<div class="seg" role="tablist">
      <button data-view="month" class="${view === 'month' ? 'on' : ''}">Month</button><button data-view="list" class="${view === 'list' ? 'on' : ''}">List</button></div>` : ''}
    ${staff ? html`<button class="btn primary" data-new>${icon('plus')} New service</button>` : ''}`);
  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-new]')?.addEventListener('click', () => create());
  top.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    top.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));

  async function create(date) {
    const id = await newServiceDialog(date);
    if (id) go(`/services/${id}`);
    else draw();
  }

  const remember = () => sessionStorage.setItem('mb.services', JSON.stringify({ view, month, from }));

  async function draw() {
    remember();
    if (view === 'month' && leader) await drawMonth();
    else await drawList();
  }

  // ---------------------------------------------------------------- month
  async function drawMonth() {
    const first = `${month}-01`;
    const gridStart = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const [list, series] = await Promise.all([
      get(`/services?from=${days[0]}&to=${days[41]}${campusQuery('&')}`),
      leader ? get('/series') : [],
    ]);
    const byDay = new Map();
    for (const s of list) byDay.set(s.starts_at.slice(0, 10), [...(byDay.get(s.starts_at.slice(0, 10)) || []), s]);
    const label = new Date(`${first}T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const shownSeries = series.filter((t) => !campusQuery() || campusQuery().endsWith(`=${t.campus_id}`));
    const weeks = days.slice(35).every((d) => !d.startsWith(month)) ? 5 : 6;

    mount(el, html`<div class="card">
      <div class="row" style="margin-bottom:12px"><button class="btn small" data-shift="-1" aria-label="Previous month">←</button>
        <button class="btn small" data-shift="0">Today</button><button class="btn small" data-shift="1" aria-label="Next month">→</button>
        <h2 style="margin:0 0 0 6px">${label}</h2></div>
      <div class="cal">${WEEKDAYS.map((w) => html`<div class="cal-dow">${w}</div>`)}
        ${days.slice(0, weeks * 7).map((d) => html`<div class="cal-day ${d.startsWith(month) ? '' : 'out'} ${d === today() ? 'today' : ''} ${staff ? 'can-add' : ''}" data-day="${d}">
          <div class="cal-num">${Number(d.slice(8))}</div>
          ${(byDay.get(d) || []).map((s) => {
            const open = Math.max(0, s.needed - s.filled);
            return html`<a class="cal-svc" href="#/services/${s.id}" style="--c:${s.campus_color}" title="${s.title || s.type_name || ''}">
              <span class="t">${fmtTime(s.starts_at)}</span> ${s.campus_short || s.campus_name}
              ${s.needed ? (open ? html`<span class="cal-flag warn">${open}</span>` : html`<span class="cal-flag good">${icon('check')}</span>`) : ''}</a>`;
          })}
        </div>`)}</div>
      ${staff ? html`<p class="muted small" style="margin:10px 0 0">Click an empty part of a day to add a service. Numbers show open volunteer spots.</p>` : ''}
    </div>
    ${leader ? html`<div class="card"><div class="card-head"><h2>Repeating services</h2>${staff ? html`<button class="btn small" data-new-series>${icon('plus')} Add repeating service</button>` : ''}</div>
      ${shownSeries.length ? html`<table class="list"><tbody>${shownSeries.map((t) => html`<tr class="${t.next_at ? 'click' : ''}" data-next="${t.next_at ? t.next_at : ''}">
        <td><span class="campus-tag"><span class="dot" style="background:${t.campus_color}"></span>${t.campus_short || t.campus_name}</span></td>
        <td><b>${t.default_title || t.name}</b><div class="muted small">${repeatLabel(t)}</div></td>
        <td class="small">${t.needs.length ? `${t.needs.reduce((a, n) => a + n.count, 0)} positions` : html`<span class="muted">No positions</span>`}</td>
        <td class="muted small nowrap">${t.next_at ? `Next: ${fmtDate(t.next_at)}` : ''}</td></tr>`)}</tbody></table>`
        : html`<div class="empty">No repeating services yet. Add your Sunday services once and they fill the calendar automatically.</div>`}
    </div>` : ''}`);
  }

  // ---------------------------------------------------------------- list
  async function drawList() {
    const to = addDays(from, 41);
    const list = await get(`/services?from=${from}&to=${to}${campusQuery('&')}`);
    const byDay = new Map();
    for (const s of list) byDay.set(s.starts_at.slice(0, 10), [...(byDay.get(s.starts_at.slice(0, 10)) || []), s]);
    mount(el, html`<div class="row" style="margin-bottom:14px">
        <button class="btn small" data-from="-42">← Earlier</button><button class="btn small" data-from="0">Today</button><button class="btn small" data-from="42">Later →</button>
        <span class="muted small">${fmtDate(from)} – ${fmtDate(to)}</span></div>
      ${list.length ? [...byDay].map(([day, rows]) => html`<div class="card">
        <h2>${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <table class="list"><tbody>${rows.map((s) => html`<tr class="click" data-id="${s.id}">
          <td class="nowrap" style="width:110px"><b>${fmtTime(s.starts_at)}</b></td>
          <td><span class="campus-tag"><span class="dot" style="background:${s.campus_color}"></span>${s.campus_short || s.campus_name}</span>
            ${s.series || s.title ? html`<div class="small">${[s.series, s.title].filter(Boolean).join(' · ')}</div>` : ''}</td>
          <td style="text-align:right" class="nowrap">${leader ? fill(s) : ''}</td></tr>`)}</tbody></table></div>`)
      : html`<div class="card empty">No services in these weeks.${staff ? ' Use New service to add one, or a repeating Sunday service.' : ''}</div>`}`);
  }

  function fill(s) {
    if (!s.needed) return html`<span class="muted small">${s.filled} scheduled</span>`;
    const open = Math.max(0, s.needed - s.filled);
    return html`${open ? html`<span class="pill warn">${open} open</span>` : html`<span class="pill good">${icon('check')} Full</span>`}
      ${s.declined ? html`<span class="pill bad">${s.declined} declined</span>` : ''} <span class="muted small">${s.accepted}/${s.needed} confirmed</span>`;
  }

  el.onclick = (e) => {
    const shift = e.target.closest('[data-shift]');
    if (shift) {
      const n = Number(shift.dataset.shift);
      if (!n) month = today().slice(0, 7);
      else {
        const d = new Date(`${month}-15T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + n);
        month = d.toISOString().slice(0, 7);
      }
      return draw();
    }
    const fromBtn = e.target.closest('[data-from]');
    if (fromBtn) {
      from = fromBtn.dataset.from === '0' ? today() : addDays(from, Number(fromBtn.dataset.from));
      return draw();
    }
    if (e.target.closest('[data-new-series]')) return create();
    const next = e.target.closest('tr[data-next]');
    if (next?.dataset.next) {
      const day = next.dataset.next.slice(0, 10);
      const svc = el.querySelector(`.cal-day[data-day="${day}"] .cal-svc`);
      if (svc) { location.hash = svc.getAttribute('href'); return; }
      month = day.slice(0, 7);
      return draw();
    }
    const row = e.target.closest('tr[data-id]');
    if (row) return go(`/services/${row.dataset.id}`);
    const cell = e.target.closest('.cal-day.can-add');
    if (cell && !e.target.closest('.cal-svc')) create(cell.dataset.day);
  };

  await draw();
}
