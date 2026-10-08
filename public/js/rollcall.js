// Roll call for one service: tap people (or whole families) as you see them. Works on a phone.
import { get, post, put, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, debounce } from './lib.js';
import { state } from './app.js';

export async function drawRollCall(panel, s) {
  const areas = state.settings.headcount_areas || ['Auditorium'];
  const value = (a) => s.headcounts.find((h) => h.area === a)?.count ?? '';
  let data = await get(`/services/${s.id}/roll`);
  let present = new Set(data.present);
  const kids = new Set(data.checked_in);
  let filter = 'all';
  let q = '';

  mount(panel, html`<div class="stack">
    <div class="card">
      <div class="card-head"><h2>Roll call</h2><span class="pill good" data-count></span><span class="muted small" data-saved></span></div>
      <div class="row" style="margin-bottom:10px">
        <input type="search" placeholder="Find someone" data-q style="max-width:280px">
        <div class="seg" data-filter><button data-f="all" class="on">Everyone</button><button data-f="here">Here</button><button data-f="not">Not yet</button></div>
        <span class="spacer"></span><button class="btn small" data-guest>${icon('plus')} New guest</button>
      </div>
      <div class="roll" data-list></div>
    </div>
    <details class="card"><summary><b>Headcount</b> <span class="muted small">Room totals, including people not on the roll</span></summary>
      <form class="form" data-counts style="margin-top:12px">${areas.map((a) => html`<label class="field">${a}<input type="number" min="0" name="${a}" value="${value(a)}" inputmode="numeric"></label>`)}</form>
    </details>
  </div>`);

  const list = panel.querySelector('[data-list]');
  const countEl = panel.querySelector('[data-count]');

  // Households in the order of their most regular member; people without a household stand alone.
  function groups() {
    const map = new Map();
    for (const p of data.people) {
      const key = p.household_id ? `h${p.household_id}` : `p${p.id}`;
      if (!map.has(key)) map.set(key, { name: p.household_id ? p.household_name : null, members: [] });
      map.get(key).members.push(p);
    }
    return [...map.values()];
  }
  const isHere = (p) => present.has(p.id) || kids.has(p.id);
  const matches = (p) => !q || displayName(p).toLowerCase().includes(q) || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q);

  function draw() {
    countEl.textContent = `${new Set([...present, ...kids]).size} here`;
    const shown = groups().map((g) => ({ ...g, members: g.members.filter((p) => matches(p) && (filter === 'all' || (filter === 'here') === isHere(p))) })).filter((g) => g.members.length);
    mount(list, shown.length ? shown.map((g) => html`<div class="roll-family">
      ${g.name && g.members.length > 1 ? html`<div class="roll-head"><span>${g.name}</span>
        <button type="button" class="btn small" data-family="${g.members.map((m) => m.id).join(',')}">${g.members.every(isHere) ? html`${icon('check')} All here` : 'Mark family'}</button></div>` : ''}
      ${g.members.map((p) => html`<button type="button" class="roll-person ${isHere(p) ? 'here' : ''}" data-person="${p.id}" ${kids.has(p.id) ? 'disabled' : ''} aria-pressed="${isHere(p)}">
        <span class="roll-check">${icon('check')}</span>${avatar(p)}
        <span class="roll-name">${displayName(p)}${p.household_role === 'child' ? html` <span class="pill">Child</span>` : ''}${p.status === 'guest' ? html` <span class="pill warn">Guest</span>` : ''}</span>
        ${kids.has(p.id) ? html`<span class="muted small">Checked in</span>` : ''}
      </button>`)}</div>`)
      : html`<div class="empty">${q ? 'No one by that name. Add them as a new guest.' : 'No one here yet.'}</div>`);
  }

  async function mark(ids, on) {
    ids = ids.filter((id) => !kids.has(id));
    for (const id of ids) on ? present.add(id) : present.delete(id);
    draw();
    try {
      await post(`/services/${s.id}/roll`, { person_ids: ids, present: on });
    } catch (e) {
      for (const id of ids) on ? present.delete(id) : present.add(id);
      draw();
      fail(e);
    }
  }

  list.onclick = (e) => {
    const fam = e.target.closest('[data-family]');
    if (fam) {
      const ids = fam.dataset.family.split(',').map(Number);
      const all = ids.every((id) => present.has(id) || kids.has(id));
      return mark(ids, !all);
    }
    const btn = e.target.closest('[data-person]');
    if (btn && !btn.disabled) mark([Number(btn.dataset.person)], !present.has(Number(btn.dataset.person)));
  };
  panel.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 120));
  panel.querySelector('[data-filter]').onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    panel.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
  panel.querySelector('[data-guest]').onclick = async () => {
    let person;
    await dialog({
      title: 'New guest', submit: 'Add and mark here',
      body: html`<div class="form"><label class="field">First name<input type="text" name="first_name" required></label>
        <label class="field">Last name<input type="text" name="last_name"></label>
        <label class="field">Mobile phone<input type="tel" name="phone"></label>
        <label class="field">Email<input type="email" name="email"></label></div>`,
      onSubmit: async (f) => {
        person = await post('/people', { ...formData(f), status: 'guest', campus_id: s.campus_id, new_household: true, force: true });
      },
    });
    if (!person) return;
    await post(`/services/${s.id}/roll`, { person_ids: [person.id], present: true });
    toast(`${displayName(person)} added.`);
    data = await get(`/services/${s.id}/roll`);
    present = new Set(data.present);
    draw();
  };

  const form = panel.querySelector('[data-counts]');
  form.addEventListener('input', debounce(async () => {
    try {
      s.headcounts = await put(`/services/${s.id}/headcounts`, { counts: formData(form) });
      panel.querySelector('[data-saved]').textContent = 'Headcount saved';
    } catch (e) { fail(e); }
  }, 600));

  draw();
}
