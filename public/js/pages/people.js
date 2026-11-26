// People directory: search, filter by status, add someone.
import { get, patch, html, raw, mount, icon, avatar, displayName, debounce, fail, toast } from '../lib.js';
import { state, can, setTitle, go, campusName } from '../app.js';
import { personDialog } from './person.js';

const STATUS = { member: 'good', regular: 'info', guest: 'warn', inactive: '' };
const LABEL = { member: 'Member', regular: 'Regular', guest: 'Guest', inactive: 'Inactive' };
// Where the list was when someone opened a person, so coming back lands in the same place.
const POS = 'mb.people.pos';

export default async function people(el) {
  // Export lives in a "…" menu so the phone header keeps room for Add person.
  setTitle('People', html`${can('staff') ? html`<button class="btn primary" data-add>${icon('plus')} Add person</button>
    <span class="kebab"><button class="icon-btn" data-kebab aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${icon('dots')}</button>
      <div class="kebab-menu hidden" role="menu"><a role="menuitem" href="/api/people/export.csv">${icon('download')} Export everyone (CSV)</a></div></span>` : ''}`);
  const saved = JSON.parse(sessionStorage.getItem('mb.people') || '{}');
  const fields = await get('/profile-fields').catch(() => []);
  mount(el, html`<div class="card">
    <div class="people-bar">
      <input type="search" data-q placeholder="Search name, email or phone" value="${saved.q || ''}" aria-label="Search people">
      <button class="btn" data-filters aria-expanded="false">${icon('filter')} Filters <span class="count-badge hidden" data-fcount></span></button>
    </div>
    <div class="chips people-quick" data-quick role="group" aria-label="Quick filters">
      <button class="chip link" data-quick="">Everyone</button><button class="chip link" data-quick="guest">Guests</button><button class="chip link" data-quick="child">Kids</button>
      <span class="spacer"></span><span class="muted small" data-count></span>
    </div>
    <div class="people-filters hidden" data-fpanel>
      <label class="field">Status<select data-status>
        <option value="">Everyone</option><option value="member">Members</option><option value="regular">Regular attenders</option>
        <option value="guest">Guests</option><option value="inactive">Inactive</option></select></label>
      <label class="field">Age<select data-role><option value="">Adults & kids</option><option value="adult">Adults</option><option value="child">Kids</option></select></label>
      ${fields.length ? html`<label class="field">Profile field<select data-field><option value="">Any profile</option>${fields.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select></label>
        <label class="field hidden" data-fval-wrap>Value<select data-fval></select></label>` : ''}
      <div class="row end wide"><button class="btn small" data-clear-filters>Clear filters</button></div>
    </div>
    <div data-list></div>
    <div class="row end" style="margin-top:10px"><button class="btn small hidden" data-more>Show more</button></div>
  </div>`);
  const q = el.querySelector('[data-q]');
  const statusSel = el.querySelector('[data-status]');
  const roleSel = el.querySelector('[data-role]');
  statusSel.value = saved.status || '';
  roleSel.value = saved.role || '';
  const fieldSel = el.querySelector('[data-field]');
  const fvalSel = el.querySelector('[data-fval]');
  // Value choices depend on the field: its options, yes/no, or just "has an answer" / "empty".
  const fillValues = (keep) => {
    const f = fields.find((x) => x.id === Number(fieldSel?.value));
    if (!fvalSel) return;
    el.querySelector('[data-fval-wrap]').classList.toggle('hidden', !f);
    if (!f) { fvalSel.innerHTML = ''; return; }
    const opts = [{ value: 'set', label: 'Has an answer' }, { value: 'unset', label: 'No answer yet' },
      ...(f.type === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : []),
      ...(['choice', 'multi'].includes(f.type) ? f.options.map((o) => ({ value: o, label: o })) : [])];
    mount(fvalSel, opts.map((o) => html`<option value="${o.value}">${o.label}</option>`));
    if (keep && opts.some((o) => o.value === keep)) fvalSel.value = keep;
  };
  if (fieldSel && saved.field) { fieldSel.value = saved.field; fillValues(saved.fval); }
  let rows = [];
  const fpanel = el.querySelector('[data-fpanel]');
  const fbtn = el.querySelector('[data-filters]');
  // The badge counts filters that are set, since they hide behind the button.
  const syncFilters = () => {
    const n = [statusSel.value, roleSel.value, fieldSel?.value].filter(Boolean).length;
    const badge = el.querySelector('[data-fcount]');
    badge.textContent = n; badge.classList.toggle('hidden', !n);
    const on = statusSel.value === 'guest' && !roleSel.value ? 'guest' : roleSel.value === 'child' && !statusSel.value ? 'child' : !statusSel.value && !roleSel.value ? '' : null;
    el.querySelectorAll('button[data-quick]').forEach((c) => c.classList.toggle('on', c.dataset.quick === on));
  };
  fbtn.onclick = () => { const open = fpanel.classList.toggle('hidden') === false; fbtn.setAttribute('aria-expanded', open); };
  if (statusSel.value || roleSel.value || saved.field) fpanel.classList.remove('hidden'), fbtn.setAttribute('aria-expanded', 'true');

  async function load(append = false, first = 100) {
    const params = new URLSearchParams({ q: q.value, status: statusSel.value, role: roleSel.value, limit: append ? 100 : first, offset: append ? rows.length : 0 });
    if (fieldSel?.value) { params.set('field_id', fieldSel.value); params.set('field_value', fvalSel.value); }
    if (state.campusId) params.set('campus_id', state.campusId);
    syncFilters();
    sessionStorage.setItem('mb.people', JSON.stringify({ q: q.value, status: statusSel.value, role: roleSel.value, field: fieldSel?.value || '', fval: fvalSel?.value || '' }));
    try {
      const d = await get(`/people?${params}`);
      rows = append ? rows.concat(d.rows) : d.rows;
      el.querySelector('[data-count]').textContent = `${d.total} ${d.total === 1 ? 'person' : 'people'}`;
      el.querySelector('[data-more]').classList.toggle('hidden', rows.length >= d.total);
      mount(el.querySelector('[data-list]'), rows.length ? html`<div class="plist">${rows.map((p) => html`<div class="prow click" data-id="${p.id}" tabindex="0" role="link">
          ${avatar(p)}
          <div class="prow-main"><div class="prow-name"><b>${displayName(p)}</b> ${can('staff') ? html`<select class="status-pick pill ${STATUS[p.status]}" data-status-of="${p.id}" aria-label="Status for ${displayName(p)}">
            ${Object.keys(LABEL).map((k) => html`<option value="${k}" ${k === p.status ? raw('selected') : ''}>${LABEL[k]}</option>`)}</select>`
            : html`<span class="pill ${STATUS[p.status]}">${LABEL[p.status] || p.status}</span>`}${p.household_role === 'child' ? html` <span class="pill">Child</span>` : ''}</div>
            <div class="muted small">${[p.household_name, state.campuses.length > 1 ? campusName(p.campus_id) : ''].filter(Boolean).join(' · ')}</div></div>
          <div class="prow-contact small">${p.email ? html`<span class="wide-only">${p.email}</span>` : ''}${p.phone ? html`<span class="wide-only muted">${p.phone}</span>` : ''}</div>
          ${p.phone ? html`<a class="icon-btn prow-call" href="tel:${p.phone}" aria-label="Call ${displayName(p)}" title="Call ${p.phone}">${icon('phone')}</a>` : ''}
        </div>`)}</div>`
        : html`<div class="empty">No one matches. ${can('admin') ? html`Bring everyone over from Faith Teams in <a href="#/settings/import">Settings → Import</a>.` : ''}</div>`);
    } catch (e) { fail(e); }
  }
  // Remember the place, then open the person.
  const open = (id) => {
    try { sessionStorage.setItem(POS, JSON.stringify({ id: Number(id), count: rows.length })); } catch { /* private mode */ }
    go(`/people/${id}`);
  };

  // Changing status right from the list (staff), for tidying up members and regulars quickly.
  el.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status-of]');
    if (!sel) return;
    const p = rows.find((x) => x.id === Number(sel.dataset.statusOf));
    const before = p.status;
    try {
      await patch(`/people/${p.id}`, { status: sel.value });
      p.status = sel.value;
      sel.className = `status-pick pill ${STATUS[p.status]}`;
      toast(`${displayName(p)} is now ${p.status === 'regular' ? 'a regular attender' : p.status === 'inactive' ? 'inactive' : `a ${LABEL[p.status].toLowerCase()}`}.`);
    } catch (err) { sel.value = before; fail(err); }
  });

  q.addEventListener('input', debounce(() => load()));
  statusSel.onchange = () => load();
  roleSel.onchange = () => load();
  if (fieldSel) {
    fieldSel.onchange = () => { fillValues(); load(); };
    fvalSel.onchange = () => load();
  }
  el.querySelector('[data-more]').onclick = () => load(true);
  el.onclick = (e) => {
    const quick = e.target.closest('button[data-quick]');
    if (quick) {
      statusSel.value = quick.dataset.quick === 'guest' ? 'guest' : '';
      roleSel.value = quick.dataset.quick === 'child' ? 'child' : '';
      return load();
    }
    if (e.target.closest('[data-clear-filters]')) {
      statusSel.value = ''; roleSel.value = '';
      if (fieldSel) { fieldSel.value = ''; fillValues(); }
      return load();
    }
    if (e.target.closest('a, select')) return; // the call link, the status picker
    const row = e.target.closest('.prow[data-id]');
    if (row) open(row.dataset.id);
  };
  el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('.prow')) open(e.target.dataset.id); };
  // The "…" menu in the header (outside this element).
  const kebab = document.querySelector('[data-kebab]');
  if (kebab) {
    const menu = kebab.parentElement.querySelector('.kebab-menu');
    const setOpen = (o) => { menu.classList.toggle('hidden', !o); kebab.setAttribute('aria-expanded', o); };
    kebab.onclick = (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); };
    menu.onclick = () => setOpen(false);
    const away = () => { if (!menu.isConnected) document.removeEventListener('click', away); else setOpen(false); };
    document.addEventListener('click', away);
  }
  document.querySelector('[data-add]')?.addEventListener('click', async () => {
    const p = await personDialog();
    if (p) go(`/people/${p.id}`);
  });
  // Coming back from a person: show as many rows as before and scroll that person into view.
  let back = null;
  try { back = JSON.parse(sessionStorage.getItem(POS) || 'null'); sessionStorage.removeItem(POS); } catch { /* private mode */ }
  await load(false, Math.min(Math.max(back?.count || 0, 100), 500));
  const row = back && el.querySelector(`.prow[data-id="${back.id}"]`);
  // After the router's scroll-to-top, which runs once this page has drawn.
  if (row) setTimeout(() => { row.scrollIntoView({ block: 'center' }); row.classList.add('just-seen'); row.focus({ preventScroll: true }); setTimeout(() => row.classList.remove('just-seen'), 1500); });
}
