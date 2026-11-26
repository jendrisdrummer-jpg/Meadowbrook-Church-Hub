// Attendance: a dashboard to look back on (one number per service, by week and year), the follow-up lists,
// and the older per-campus breakdown (counted adults and students, kids, volunteers serving) folded below.
import { get, html, mount, fmtDate, avatar, displayName, options, fail } from '../lib.js';
import { state, can, setTitle, campusName, visibleCampuses, campusQuery } from '../app.js';
import { trendChart, serviceCsv, pctChange, changeText } from '../attendance-chart.js';

// Kept while the page is open so a leader's choices survive a campus switch.
const pick = { range: 'w12', time: '' };

export default async function attendance(el) {
  setTitle('Attendance');
  const [d, follow] = await Promise.all([get('/attendance/weekly?weeks=12'), get(`/attendance/people${campusQuery()}`)]);
  const camps = state.campusId ? visibleCampuses().filter((c) => c.id === state.campusId) : visibleCampuses();
  const weeks = [];
  const start = new Date(`${d.from}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + 7);
  for (let w = new Date(start); w <= new Date(); w.setUTCDate(w.getUTCDate() + 7)) weeks.push(w.toISOString().slice(0, 10));
  const sourceOf = (campusId, week) => d.source.find((r) => r.week === week && r.campus_id === campusId)?.source;
  const sourceLabel = { headcount: 'Headcount', names: 'Names', mixed: 'Mixed' };
  const sum = (list, campusId, week) => list.filter((r) => r.week === week && (!campusId || r.campus_id === campusId)).reduce((a, r) => a + r.total, 0);

  const chart = (campusId) => {
    const max = Math.max(1, ...weeks.map((w) => sum(d.adults, campusId, w) + sum(d.kids, campusId, w)));
    return html`<div class="chart" role="img" aria-label="Weekly attendance">${weeks.map((w) => {
      const a = sum(d.adults, campusId, w);
      const k = sum(d.kids, campusId, w);
      return html`<div class="bar" title="${fmtDate(w)}: ${a} adults & students, ${k} kids">
        <i class="kids" style="height:${(k / max) * 130}px"></i><i style="height:${(a / max) * 130}px;border-radius:0"></i><span>${fmtDate(w, { month: 'numeric', day: 'numeric' })}</span></div>`;
    })}</div>`;
  };

  const personRow = (p, note) => html`<a class="row" href="#/people/${p.id}" style="padding:6px 0;color:inherit;flex-wrap:nowrap">${avatar(p)}<span style="flex:1">${displayName(p)}</span><span class="muted small nowrap">${note}</span></a>`;
  mount(el, html`
    <div data-dash></div>
    <div class="grid two" style="margin-bottom:14px">
      <div class="card" data-missing-card><div class="card-head"><h2>We’ve missed…</h2>
          <div class="seg" data-missing-weeks role="group" aria-label="Missed at least">${[2, 3, 4].map((n) => html`<button type="button" data-w="${n}" class="${n === 2 ? 'on' : ''}">${n}+ weeks</button>`)}</div></div>
        <p class="muted small" style="margin-top:-4px">Regulars (here at least 3 times in the last 12 weeks) who missed recent Sundays when attendance was taken.A good list for a call or a note.</p>
        <div data-missing-list><p class="muted">Loading…</p></div></div>
      <div class="card"><h2>First-time guests this month</h2>
        ${follow.first_time.length ? follow.first_time.map((p) => personRow(p, `First visit ${fmtDate(p.first_at.slice(0, 10))}`)) : html`<p class="muted">No first-time visits marked this month.</p>`}</div>
    </div>
    <p class="row" style="margin:0 0 12px"><span class="muted small">Record attendance from a service.</span> <a class="btn small" href="#/take-attendance">Take attendance</a></p>
    <details class="card att-more"><summary><b>By campus</b> <span class="muted small">Adults and students, kids and volunteers for the last 12 weeks</span></summary>
    <div class="legend" style="margin:12px 0"><span><i></i>Counted</span><span><i class="kids"></i>Kids checked in</span></div>
    ${camps.length ? camps.map((c) => html`<div class="card"><h2>${c.name}</h2>${chart(c.id)}
      <div class="table-wrap" style="margin-top:12px"><table class="list"><thead><tr><th>Week of</th><th>Counted</th><th>Source</th><th>Kids</th><th>Total</th><th>On the roll</th><th>Volunteers</th></tr></thead>
      <tbody>${weeks.slice().reverse().filter((w) => sum(d.adults, c.id, w) || sum(d.kids, c.id, w) || sum(d.marked, c.id, w) || sum(d.volunteers, c.id, w)).map((w) => {
        const a = sum(d.adults, c.id, w); const k = sum(d.kids, c.id, w);
        return html`<tr><td>${fmtDate(w)}</td><td class="num">${a || '—'}</td><td class="small muted nowrap">${sourceLabel[sourceOf(c.id, w)] || '—'}</td><td class="num">${k || '—'}</td><td class="num"><b>${a + k || '—'}</b></td><td class="num">${sum(d.marked, c.id, w) || '—'}</td><td class="num">${sum(d.volunteers, c.id, w) || '—'}</td></tr>`;
      })}</tbody></table></div></div>`) : html`<div class="card empty">Add a campus in Settings first.</div>`}
    <p class="muted small">Counted is the headcount when one was entered, otherwise the names on the roll (kids checked in aren’t counted twice). Enter them with Take attendance, or on each service’s Attendance tab. ${camps.length > 1 ? `Showing ${camps.map((c) => campusName(c.id)).join(' and ')}.` : ''}</p></details>`);
  drawDashboard(el.querySelector('[data-dash]'));
  // "We've missed…": 2, 3 or 4+ Sundays in a row, only counting Sundays attendance was taken.
  const missList = el.querySelector('[data-missing-list]');
  const loadMissing = async (weeks) => {
    el.querySelectorAll('[data-missing-weeks] button').forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === weeks));
    const m = await get(`/attendance/missing?weeks=${weeks}${state.campusId ? `&campus_id=${state.campusId}` : ''}`);
    mount(missList, m.people.length
      ? m.people.slice(0, 50).map((p) => html`<a class="row" href="#/people/${p.id}" style="padding:6px 0;color:inherit;flex-wrap:nowrap">${avatar(p)}<span style="flex:1;min-width:0">${displayName(p)}<br><small class="muted">Missed ${p.missed} Sunday${p.missed === 1 ? '' : 's'} · last here ${fmtDate(p.last_at)}</small></span></a>`)
      : html`<p class="muted">Everyone’s been around lately.</p>`);
  };
  el.querySelector('[data-missing-weeks]').addEventListener('click', (e) => { const b = e.target.closest('button[data-w]'); if (b) loadMissing(Number(b.dataset.w)).catch(fail); });
  loadMissing(2).catch(fail);
}

const SOURCE_NOTE = { roll: 'from roll call', kids: 'kids check-in only' };

// The dashboard: range picker, weekly chart against last year, key numbers, per-service table, CSV.
async function drawDashboard(box) {
  const thisYear = new Date().getFullYear();
  const query = () => {
    const range = pick.range.startsWith('y') ? `year=${pick.range.slice(1)}` : 'weeks=12';
    return `/attendance/summary?${range}${campusQuery('&')}${pick.time ? `&service_time=${pick.time}` : ''}`;
  };
  let d;
  try { d = await get(query()); } catch (e) { mount(box, html`<div class="card empty">${e.message}</div>`); return; }
  // A time that this campus or year doesn't have is dropped rather than showing nothing.
  if (pick.time && !d.service_times.includes(pick.time)) { pick.time = ''; d = await get(query()); }

  const years = [...new Set([thisYear, thisYear - 1, ...d.years])].sort((a, b) => b - a);
  const rangeOptions = [{ value: 'w12', label: 'Last 12 weeks' }, { value: `y${thisYear}`, label: 'This year' }, { value: `y${thisYear - 1}`, label: 'Last year' },
    ...years.filter((y) => y < thisYear - 1).map((y) => ({ value: `y${y}`, label: String(y) }))];
  const rangeName = rangeOptions.find((o) => o.value === pick.range)?.label || 'this range';
  const fmtTime12 = (t) => new Date(`2000-01-01T${t}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const st = d.stats;
  const empty = !st.weeks_with_numbers;
  const pct = pctChange(st.average, st.previous_average);
  const num = (v) => (v == null ? '—' : Math.round(v));
  const monthName = st.month ? new Date(`${st.month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long' }) : '';

  const controls = html`<div class="att-controls">
      <label class="att-pick">Show<select data-range aria-label="Time range">${options(rangeOptions, pick.range)}</select></label>
      ${d.service_times.length > 1 ? html`<label class="att-pick">Service<select data-time aria-label="Service time">${options([{ value: '', label: 'All times' }, ...d.service_times.map((t) => ({ value: t, label: fmtTime12(t) }))], pick.time)}</select></label>` : ''}
      <span class="spacer"></span>
      ${empty ? '' : html`<a class="btn small" data-csv download="attendance-${pick.range === 'w12' ? 'last-12-weeks' : pick.range.slice(1)}.csv">Download CSV</a>`}
    </div>`;

  if (empty) {
    mount(box, html`<div class="card att-dash"><div class="card-head"><h2>Attendance</h2></div>${controls}
      <div class="empty">No attendance numbers for ${rangeName.toLowerCase()} yet. They show up here after you use <a href="#/take-attendance">Take attendance</a> (marking people or entering a headcount) on a service.
        ${d.years.length ? html`<br>${d.years.length === 1 ? `There are numbers for ${d.years[0]}` : `There are numbers for ${d.years.slice(0, 3).join(', ')}${d.years.length > 3 ? ' and more' : ''}`}. Try picking ${d.years.length === 1 ? 'that year' : 'one of those years'}.` : ''}</div></div>`);
    bindDash(box, d);
    return;
  }

  const hi = st.highest;
  mount(box, html`<div class="card att-dash"><div class="card-head"><h2>Attendance</h2><a class="btn small" href="#/take-attendance">Take attendance</a></div>
    ${controls}
    <div class="stats att-stats">
      <div class="stat"><b>${num(st.average)}</b><span>Average per Sunday</span>${pct != null ? html`<em class="${pct > 0 ? 'up' : ''}">${changeText(pct)}</em>` : ''}</div>
      <div class="stat"><b>${num(st.month_average)}</b><span>${monthName} average</span></div>
      <div class="stat"><b>${hi ? hi.total : '—'}</b><span>Highest Sunday${hi ? html` · ${fmtDate(hi.week)}` : ''}</span></div>
    </div>
    <div class="legend att-legend"><span><i></i>This year</span>${st.previous_average != null ? html`<span><i class="prev"></i>Same weeks last year</span>` : ''}</div>
    ${trendChart(d.weeks, `Weekly attendance, ${rangeName.toLowerCase()}, with the same weeks last year`)}
    <p class="att-read muted small" data-read aria-live="polite">Tap or hover a week to see its numbers.</p>
    <details class="att-alt"><summary class="small muted">Show the weekly numbers as a table</summary>
      <div class="table-wrap"><table class="list"><thead><tr><th>Week of</th><th class="num">Attendance</th><th class="num">Same week last year</th></tr></thead>
      <tbody>${d.weeks.slice().reverse().map((w) => html`<tr><td>${fmtDate(w.week)}</td><td class="num">${w.total ?? '—'}</td><td class="num">${w.prev_total ?? '—'}</td></tr>`)}</tbody></table></div></details>
    <h3 class="att-sub">Each service</h3>
    <div class="table-wrap"><table class="list att-services"><thead><tr><th>Date</th><th>Campus</th><th class="att-time">Time</th><th class="num">Attendance</th></tr></thead>
      <tbody>${d.services.map((s) => html`<tr><td class="nowrap"><a href="#/services/${s.id}">${fmtDate(s.date)}</a></td><td>${s.campus_short || s.campus}<span class="att-time-inline muted small"><br>${fmtTime12(s.time)}</span></td><td class="att-time">${fmtTime12(s.time)}${s.title ? html`<br><span class="muted small">${s.title}</span>` : ''}</td>
        <td class="num"><b>${s.attendance}</b>${SOURCE_NOTE[s.source] ? html`<br><span class="muted small">${SOURCE_NOTE[s.source]}</span>` : ''}</td></tr>`)}</tbody></table></div>
    <p class="muted small">One number per service: the headcount if one was entered, otherwise the people marked present in roll call, plus kids checked in.</p>
  </div>`);
  bindDash(box, d);
}

function bindDash(box, d) {
  box.querySelector('[data-range]').onchange = (e) => { pick.range = e.target.value; drawDashboard(box); };
  const t = box.querySelector('[data-time]');
  if (t) t.onchange = (e) => { pick.time = e.target.value; drawDashboard(box); };
  const csv = box.querySelector('[data-csv]');
  if (csv) csv.href = URL.createObjectURL(new Blob([`﻿${serviceCsv(d.services)}`], { type: 'text/csv;charset=utf-8' }));
  const read = box.querySelector('[data-read]');
  if (!read) return;
  const show = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const w = d.weeks[Number(b.dataset.i)];
    read.textContent = `Week of ${fmtDate(w.week)}: ${w.total ?? 'no number'}${w.prev_total != null ? ` · ${fmtDate(w.prev_week, { month: 'short', day: 'numeric', year: 'numeric' })}: ${w.prev_total}` : ''}`;
    box.querySelectorAll('.att-col.on').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  };
  const plot = box.querySelector('.att-plot');
  ['mouseover', 'focusin', 'click'].forEach((ev) => plot.addEventListener(ev, show));
}
