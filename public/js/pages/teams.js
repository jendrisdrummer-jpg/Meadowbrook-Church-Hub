// All ministry teams.
import { get, post, html, mount, icon, dialog, formData, options, toast, chips } from '../lib.js';
import { state, can, setTitle, go, campusName, visibleCampuses } from '../app.js';

export default async function teams(el) {
  setTitle('Teams', can('staff') ? html`<button class="btn primary" data-add>${icon('plus')} New team</button>` : '');
  const list = (await get('/teams')).filter((t) => !state.campusId || t.campus_id == null || t.campus_id === state.campusId);
  mount(el, list.length ? html`<div class="grid three">${list.map((t) => html`<a class="card" href="#/teams/${t.id}" style="color:inherit;text-decoration:none;border-top:4px solid ${t.color}">
      <h2>${t.name}</h2>
      <div class="muted small">${t.campus_id ? campusName(t.campus_id) : 'All campuses'} · ${t.members} ${t.members === 1 ? 'person' : 'people'}</div>
      <div class="row small" style="margin-top:10px">${t.positions.map((p) => html`<span class="pill">${p.name}</span>`)}</div>
    </a>`)}</div>`
    : html`<div class="card empty">No teams yet. Teams are groups like Worship, Production, Kids or Hospitality, each with the positions people serve in.</div>`);

  document.querySelector('[data-add]')?.addEventListener('click', async () => {
    let created;
    let positions = [];
    await dialog({
      title: 'New team',
      body: html`<div class="form">
        <label class="field wide">Team name<input type="text" name="name" required placeholder="Worship"></label>
        <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), state.campusId, state.me.campusIds ? {} : { blank: 'All campuses (church-wide)' })}</select></label>
        <label class="field">Colour<input type="color" name="color" value="#4f6bed" style="height:38px;width:100%"></label>
        <div class="field wide"><span>Positions</span><div data-chips></div>
          <span class="muted small">For example Worship Leader, Vocals, Drums. You can add more later.</span></div>
      </div>`,
      onOpen: (d) => chips(d.querySelector('[data-chips]'), [], (list) => { positions = list; }, { placeholder: 'Position name', addLabel: 'Add' }),
      onSubmit: async (f) => {
        const b = formData(f);
        // Include a position typed but not yet added.
        const pending = f.querySelector('[data-new]')?.value.trim();
        created = await post('/teams', { ...b, positions: pending && !positions.includes(pending) ? [...positions, pending] : positions });
      },
    });
    if (created) { toast('Team created.'); go(`/teams/${created.id}`); }
  });
}
