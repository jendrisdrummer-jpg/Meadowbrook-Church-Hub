// Small hand-drawn charts and helpers for attendance numbers (no chart library): the weekly bars with last
// year's same weeks as a faint line, a tiny sparkline for Home, % change, and the CSV download.
import { html } from './lib.js';

export const pctChange = (now, before) => (now != null && before ? Math.round(((now - before) / before) * 100) : null);

// "↑ 8% vs last year" (empty when there is nothing to compare with).
export const changeText = (pct) => (pct == null ? '' : pct === 0 ? 'same as last year' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs last year`);

// weeks: [{ week, total, prev_week, prev_total }]. Each column is a button so a tap, hover or keyboard focus
// can read out the date and both numbers (the page listens for data-i).
export function trendChart(weeks, label) {
  const n = weeks.length;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.total || 0, w.prev_total || 0))) * 1.08;
  const y = (v) => 100 - (v / max) * 100;
  // The last-year line breaks where a week has no number.
  const segs = [];
  weeks.forEach((w, i) => {
    if (w.prev_total == null) { segs.push(null); return; }
    if (segs.length && segs[segs.length - 1]) segs[segs.length - 1].push([(i + 0.5) / n * 100, y(w.prev_total)]);
    else segs.push([[(i + 0.5) / n * 100, y(w.prev_total)]]);
  });
  const lines = segs.filter((s) => s && s.length > 1).map((s) => s.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' '));
  const every = Math.ceil(n / 10);
  return html`<div class="att-chart" role="group" aria-label="${label}">
    <div class="att-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines.map((pts) => html`<polyline points="${pts}"></polyline>`)}</svg>
      ${weeks.map((w, i) => html`<button type="button" class="att-col" data-i="${i}" aria-label="Week of ${w.week}: ${w.total ?? 'no number'}${w.prev_total != null ? `, last year ${w.prev_total}` : ''}">
        ${w.total != null ? html`<i class="att-bar" style="height:${(w.total / max) * 100}%"></i>` : ''}
        ${w.prev_total != null ? html`<b class="att-dot" style="bottom:${100 - y(w.prev_total)}%"></b>` : ''}</button>`)}
    </div>
    <div class="att-labels" aria-hidden="true">${weeks.map((w, i) => html`<span>${i % every === 0 ? `${Number(w.week.slice(5, 7))}/${Number(w.week.slice(8))}` : ''}</span>`)}</div>
  </div>`;
}

// A bar-less sparkline of the week totals (gaps are skipped).
export function sparkline(values, label) {
  const pts = values.map((v, i) => (v == null ? null : [i, v])).filter(Boolean);
  if (pts.length < 2) return '';
  const max = Math.max(...pts.map((p) => p[1]));
  const min = Math.min(...pts.map((p) => p[1]));
  const span = Math.max(1, max - min);
  const x = (i) => (i / Math.max(1, values.length - 1)) * 100;
  const y = (v) => 90 - ((v - min) / span) * 80;
  const last = pts[pts.length - 1];
  return html`<svg class="att-spark" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${label}">
    <polyline points="${pts.map((p) => `${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')}"></polyline></svg>
    <span class="att-spark-dot" style="left:${x(last[0])}%;bottom:${100 - y(last[1])}%" aria-hidden="true"></span>`;
}

// CSV text for the per-service rows. Cells that could be read as a formula by a spreadsheet get a leading
// apostrophe, so a service title can never run anything.
export function serviceCsv(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Date', 'Campus', 'Time', 'Service', 'Attendance', 'Counted from', 'Headcount', 'Marked present', 'Kids checked in'];
  const from = { headcount: 'Headcount', roll: 'Roll call', kids: 'Kids check-in' };
  const lines = rows.map((r) => [r.date, r.campus, r.time, r.title, r.attendance, from[r.source] || '', r.headcount ?? '', r.marked, r.kids]);
  return [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n');
}
