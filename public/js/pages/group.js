// One small group: its roster and a link to its chat. Staff and the group's leaders add and
// remove people; only staff make someone a leader or change the group itself.
import { get, post, patch, put, del, html, mount, icon, avatar, displayName, dialog, formData, toast, fail, confirm, debounce, options } from '../lib.js';
import { state, setTitle, campusName, visibleCampuses } from '../app.js';

export default async function group(el, id) {
  const g = await get(`/groups/${id}`);
  setTitle(g.name, html`${g.chat_id ? html`<a class="btn" href="#/chat/${g.chat_id}">${icon('chat')} Group chat</a>` : ''}
    ${g.can_staff ? html`<button class="btn" data-edit>${icon('edit')} Edit group</button>` : ''}`);
  const inGroup = new Set(g.roster.map((m) => m.person_id));

  mount(el, html`
    <div class="muted" style="margin:-6px 0 14px">${g.campus_id ? campusName(g.campus_id) : 'All campuses'} · ${g.roster.length} ${g.roster.length === 1 ? 'person' : 'people'}${g.archived ? ' · Archived' : ''}${g.description ? html` · ${g.description}` : ''}</div>
    <div class="card">
      <h2>People</h2>
      ${g.can_manage ? html`<div class="add-member" data-add-member><span class="add-member-icon">${icon('plus')}</span>
        <input type="search" placeholder="Add someone: type a name" data-q autocomplete="off" aria-label="Add someone to the group">
        <div class="suggest hidden" data-list></div></div>` : ''}
      ${g.roster.length ? html`<div class="m-people">${g.roster.map((m) => html`<div class="row" style="padding:8px 0;border-top:1px solid var(--line)" data-person="${m.person_id}">
        ${avatar(m)}<span class="grow"><b>${displayName(m)}</b>${m.is_leader ? html` <span class="pill info">Leader</span>` : ''}
          ${g.can_manage && (m.email || m.phone) ? html`<br><span class="muted small">${[m.email, m.phone].filter(Boolean).join(' · ')}</span>` : ''}</span>
        ${g.can_staff ? html`<button type="button" class="btn small ghost" data-leader="${m.is_leader ? 0 : 1}">${m.is_leader ? 'Remove as leader' : 'Make leader'}</button>` : ''}
        ${g.can_manage && (g.can_staff || !m.is_leader) ? html`<button type="button" class="icon-btn" data-remove title="Remove from group" aria-label="Remove ${displayName(m)}">${icon('x')}</button>` : ''}
      </div>`)}</div>` : html`<div class="empty">No one in this group yet.${g.can_manage ? ' Type a name above to add someone.' : ''}</div>`}
    </div>
    ${g.can_manage ? '' : html`<p class="muted small">Only the group’s leaders and the church office can see phone numbers and emails.</p>`}`);

  const reload = () => group(el, id);
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    const row = e.target.closest('[data-person]');
    if (!b || !row) return;
    const pid = Number(row.dataset.person);
    const m = g.roster.find((x) => x.person_id === pid);
    try {
      if (b.matches('[data-leader]')) { await put(`/groups/${g.id}/members/${pid}`, { is_leader: b.dataset.leader === '1' }); return reload(); }
      if (b.matches('[data-remove]')) {
        if (!(await confirm(`Remove ${displayName(m)}?`, 'They’ll leave the group chat too.', 'Remove'))) return;
        await del(`/groups/${g.id}/members/${pid}`);
        reload();
      }
    } catch (err) { fail(err); }
  };

  // Type a name, pick, done. The server only offers adults at your campuses.
  const box = el.querySelector('[data-add-member]');
  if (box) {
    const q = box.querySelector('[data-q]');
    const list = box.querySelector('[data-list]');
    let rows = [];
    const hide = () => list.classList.add('hidden');
    const search = debounce(async () => {
      const v = q.value.trim();
      if (v.length < 2) return hide();
      rows = (await get(`/groups/${g.id}/candidates?q=${encodeURIComponent(v)}`)).filter((p) => !inGroup.has(p.id));
      mount(list, rows.length ? rows.map((p, i) => html`<button type="button" data-pick="${i}">${avatar(p)}<span><b>${displayName(p)}</b></span></button>`)
        : html`<div class="muted small" style="padding:8px 10px">No one found. Add them in People first.</div>`);
      list.classList.remove('hidden');
    }, 200);
    q.addEventListener('input', search);
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', async (e) => {
      const p = rows[Number(e.target.closest('[data-pick]')?.dataset.pick)];
      if (!p) return;
      try { await put(`/groups/${g.id}/members/${p.id}`, {}); toast(`${displayName(p)} added.`); reload(); } catch (err) { fail(err); }
    });
    q.addEventListener('blur', () => setTimeout(hide, 150));
  }

  document.querySelector('[data-edit]')?.addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Edit group',
      body: html`<div class="form"><label class="field wide">Name<input type="text" name="name" value="${g.name}" required maxlength="80"></label>
        <label class="field wide">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), g.campus_id, state.me.campusIds ? {} : { blank: 'All campuses (church-wide)' })}</select></label>
        <label class="field wide">About<textarea name="description">${g.description}</textarea></label>
        <label class="check wide"><input type="checkbox" name="archived" ${g.archived ? 'checked' : ''}> Archive this group (hides it and its chat; people stay on the roster)</label></div>`,
      onSubmit: (f) => patch(`/groups/${g.id}`, formData(f)),
    });
    if (ok) reload();
  });
}
