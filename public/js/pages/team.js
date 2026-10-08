// One team: its positions (chips) and a roster grid of who serves in which position.
import { get, post, patch, put, del, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, confirm, pickPeople } from '../lib.js';
import { can, setTitle, campusName } from '../app.js';

export default async function team(el, id) {
  const t = await get(`/teams/${id}`);
  const manage = t.can_manage;
  const staff = can('staff');
  setTitle(t.name, manage ? html`<button class="btn" data-edit>${icon('edit')} Edit team</button><button class="btn primary" data-add-people>${icon('plus')} Add people</button>` : '');

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
      <p class="muted small" style="margin-top:-4px">${manage ? 'Click a position to rename it. Drag to reorder.' : ''}</p>
      <div class="chips" data-positions>
        ${t.positions.map((p) => html`<span class="chip ${manage ? 'link' : ''}" ${manage ? html`draggable="true"` : ''} data-pos="${p.id}">${p.name}
          <span class="muted small">${t.members.filter((m) => m.position_id === p.id).length}</span>
          ${manage ? html`<button type="button" class="chip-x" data-del-pos="${p.id}" aria-label="Delete ${p.name}">${icon('x')}</button>` : ''}</span>`)}
        ${manage ? html`<span class="chip-add"><input type="text" placeholder="New position, e.g. Bass" data-new-pos><button type="button" class="btn small" data-add-pos>${icon('plus')} Add</button></span>` : ''}
        ${!t.positions.length && !manage ? html`<span class="muted">No positions yet.</span>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Roster</h2>${roster.length && t.positions.length ? html`<span class="muted small">${manage ? 'Tick the positions each person can serve in.' : ''}</span>` : ''}</div>
      ${roster.length ? html`<div class="table-wrap"><table class="roster">
        <thead><tr><th>Person</th>${t.positions.map((p) => html`<th>${p.name}</th>`)}${staff ? html`<th>Leader</th>` : ''}${manage ? html`<th></th>` : ''}</tr></thead>
        <tbody>${roster.map((m) => html`<tr data-person="${m.person_id}">
          <td><a class="person-cell" href="#/people/${m.person_id}" style="color:inherit">${avatar(m)}<span><b>${displayName(m)}</b>${m.is_leader ? html` <span class="pill info">Leader</span>` : ''}</span></a></td>
          ${t.positions.map((p) => html`<td><button type="button" class="tick ${m.positions.has(p.id) ? 'on' : ''}" data-toggle="${p.id}" ${manage ? '' : 'disabled'}
            aria-label="${displayName(m)} serves as ${p.name}" aria-pressed="${m.positions.has(p.id)}">${icon('check')}</button></td>`)}
          ${staff ? html`<td><button type="button" class="tick ${m.is_leader ? 'on' : ''}" data-leader aria-label="${displayName(m)} is a leader" aria-pressed="${Boolean(m.is_leader)}">${icon('check')}</button></td>` : ''}
          ${manage ? html`<td><button class="icon-btn" data-remove title="Remove from team">${icon('x')}</button></td>` : ''}
        </tr>`)}</tbody></table></div>`
        : html`<div class="empty">No one on this team yet.${manage ? html` <button class="btn small" data-add-people>${icon('plus')} Add people</button>` : ''}</div>`}
    </div>`);

  const reload = () => team(el, id);
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

  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-add-people]')?.addEventListener('click', addPeople);
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
  const chipBox = el.querySelector('[data-positions]');
  const addPos = async () => {
    const input = chipBox.querySelector('[data-new-pos]');
    const name = input.value.trim();
    if (!name) return;
    try { await post(`/teams/${t.id}/positions`, { name }); reload(); } catch (e) { fail(e); }
  };
  chipBox.querySelector('[data-new-pos]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPos(); } });
  chipBox.querySelector('[data-add-pos]')?.addEventListener('click', addPos);
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
