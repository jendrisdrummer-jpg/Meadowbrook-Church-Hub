// Small groups: staff see every group at their campuses and make new ones; everyone else sees
// the groups they're in.
import { get, post, html, mount, icon, dialog, formData, options, toast, displayName } from '../lib.js';
import { state, setTitle, go, campusName, visibleCampuses, can } from '../app.js';

export default async function groups(el) {
  const staff = can('staff');
  const showArchived = staff && location.hash.includes('archived=1');
  setTitle('Groups', staff ? html`<button class="btn primary" data-add>${icon('plus')} New group</button>` : '');
  const d = await get(`/groups${showArchived ? '?archived=1' : ''}`);
  const list = d.groups.filter((g) => !state.campusId || g.campus_id == null || g.campus_id === state.campusId);
  mount(el, html`${staff ? html`<div class="row" style="margin-bottom:12px"><a class="btn small ${showArchived ? 'ghost' : ''}" href="#/groups">Active</a>
      <a class="btn small ${showArchived ? '' : 'ghost'}" href="#/groups?archived=1">Archived</a></div>` : ''}
    ${list.length ? html`<div class="grid three">${list.map((g) => html`<a class="card" href="#/groups/${g.id}" style="color:inherit;text-decoration:none">
      <h2>${g.name}</h2>
      <div class="muted small">${g.campus_id ? campusName(g.campus_id) : 'All campuses'} · ${g.members} ${g.members === 1 ? 'person' : 'people'}</div>
      ${g.description ? html`<p class="small" style="margin:8px 0 0">${g.description}</p>` : ''}
      ${g.leaders.length ? html`<div class="row small" style="margin-top:10px">${g.leaders.map((l) => html`<span class="pill info">${displayName(l)}</span>`)}</div>` : ''}
    </a>`)}</div>`
      : html`<div class="card empty">${showArchived ? 'No archived groups.' : staff
        ? 'No groups yet. Groups are for Bible studies, home groups and the like. Each one gets its own chat.'
        : 'You’re not in a group yet. When someone adds you to one, it will show up here.'}</div>`}`);

  document.querySelector('[data-add]')?.addEventListener('click', async () => {
    let created;
    await dialog({
      title: 'New group',
      body: html`<div class="form">
        <label class="field wide">Group name<input type="text" name="name" required maxlength="80" placeholder="Tuesday Bible study"></label>
        <label class="field wide">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), state.campusId, state.me.campusIds ? {} : { blank: 'All campuses (church-wide)' })}</select></label>
        <label class="field wide">About<textarea name="description" placeholder="When and where it meets, who it’s for"></textarea></label>
      </div>`,
      onSubmit: async (f) => { created = await post('/groups', formData(f)); },
    });
    if (created) { toast('Group created. Add a leader and members next.'); go(`/groups/${created.id}`); }
  });
}
