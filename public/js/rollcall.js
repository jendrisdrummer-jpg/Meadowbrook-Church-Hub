// Take attendance for one service: tap people (or whole families) as you see them. Works on a phone.
import { get, post, put, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, debounce, familyName, confirm } from './lib.js';
import { state, can } from './app.js';
import { duplicateOf, personLabel } from './guards.js';
import { searchChurch } from './rollcall-church.js';

// opts.mode is the campus's attendance mode: 'names' (roll only), 'headcount' (headcount first, roll
// folded away) or 'both' (today's screen). Accounts below leader have no People page, so their new
// guests go through /services/:id/roll/guest (name only) and nothing links to a person page.
export async function drawRollCall(panel, s, opts = {}) {
  const simple = !can('leader');
  const mode = opts.mode || 'both';
  const areas = state.settings.headcount_areas || ['Auditorium'];
  const value = (a) => s.headcounts.find((h) => h.area === a)?.count ?? '';
  let data = await get(`/services/${s.id}/roll`);
  let present = new Set(data.present);
  const kids = new Set(data.checked_in);
  let filter = 'all';
  let q = '';

  const rollCard = html`<div class="card">
      <div class="card-head"><h2>Take attendance</h2><span class="pill good" data-count></span><span class="muted small" data-saved></span></div>
      <div class="row" style="margin-bottom:10px">
        <input type="search" aria-label="Find someone" placeholder="Find someone" data-q style="max-width:280px">
        <div class="seg" data-filter><button data-f="all" class="on">Everyone</button><button data-f="here">Here</button><button data-f="not">Not yet</button></div>
        <span class="spacer"></span>${mode === 'both' ? html`<button type="button" class="btn small" data-to-headcount>Headcount</button>` : ''}<button class="btn small" data-guest>${icon('plus')} New guest</button>
      </div>
      <div class="roll" data-list></div>
    </div>`;
  const countsCard = html`<div><form class="form" data-counts style="margin-top:12px">${areas.map((a) => html`<label class="field">${a}<input type="number" min="0" name="${a}" value="${value(a)}" inputmode="numeric"></label>`)}</form>
    <p style="margin:8px 0 0" data-useroll-row hidden><button type="button" class="btn small" data-useroll></button></p></div>`;
  mount(panel, html`<div class="stack">
    ${mode === 'headcount' ? html`<div class="card"><div class="card-head"><h2>Headcount</h2><span class="muted small" data-saved></span></div>
        <p class="muted small" style="margin-top:-4px">Room totals, including people not on the roll.</p>${countsCard}</div>
      <details class="card"><summary><b>Names</b> <span class="muted small">Mark who you see, if you want to</span></summary>${rollCard}</details>`
    : mode === 'names' ? rollCard
    : html`${rollCard}<details class="card" data-headcount><summary><b>Headcount</b> <span class="muted small">Room totals, including people not on the roll</span></summary>${countsCard}</details>`}
  </div>`);

  // 'both' mode: the headcount is folded below every family, so a button up top opens it and scrolls there.
  const toHeadcount = panel.querySelector('[data-to-headcount]');
  if (toHeadcount) toHeadcount.onclick = () => {
    const d = panel.querySelector('[data-headcount]');
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    d.querySelector('input')?.focus({ preventScroll: true });
  };

  const list = panel.querySelector('[data-list]');
  const countEl = panel.querySelector('[data-count]');

  // Households in the order of their most regular member; people without a household stand alone.
  function groups() {
    const map = new Map();
    for (const p of data.people) {
      const key = p.household_id ? `h${p.household_id}` : `p${p.id}`;
      if (!map.has(key)) map.set(key, { name: p.household_id ? p.household_name : null, household_id: p.household_id, members: [] });
      map.get(key).members.push(p);
    }
    return [...map.values()];
  }
  const isHere = (p) => present.has(p.id) || kids.has(p.id);
  const matches = (p) => !q || displayName(p).toLowerCase().includes(q) || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q);

  function draw() {
    countEl.textContent = `${new Set([...present, ...kids]).size} here`;
    const useRoll = panel.querySelector('[data-useroll]');
    useRoll.textContent = `Use ${present.size} from roll call`;
    panel.querySelector('[data-useroll-row]').hidden = present.size === 0;
    const shown = groups().map((g) => ({ ...g, members: g.members.filter((p) => matches(p) && (filter === 'all' || (filter === 'here') === isHere(p))) })).filter((g) => g.members.length);
    // A family of two or more takes a full row, its people laid out in the same columns, so
    // the single cards around it keep an even grid instead of leaving gaps.
    mount(list, shown.length ? shown.map((g) => html`<div class="roll-family ${g.name && g.members.length > 1 ? 'multi' : ''}">
      ${g.name && (g.members.length > 1 || (simple && g.members.some(isHere))) ? html`<div class="roll-head"><span>${familyName(g.name)}</span><span class="row" style="gap:6px">
        ${simple && g.household_id && g.members.some(isHere) ? html`<button type="button" class="btn small ghost" data-add-child="${g.household_id}">${icon('plus')} Child</button>` : ''}
        ${g.members.length > 1 ? html`<button type="button" class="btn small" data-family="${g.members.map((m) => m.id).join(',')}">${g.members.every(isHere) ? html`${icon('check')} All here` : 'Mark family'}</button>` : ''}</span></div>` : ''}
      ${g.members.map((p) => html`<button type="button" class="roll-person ${isHere(p) ? 'here' : ''}" data-person="${p.id}" ${kids.has(p.id) ? 'disabled' : ''} aria-pressed="${String(isHere(p))}">
        <span class="roll-check">${icon('check')}</span>${avatar(p)}
        <span class="roll-name">${displayName(p)}${p.household_role === 'child' ? html` <span class="pill">Child</span>` : ''}${p.status === 'guest' ? html` <span class="pill warn">New</span>` : ''}</span>
        ${kids.has(p.id) ? html`<span class="muted small">Checked in</span>` : ''}
      </button>`)}</div>`)
      : html`<div class="empty">${q ? html`No one by that name. Add them as a new guest, or <button type="button" class="btn small" data-church-search>Search the whole church</button>` : 'No one here yet.'}</div>`);
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
  // The server's duplicate check says who this might be; the volunteer decides.
  // Resolves to 'same', 'new', or null when they back out.
  const askSame = async (m) => {
    let answer = null;
    await dialog({
      title: 'Is this the same person?', submit: null, cancel: 'Back',
      body: html`<p>${m.campus ? html`There’s already a <b>${personLabel(m)}</b> at ${m.campus}` : html`We already have <b>${personLabel(m)}</b>`}${m.phone || m.email ? html` (${[m.phone, m.email].filter(Boolean).join(' · ')})` : ''}. Is this who you mean?</p>
        <div class="stack"><button type="button" class="btn primary" data-same>Yes, that’s them</button>
        <button type="button" class="btn" data-new>No, add someone new</button></div>`,
      onOpen: (d, close) => {
        d.querySelector('[data-same]').onclick = () => { answer = 'same'; close(); };
        d.querySelector('[data-new]').onclick = () => { answer = 'new'; close(); };
      },
    });
    return answer;
  };

  // Adds a guest (or, with householdId, a child into that family) and marks them here.
  async function addGuest({ householdId = null } = {}) {
    let person;
    let existing = false;
    await dialog({
      title: householdId ? 'Add a child to this family' : 'New guest', submit: 'Add and mark here',
      body: html`<div class="form"><label class="field">First name<input type="text" name="first_name" required></label>
        <label class="field">Last name<input type="text" name="last_name"></label>
        ${simple ? '' : html`<label class="field">Mobile phone<input type="tel" name="phone"></label>
        <label class="field">Email<input type="email" name="email"></label>`}</div>`,
      onSubmit: async (f) => {
        const base = formData(f);
        // Below leader there is no People page: the roll's own endpoint adds them (name only).
        const create = (extra = {}) => simple
          ? post(`/services/${s.id}/roll/guest`, { first_name: base.first_name, last_name: base.last_name, ...(householdId ? { household_id: householdId, role: 'child' } : {}), ...extra })
          : post('/people', { ...base, status: 'guest', campus_id: s.campus_id, new_household: true, ...extra });
        try {
          person = await create();
        } catch (e) {
          const m = duplicateOf(e);
          if (!m) throw e;
          const pick = await askSame(m);
          if (!pick) return false;
          if (pick === 'same') { person = m; existing = true; } else person = await create({ force: true });
        }
      },
    });
    if (!person) return;
    // Someone found by the duplicate check may be at another campus, which the church-wide route allows.
    await (existing ? post(`/services/${s.id}/roll/church`, { person_id: person.id }) : post(`/services/${s.id}/roll`, { person_ids: [person.id], present: true }));
    toast(`${displayName(person)} ${existing ? 'marked here' : 'added'}.`);
    data = await get(`/services/${s.id}/roll`);
    present = new Set(data.present);
    draw();
  }
  panel.querySelector('[data-guest]').onclick = () => addGuest();
  list.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-church-search]')) return;
    if (!(await searchChurch(s, panel.querySelector('[data-q]').value.trim()))) return;
    data = await get(`/services/${s.id}/roll`);
    present = new Set(data.present);
    draw();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-child]');
    if (b) addGuest({ householdId: Number(b.dataset.addChild) });
  });

  const form = panel.querySelector('[data-counts]');
  form.addEventListener('input', debounce(async () => {
    try {
      s.headcounts = await put(`/services/${s.id}/headcounts`, { counts: formData(form) });
      panel.querySelector('[data-saved]').textContent = 'Headcount saved';
    } catch (e) { fail(e); }
  }, 600));

  // Copies the roll call count into the main headcount field. Nothing is saved until this is confirmed
  // (a number already typed there is only replaced after asking), then it saves like typing does.
  panel.querySelector('[data-useroll]').onclick = async () => {
    const field = form.querySelector('input');
    const n = present.size;
    if (!field || !n) return;
    if (field.value !== '' && Number(field.value) !== n) {
      if (!(await confirm('Replace the headcount?', `${areas[0]} says ${field.value}. Use ${n} from roll call instead?`, 'Use roll call', { danger: false }))) return;
    }
    field.value = n;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  };

  draw();
}
