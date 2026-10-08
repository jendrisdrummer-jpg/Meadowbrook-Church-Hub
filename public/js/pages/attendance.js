// Weekly attendance per campus: adults (headcounts), kids (check-ins) and volunteers serving.
import { get, html, mount, fmtDate } from '../lib.js';
import { state, setTitle, campusName, visibleCampuses } from '../app.js';

export default async function attendance(el) {
  setTitle('Attendance');
  const d = await get('/attendance/weekly?weeks=12');
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

  mount(el, html`
    <div class="legend" style="margin-bottom:12px"><span><i></i>Headcount</span><span><i class="kids"></i>Kids checked in</span></div>
    ${camps.length ? camps.map((c) => html`<div class="card"><h2>${c.name}</h2>${chart(c.id)}
      <div class="table-wrap" style="margin-top:12px"><table class="list"><thead><tr><th>Week of</th><th>Headcount</th><th>Kids</th><th>Total</th><th>Volunteers</th></tr></thead>
      <tbody>${weeks.slice().reverse().map((w) => {
        const a = sum(d.adults, c.id, w); const k = sum(d.kids, c.id, w);
        return html`<tr><td>${fmtDate(w)}</td><td class="num">${a || '—'}</td><td class="num">${k || '—'}</td><td class="num"><b>${a + k || '—'}</b></td><td class="num">${sum(d.volunteers, c.id, w) || '—'}</td></tr>`;
      })}</tbody></table></div></div>`) : html`<div class="card empty">Add a campus in Settings first.</div>`}
    <p class="muted small">Enter headcounts on each service’s Attendance tab. ${camps.length > 1 ? `Showing ${camps.map((c) => campusName(c.id)).join(' and ')}.` : ''}</p>`);
}
