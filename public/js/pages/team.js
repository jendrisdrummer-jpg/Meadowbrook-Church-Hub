// One team: its positions and members (and which positions each person can serve in).
import { get, post, patch, put, del, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, confirm, pickPerson } from '../lib.js';
import { can, setTitle, campusName } from '../app.js';

export default async function team(el, id) {
  const t = await get(`/teams/${id}`);
  const manage = t.can_manage;
  setTitle(t.name, manage ? html`<button class="btn" data-edit>${icon('edit')} Edit</button><button class="btn primary" data-add-member>${icon('plus')} Add member</button>` : '');

  const byPerson = new Map();
  for (const m of t.members) {
    const cur = byPerson.get(m.person_id) || { ...m, positions: [] };
    if (m.position_id) cur.positions.push(m.position_id);
    cur.is_leader = cur.is_leader || m.is_leader;
    byPerson.set(m.person_id, cur);
  }
  const members = [...byPerson.values()];
  const posName = (pid) => t.positions.find((p) => p.id === pid)?.name;

  mount(el, html`<div class="grid two">
    <div class="card">
      <div class="card-head"><h2>Members (${members.length})</h2></div>
      ${members.length ? html`<table class="list"><tbody>${members.map((m) => html`<tr>
        <td><a class="person-cell" href="#/people/${m.person_id}" style="color:inherit">${avatar(m)}<span><b>${displayName(m)}</b>${m.is_leader ? html` <span class="pill info">Leader</span>` : ''}</span></a></td>
        <td class="small">${m.positions.map(posName).filter(Boolean).join(', ') || html`<span class="muted">No position</span>`}</td>
        <td style="text-align:right" class="nowrap">${manage ? html`<button class="icon-btn" data-member="${m.person_id}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn" data-remove="${m.person_id}" title="Remove from team">${icon('x')}</button>` : ''}</td></tr>`)}</tbody></table>`
        : html`<div class="empty">No one on this team yet.</div>`}
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><h2>Positions</h2>${manage ? html`<button class="btn small" data-add-position>${icon('plus')} Add</button>` : ''}</div>
        ${t.positions.length ? t.positions.map((p) => html`<div class="row" style="padding:5px 0"><span>${p.name}</span><span class="muted small">${t.members.filter((m) => m.position_id === p.id).length} people</span><span class="spacer"></span>
          ${manage ? html`<button class="icon-btn" data-rename="${p.id}" title="Rename">${icon('edit')}</button><button class="icon-btn" data-del-position="${p.id}" title="Delete">${icon('trash')}</button>` : ''}</div>`)
          : html`<p class="muted">Add the positions people serve in, like “Drums” or “Camera 1”.</p>`}
      </div>
      <div class="card"><h2>About</h2><p class="muted small">${t.campus_id ? campusName(t.campus_id) : 'All campuses'}</p><p style="white-space:pre-wrap">${t.description || ''}</p></div>
    </div>
  </div>`);

  const reload = () => team(el, id);

  async function editMember(person, current = { positions: [], is_leader: 0 }) {
    const ok = await dialog({
      title: displayName(person),
      body: html`<p class="muted small">Which positions can ${person.nickname || person.first_name} serve in?</p>
        <div class="stack">${t.positions.map((p) => html`<label class="check"><input type="checkbox" name="pos" value="${p.id}" ${current.positions.includes(p.id) ? 'checked' : ''}> ${p.name}</label>`)}</div>
        ${can('staff') ? html`<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><label class="check"><input type="checkbox" name="is_leader" ${current.is_leader ? 'checked' : ''}> Team leader (can schedule this team)</label>` : ''}`,
      onSubmit: (f) => put(`/teams/${t.id}/members/${person.id ?? person.person_id}`, {
        position_ids: [...f.querySelectorAll('[name=pos]:checked')].map((c) => Number(c.value)),
        is_leader: f.is_leader?.checked ?? Boolean(current.is_leader),
      }),
    });
    if (ok) reload();
  }

  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-add-member]')?.addEventListener('click', async () => {
    const person = await pickPerson(`Add to ${t.name}`);
    if (person) editMember(person);
  });
  top.querySelector('[data-edit]')?.addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Edit team',
      body: html`<div class="form"><label class="field wide">Name<input type="text" name="name" value="${t.name}" required></label>
        <label class="field">Colour<input type="color" name="color" value="${t.color}" style="height:38px;width:100%"></label>
        <label class="field wide">Description<textarea name="description">${t.description}</textarea></label>
        ${can('staff') ? html`<label class="check wide"><input type="checkbox" name="archived"> Archive this team</label>` : ''}</div>`,
      onSubmit: (f) => patch(`/teams/${t.id}`, formData(f)),
    });
    if (ok) reload();
  });

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.member) {
        const m = byPerson.get(Number(b.dataset.member));
        editMember({ ...m, id: m.person_id }, m);
      }
      if (b.dataset.remove && await confirm('Remove from team?', 'They’ll stay in the directory and keep any services they’re already scheduled for.', 'Remove')) {
        await del(`/teams/${t.id}/members/${b.dataset.remove}`); reload();
      }
      if (b.matches('[data-add-position]')) {
        const ok = await dialog({ title: 'New position', body: html`<label class="field">Name<input type="text" name="name" required></label>`, onSubmit: (f) => post(`/teams/${t.id}/positions`, formData(f)) });
        if (ok) reload();
      }
      if (b.dataset.rename) {
        const p = t.positions.find((x) => x.id === Number(b.dataset.rename));
        const ok = await dialog({ title: 'Rename position', body: html`<label class="field">Name<input type="text" name="name" value="${p.name}" required></label>`, onSubmit: (f) => patch(`/positions/${p.id}`, formData(f)) });
        if (ok) reload();
      }
      if (b.dataset.delPosition && await confirm('Delete position?', 'People will no longer be listed for it.')) {
        await del(`/positions/${b.dataset.delPosition}`); toast('Deleted.'); reload();
      }
    } catch (err) { fail(err); }
  };
}
