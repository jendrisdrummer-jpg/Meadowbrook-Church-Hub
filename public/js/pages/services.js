// Upcoming services across campuses, with how full each schedule is.
import { get, post, html, mount, icon, dialog, formData, options, toast, fmtDate, fmtTime, today, addDays } from '../lib.js';
import { state, can, setTitle, go, visibleCampuses, campusQuery } from '../app.js';

export default async function services(el) {
  setTitle('Services', can('staff') ? html`<button class="btn" data-generate>${icon('calendar')} Add upcoming weeks</button><button class="btn primary" data-add>${icon('plus')} One-off service</button>` : '');
  let from = sessionStorage.getItem('mb.services.from') || today();
  const draw = async () => {
    const to = addDays(from, 41);
    const list = await get(`/services?from=${from}&to=${to}${campusQuery('&')}`);
    const byDay = Map.groupBy ? Map.groupBy(list, (s) => s.starts_at.slice(0, 10)) : groupBy(list);
    mount(el, html`<div class="row" style="margin-bottom:14px">
        <button class="btn small" data-shift="-42">← Earlier</button><button class="btn small" data-shift="0">Today</button><button class="btn small" data-shift="42">Later →</button>
        <span class="muted small">${fmtDate(from)} – ${fmtDate(to)}</span></div>
      ${list.length ? [...byDay].map(([day, rows]) => html`<div class="card">
        <h2>${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <table class="list"><tbody>${rows.map((s) => html`<tr class="click" data-id="${s.id}">
          <td class="nowrap" style="width:110px"><b>${fmtTime(s.starts_at)}</b></td>
          <td><span class="campus-tag"><span class="dot" style="background:${s.campus_color}"></span>${s.campus_short || s.campus_name}</span>
            ${s.type_name ? html`<span class="muted small"> · ${s.type_name}</span>` : ''}
            ${s.series || s.title ? html`<div class="small">${[s.series, s.title].filter(Boolean).join(' · ')}</div>` : ''}</td>
          <td style="text-align:right" class="nowrap">${can('leader') ? fill(s) : ''}</td></tr>`)}</tbody></table></div>`)
      : html`<div class="card empty">No services in these weeks.${can('staff') ? html` Use <b>Add upcoming weeks</b> to create them from your regular service times (set those up in <a href="#/settings/services">Settings → Service times</a>).` : ''}</div>`}`);
  };

  function fill(s) {
    if (!s.needed) return html`<span class="muted small">${s.filled} scheduled</span>`;
    const open = Math.max(0, s.needed - s.filled);
    return html`${open ? html`<span class="pill warn">${open} open</span>` : html`<span class="pill good">${icon('check')} Full</span>`}
      ${s.declined ? html`<span class="pill bad">${s.declined} declined</span>` : ''} <span class="muted small">${s.accepted}/${s.needed} confirmed</span>`;
  }

  el.onclick = (e) => {
    const shift = e.target.closest('[data-shift]');
    if (shift) {
      from = shift.dataset.shift === '0' ? today() : addDays(from, Number(shift.dataset.shift));
      sessionStorage.setItem('mb.services.from', from);
      return draw();
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) go(`/services/${tr.dataset.id}`);
  };

  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-generate]')?.addEventListener('click', async () => {
    const types = (await get('/service-types')).filter((t) => t.day_of_week != null && (!state.campusId || t.campus_id === state.campusId));
    if (!types.length) { toast('Set up your regular service times first in Settings → Service times.', 'bad'); return; }
    const ok = await dialog({
      title: 'Add upcoming weeks', submit: 'Create services',
      body: html`<p class="muted small">Creates services for your regular times. Weeks that already have them are skipped.</p>
        <div class="form"><label class="field">Starting<input type="date" name="from" value="${today()}"></label>
        <label class="field">How many weeks<input type="number" name="weeks" value="8" min="1" max="52"></label></div>
        <div class="stack" style="margin-top:12px">${types.map((t) => html`<label class="check"><input type="checkbox" name="t" value="${t.id}" checked> ${t.name} <span class="muted small">(${visibleCampuses().find((c) => c.id === t.campus_id)?.name || ''})</span></label>`)}</div>`,
      onSubmit: async (f) => {
        const r = await post('/services/generate', { from: f.from.value, weeks: Number(f.weeks.value), service_type_ids: [...f.querySelectorAll('[name=t]:checked')].map((c) => Number(c.value)) });
        toast(r.created ? `Added ${r.created} services.` : 'Those weeks already had services.');
      },
    });
    if (ok) draw();
  });
  top.querySelector('[data-add]')?.addEventListener('click', async () => {
    let created;
    await dialog({
      title: 'One-off service or event',
      body: html`<div class="form">
        <label class="field">Campus<select name="campus_id" required>${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), state.campusId)}</select></label>
        <label class="field">Starts<input type="datetime-local" name="starts_at" required></label>
        <label class="field">Length (minutes)<input type="number" name="duration_min" value="75"></label>
        <label class="field">Title<input type="text" name="title" placeholder="Christmas Eve"></label></div>`,
      onSubmit: async (f) => { created = await post('/services', formData(f)); },
    });
    if (created) go(`/services/${created.id}`);
  });
  await draw();
}

function groupBy(list) {
  const m = new Map();
  for (const s of list) {
    const k = s.starts_at.slice(0, 10);
    m.set(k, [...(m.get(k) || []), s]);
  }
  return m;
}
