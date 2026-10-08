// People directory: search, filter by status, add someone.
import { get, html, mount, icon, avatar, displayName, debounce, fail } from '../lib.js';
import { state, can, setTitle, go, campusName } from '../app.js';
import { personDialog } from './person.js';

const STATUS = { member: 'good', regular: 'info', guest: 'warn', inactive: '' };

export default async function people(el) {
  setTitle('People', html`${can('staff') ? html`<a class="btn" href="/api/people/export.csv">${icon('download')} Export</a>
    <button class="btn primary" data-add>${icon('plus')} Add person</button>` : ''}`);
  const saved = JSON.parse(sessionStorage.getItem('mb.people') || '{}');
  mount(el, html`<div class="card">
    <div class="row" style="margin-bottom:12px">
      <input type="search" data-q placeholder="Search name, email or phone" value="${saved.q || ''}" style="max-width:340px">
      <select data-status style="max-width:170px">
        <option value="">Everyone</option><option value="member">Members</option><option value="regular">Regular attenders</option>
        <option value="guest">Guests</option><option value="inactive">Inactive</option></select>
      <select data-role style="max-width:150px"><option value="">Adults & kids</option><option value="adult">Adults</option><option value="child">Kids</option></select>
      <span class="spacer"></span><span class="muted small" data-count></span>
    </div>
    <div class="table-wrap" data-list></div>
    <div class="row end" style="margin-top:10px"><button class="btn small hidden" data-more>Show more</button></div>
  </div>`);
  const q = el.querySelector('[data-q]');
  const statusSel = el.querySelector('[data-status]');
  const roleSel = el.querySelector('[data-role]');
  statusSel.value = saved.status || '';
  roleSel.value = saved.role || '';
  let rows = [];

  async function load(append = false) {
    const params = new URLSearchParams({ q: q.value, status: statusSel.value, role: roleSel.value, limit: 100, offset: append ? rows.length : 0 });
    if (state.campusId) params.set('campus_id', state.campusId);
    sessionStorage.setItem('mb.people', JSON.stringify({ q: q.value, status: statusSel.value, role: roleSel.value }));
    try {
      const d = await get(`/people?${params}`);
      rows = append ? rows.concat(d.rows) : d.rows;
      el.querySelector('[data-count]').textContent = `${d.total} ${d.total === 1 ? 'person' : 'people'}`;
      el.querySelector('[data-more]').classList.toggle('hidden', rows.length >= d.total);
      mount(el.querySelector('[data-list]'), rows.length ? html`<table class="list">
        <thead><tr><th>Name</th><th>Status</th><th>Household</th><th>Contact</th>${state.campuses.length > 1 ? html`<th>Campus</th>` : ''}</tr></thead>
        <tbody>${rows.map((p) => html`<tr class="click" data-id="${p.id}">
          <td><div class="person-cell">${avatar(p)}<span><b>${displayName(p)}</b>${p.household_role === 'child' ? html` <span class="pill">Child</span>` : ''}</span></div></td>
          <td><span class="pill ${STATUS[p.status]}">${p.status}</span></td>
          <td class="muted">${p.household_name || ''}</td>
          <td class="small">${p.email}<br><span class="muted">${p.phone}</span></td>
          ${state.campuses.length > 1 ? html`<td class="muted small">${campusName(p.campus_id)}</td>` : ''}
        </tr>`)}</tbody></table>`
        : html`<div class="empty">No one matches. ${can('admin') ? html`Bring everyone over from Faith Teams in <a href="#/settings/import">Settings → Import</a>.` : ''}</div>`);
    } catch (e) { fail(e); }
  }

  q.addEventListener('input', debounce(() => load()));
  statusSel.onchange = () => load();
  roleSel.onchange = () => load();
  el.querySelector('[data-more]').onclick = () => load(true);
  el.onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) go(`/people/${tr.dataset.id}`);
  };
  document.querySelector('[data-add]')?.addEventListener('click', async () => {
    const p = await personDialog();
    if (p) go(`/people/${p.id}`);
  });
  load();
}
