// Weekly attendance per campus: adults (headcounts), kids (check-ins) and volunteers serving.
import { get, html, mount, fmtDate, avatar, displayName } from '../lib.js';
import { state, setTitle, campusName, visibleCampuses, campusQuery } from '../app.js';

export default async function attendance(el) {
  setTitle('Attendance');
  const [d, follow] = await Promise.all([get('/attendance/weekly?weeks=12'), get(`/attendance/people${campusQuery()}`)]);
  const camps = state.campusId ? visibleCampuses().filter((c) => c.id === state.campusId) : visibleCampuses();
  const weeks = [];
  const start = new Date(`${d.from}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + 7);
  for (let w = new Date(start); w <= new Date(); w.setUTCDate(w.getUTCDate() + 7)) weeks.push(w.toISOString().slice(0, 10));
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
    <div class="grid two" style="margin-bottom:14px">
      <div class="card"><h2>Haven’t been here in 3+ weeks</h2>
        <p class="muted small" style="margin-top:-4px">People who came at least 3 times in the last 12 weeks.</p>
        ${follow.missing.length ? follow.missing.slice(0, 25).map((p) => personRow(p, `Last here ${fmtDate(p.last_at.slice(0, 10))}`)) : html`<p class="muted">Everyone’s been around lately.</p>`}</div>
      <div class="card"><h2>First-time guests this month</h2>
        ${follow.first_time.length ? follow.first_time.map((p) => personRow(p, `First visit ${fmtDate(p.first_at.slice(0, 10))}`)) : html`<p class="muted">No first-time visits marked this month.</p>`}</div>
    </div>
    <div class="legend" style="margin-bottom:12px"><span><i></i>Headcount</span><span><i class="kids"></i>Kids checked in</span></div>
    ${camps.length ? camps.map((c) => html`<div class="card"><h2>${c.name}</h2>${chart(c.id)}
      <div class="table-wrap" style="margin-top:12px"><table class="list"><thead><tr><th>Week of</th><th>Headcount</th><th>Kids</th><th>Total</th><th>On the roll</th><th>Volunteers</th></tr></thead>
      <tbody>${weeks.slice().reverse().map((w) => {
        const a = sum(d.adults, c.id, w); const k = sum(d.kids, c.id, w);
        return html`<tr><td>${fmtDate(w)}</td><td class="num">${a || '—'}</td><td class="num">${k || '—'}</td><td class="num"><b>${a + k || '—'}</b></td><td class="num">${sum(d.marked, c.id, w) || '—'}</td><td class="num">${sum(d.volunteers, c.id, w) || '—'}</td></tr>`;
      })}</tbody></table></div></div>`) : html`<div class="card empty">Add a campus in Settings first.</div>`}
    <p class="muted small">Enter headcounts on each service’s Attendance tab. ${camps.length > 1 ? `Showing ${camps.map((c) => campusName(c.id)).join(' and ')}.` : ''}</p>`);
}
