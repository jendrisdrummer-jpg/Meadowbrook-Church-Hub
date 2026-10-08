// One team: its positions (chips) and a roster grid of who serves in which position.
import { get, post, patch, put, del, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, confirm, pickPeople, debounce } from '../lib.js';
import { can, setTitle, campusName } from '../app.js';

// opts.adding: reopen the new-position box (after saving one); opts.added: highlight that person.
export default async function team(el, id, opts = {}) {
  const t = await get(`/teams/${id}`);
  const manage = t.can_manage;
  const staff = can('staff');
  setTitle(t.name, manage ? html`<button class="btn" data-edit>${icon('edit')} Edit team</button>` : '');

  // One row per person, with the set of positions they serve in.
  const people = new Map();
  for (const m of t.members) {
    const cur = people.get(m.person_id) || { ...m, positions: new Set(), is_leader: 0 };
    if (m.position_id) cur.positions.add(m.position_id);
    cur.is_leader = cur.is_leader || m.is_leader;
    people.set(m.person_id, cur);
  }
  const roster = [...people.values()].sort((a, b) => (b.is_leader - a.is_leader) || displayName(a).localeCompare(displayName(b)));

  mount(el, html`
    <div class="row muted" style="margin:-6px 0 14px"><span class="dot" style="background:${t.color}"></span>${t.campus_id ? campusName(t.campus_id) : 'All campuses'}
      · ${roster.length} ${roster.length === 1 ? 'person' : 'people'}${t.description ? html` · ${t.description}` : ''}</div>
    <div class="card">
      <h2>Positions</h2>
      <p class="muted small" style="margin-top:-4px">${manage ? 'Click a position to rename it. Drag to reorder. Add as many as you need.' : ''}</p>
      <div class="chips" data-positions>
        ${t.positions.map((p) => html`<span class="chip ${manage ? 'link' : ''}" ${manage ? html`draggable="true"` : ''} data-pos="${p.id}">${p.name}
          <span class="muted small">${t.members.filter((m) => m.position_id === p.id).length}</span>
          ${manage ? html`<button type="button" class="chip-x" data-del-pos="${p.id}" aria-label="Delete ${p.name}">${icon('x')}</button>` : ''}</span>`)}
        ${manage ? (opts.adding
          ? html`<span class="chip new-pos editing"><input type="text" placeholder="Position name, e.g. Bass" data-new-pos aria-label="New position name"><button type="button" class="chip-ok" data-save-pos title="Save (Enter)">${icon('check')}</button><button type="button" class="chip-x" data-cancel-pos title="Done (Esc)">${icon('x')}</button></span>
            <span class="muted small new-pos-hint">Press Enter to save, then type the next one.</span>`
          : html`<button type="button" class="chip new-pos" data-start-pos>${icon('plus')} New position</button>`) : ''}
        ${!t.positions.length && !manage ? html`<span class="muted">No positions yet.</span>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Roster</h2>${roster.length && t.positions.length ? html`<span class="muted small">${manage ? 'Tick the positions each person can serve in.' : ''}</span>` : ''}
        ${manage ? html`<button class="btn small" data-add-people>${icon('people')} Add several…</button>` : ''}</div>
      ${manage ? html`<div class="add-member" data-add-member><span class="add-member-icon">${icon('plus')}</span>
        <input type="search" placeholder="Add someone to ${t.name}: type a name" data-member-q autocomplete="off" aria-label="Add someone to the team">
        <div class="suggest hidden" data-member-list></div></div>` : ''}
      ${roster.length ? html`<div class="table-wrap"><table class="roster">
        <thead><tr><th>Person</th>${t.positions.map((p) => html`<th>${p.name}</th>`)}${staff ? html`<th>Leader</th>` : ''}${manage ? html`<th></th>` : ''}</tr></thead>
        <tbody>${roster.map((m) => html`<tr data-person="${m.person_id}" class="${m.person_id === opts.added ? 'just-added' : ''}">
          <td><a class="person-cell" href="#/people/${m.person_id}" style="color:inherit">${avatar(m)}<span><b>${displayName(m)}</b>${m.is_leader ? html` <span class="pill info">Leader</span>` : ''}</span></a></td>
          ${t.positions.map((p) => html`<td><button type="button" class="tick ${m.positions.has(p.id) ? 'on' : ''}" data-toggle="${p.id}" ${manage ? '' : 'disabled'}
            aria-label="${displayName(m)} serves as ${p.name}" aria-pressed="${m.positions.has(p.id)}">${icon('check')}</button></td>`)}
          ${staff ? html`<td><button type="button" class="tick ${m.is_leader ? 'on' : ''}" data-leader aria-label="${displayName(m)} is a leader" aria-pressed="${Boolean(m.is_leader)}">${icon('check')}</button></td>` : ''}
          ${manage ? html`<td><button class="icon-btn" data-remove title="Remove from team">${icon('x')}</button></td>` : ''}
        </tr>`)}</tbody></table></div>`
        : html`<div class="empty">No one on this team yet.${manage ? ' Type a name above to add someone.' : ''}</div>`}
    </div>`);

  const reload = (o = {}) => team(el, id, o);
  const save = (m) => put(`/teams/${t.id}/members/${m.person_id}`, { position_ids: [...m.positions], is_leader: Boolean(m.is_leader) });

  async function addPeople() {
    const already = new Set(roster.map((m) => m.person_id));
    const { people: chosen, form } = await pickPeople(`Add people to ${t.name}`, {
      exclude: already, submit: 'Add to team',
      extra: t.positions.length ? html`<h3 style="margin-top:14px">They’ll serve as</h3><div class="row">${t.positions.map((p) => html`<label class="check"><input type="checkbox" name="pos" value="${p.id}"> ${p.name}</label>`)}</div>
        <p class="muted small">You can change each person’s positions afterwards in the roster.</p>` : '',
    });
    if (!chosen.length) return;
    const positionIds = form ? [...form.querySelectorAll('[name=pos]:checked')].map((c) => Number(c.value)) : [];
    try {
      for (const p of chosen) await put(`/teams/${t.id}/members/${p.id}`, { position_ids: positionIds });
      toast(`Added ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}.`);
      reload();
    } catch (e) { fail(e); }
  }

  // Add one person right from the roster: type, pick, done. New people float to the top.
  const box = el.querySelector('[data-add-member]');
  if (box) {
    const q = box.querySelector('[data-member-q]');
    const list = box.querySelector('[data-member-list]');
    let rows = [];
    let active = 0;
    const hide = () => list.classList.add('hidden');
    const draw = () => {
      mount(list, rows.length ? rows.map((p, i) => html`<button type="button" class="${i === active ? 'on' : ''}" data-pick="${i}" ${people.has(p.id) ? 'disabled' : ''}>${avatar(p)}
          <span><b>${displayName(p)}</b> <span class="muted small">${people.has(p.id) ? 'Already on the team' : p.email || p.phone || ''}</span></span></button>`)
        : html`<div class="muted small" style="padding:8px 10px">No one found. Add them in People first.</div>`);
      list.classList.remove('hidden');
    };
    const search = debounce(async () => {
      const v = q.value.trim();
      if (v.length < 2) return hide();
      rows = (await get(`/people?q=${encodeURIComponent(v)}&limit=8`)).rows;
      active = Math.max(0, rows.findIndex((p) => !people.has(p.id)));
      draw();
    }, 200);
    const add = async (p) => {
      if (!p || people.has(p.id)) return;
      try {
        // One position? Put them in it straight away.
        await put(`/teams/${t.id}/members/${p.id}`, { position_ids: t.positions.length === 1 ? [t.positions[0].id] : [] });
        toast(t.positions.length > 1 ? `${displayName(p)} added. Tick the positions they can serve in.` : `${displayName(p)} added.`);
        await reload({ added: p.id });
        el.querySelector('[data-member-q]')?.focus();
      } catch (err) { fail(err); }
    };
    q.addEventListener('input', search);
    q.addEventListener('keydown', (e) => {
      if (list.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); add(rows[active]); }
      if (e.key === 'Escape') hide();
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) add(rows[Number(b.dataset.pick)]); });
    q.addEventListener('blur', () => setTimeout(hide, 150));
  }
  if (opts.added) el.querySelector('tr.just-added')?.scrollIntoView({ block: 'center' });

  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-edit]')?.addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Edit team',
      body: html`<div class="form"><label class="field wide">Name<input type="text" name="name" value="${t.name}" required></label>
        <label class="field">Colour<input type="color" name="color" value="${t.color}" style="height:38px;width:100%"></label>
        <label class="field wide">Description<textarea name="description">${t.description}</textarea></label>
        ${staff ? html`<label class="check wide"><input type="checkbox" name="archived"> Archive this team</label>` : ''}</div>`,
      onSubmit: (f) => patch(`/teams/${t.id}`, formData(f)),
    });
    if (ok) reload();
  });

  // ---------------------------------------------------------------- positions
  // "+ New position" opens a box; Enter (or ✓) saves it as a position and leaves the box open
  // for the next one; Esc (or ×, or clicking away with it empty) closes it.
  const chipBox = el.querySelector('[data-positions]');
  const input = chipBox.querySelector('[data-new-pos]');
  let saving = false;
  const savePos = async (keepOpen = true) => {
    const name = input?.value.trim();
    if (!name) { if (!keepOpen) reload(); return; }
    if (saving) return;
    saving = true;
    try { await post(`/teams/${t.id}/positions`, { name }); toast(`Added “${name}”.`); await reload({ adding: keepOpen }); }
    catch (e) { saving = false; fail(e); }
  };
  if (input) {
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); savePos(true); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = ''; reload(); }
    });
    // Clicking away keeps what was typed (saved), or just closes an empty box.
    input.addEventListener('blur', () => setTimeout(() => { if (!chipBox.contains(document.activeElement) && document.body.contains(input)) savePos(false); }, 150));
  }
  chipBox.querySelector('[data-start-pos]')?.addEventListener('click', () => reload({ adding: true }));
  chipBox.querySelector('[data-save-pos]')?.addEventListener('mousedown', (e) => { e.preventDefault(); savePos(true); });
  chipBox.querySelector('[data-cancel-pos]')?.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = ''; reload(); });
  let dragging = null;
  chipBox.addEventListener('dragstart', (e) => { dragging = e.target.closest('[data-pos]'); });
  chipBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('[data-pos]');
    if (!dragging || !over || over === dragging) return;
    const after = e.clientX > over.getBoundingClientRect().left + over.offsetWidth / 2;
    over[after ? 'after' : 'before'](dragging);
  });
  chipBox.addEventListener('dragend', async () => {
    if (!dragging) return;
    dragging = null;
    try { await put(`/teams/${t.id}/positions/order`, { ids: [...chipBox.querySelectorAll('[data-pos]')].map((c) => Number(c.dataset.pos)) }); reload(); } catch (e) { fail(e); }
  });

  el.onclick = async (e) => {
    try {
      if (e.target.closest('.card [data-add-people]')) return addPeople();
      const delPos = e.target.closest('[data-del-pos]');
      if (delPos) {
        const p = t.positions.find((x) => x.id === Number(delPos.dataset.delPos));
        if (await confirm(`Delete “${p.name}”?`, 'People will no longer be listed for it.')) { await del(`/positions/${p.id}`); reload(); }
        return;
      }
      const chip = e.target.closest('.chip.link[data-pos]');
      if (chip) {
        const p = t.positions.find((x) => x.id === Number(chip.dataset.pos));
        const ok = await dialog({ title: 'Rename position', body: html`<label class="field">Name<input type="text" name="name" value="${p.name}" required></label>`, onSubmit: (f) => patch(`/positions/${p.id}`, formData(f)) });
        if (ok) reload();
        return;
      }
      const row = e.target.closest('tr[data-person]');
      if (!row) return;
      const m = people.get(Number(row.dataset.person));
      const toggle = e.target.closest('[data-toggle]');
      if (toggle && manage) {
        const pid = Number(toggle.dataset.toggle);
        if (m.positions.has(pid)) m.positions.delete(pid); else m.positions.add(pid);
        toggle.classList.toggle('on', m.positions.has(pid));
        toggle.setAttribute('aria-pressed', m.positions.has(pid));
        await save(m);
      }
      const leader = e.target.closest('[data-leader]');
      if (leader) {
        m.is_leader = m.is_leader ? 0 : 1;
        await save(m);
        reload();
      }
      if (e.target.closest('[data-remove]') && await confirm(`Remove ${displayName(m)}?`, 'They’ll stay in the directory and keep any services they’re already scheduled for.', 'Remove')) {
        await del(`/teams/${t.id}/members/${m.person_id}`);
        reload();
      }
    } catch (err) { fail(err); reload(); }
  };
}
