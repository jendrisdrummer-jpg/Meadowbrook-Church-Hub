// Edit one service template: its rows (with "fill in each week" slots) and the positions it needs.
import { get, patch, put, html, mount, icon, dialog, formData, options, toast, fail, confirm } from '../lib.js';
import { state, setTitle, go, campusName, visibleCampuses } from '../app.js';
import { drawPlan } from '../plan.js';
import { needsPicker } from '../service-forms.js';

export default async function template(el, id) {
  const t = await get(`/templates/${id}`);
  const edit = t.can_edit;
  setTitle(t.name, edit ? html`<button class="btn" data-edit>${icon('edit')} Details</button>` : '');

  mount(el, html`
    <div class="row muted" style="margin:-6px 0 12px">${t.campus_id ? campusName(t.campus_id) : 'All campuses'}${t.description ? html` · ${t.description}` : ''}
      ${t.series.length ? html` · Fills ${t.series.map((x) => x.default_title || x.name).join(', ')}` : ''}</div>
    <div data-plan></div>
    <div class="card"><div class="card-head"><h2>Positions needed</h2>${edit ? html`<button class="btn small" data-needs>${icon('edit')} Change</button>` : ''}</div>
      <div data-needs-view></div></div>`);

  // The plan editor shows times from the template's usual start time.
  const asService = { ...t, starts_at: `2000-01-01T${t.start_time}`, positions: [], can_edit_plan: edit, locked: false, campus: { name: '' } };
  drawPlan(el.querySelector('[data-plan]'), asService, { mode: 'template' });

  const teams = await get('/teams');
  const posName = Object.fromEntries(teams.flatMap((tm) => tm.positions.map((p) => [p.id, `${tm.name} · ${p.name}`])));
  const drawNeeds = () => mount(el.querySelector('[data-needs-view]'), t.needs.length
    ? html`<div class="row">${t.needs.map((n) => html`<span class="pill">${posName[n.position_id] || 'Position'}${n.count > 1 ? ` ×${n.count}` : ''}</span>`)}</div>`
    : html`<p class="muted small">None. Services from this template keep their repeating service’s positions.</p>`);
  drawNeeds();

  el.querySelector('[data-needs]')?.addEventListener('click', async () => {
    let picker;
    const ok = await dialog({
      title: 'Positions needed', wide: true, submit: 'Save',
      body: html`<div data-picker></div>`,
      onOpen: async (d) => { picker = await needsPicker(d.querySelector('[data-picker]'), t.campus_id ?? state.campusId ?? visibleCampuses()[0]?.id, t.needs); },
      onSubmit: async () => { t.needs = picker.get(); await put(`/templates/${t.id}/needs`, { needs: t.needs }); },
    });
    if (ok) drawNeeds();
  });

  document.querySelector('[data-actions] [data-edit]')?.addEventListener('click', async () => {
    const r = await dialog({
      title: 'Template details', submit: 'Save',
      body: html`<div class="form">
        <label class="field wide">Name<input type="text" name="name" value="${t.name}" required></label>
        <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), t.campus_id, state.me.campusIds ? {} : { blank: 'All campuses' })}</select></label>
        <label class="field">Usual start time<input type="time" name="start_time" value="${t.start_time}"><span class="muted small">Only for showing times here.</span></label>
        <label class="field wide">Description<input type="text" name="description" value="${t.description}"></label>
      </div>
      <button type="button" class="btn danger small" data-archive style="margin-top:12px">${icon('trash')} Delete template</button>`,
      onOpen: (d, close) => {
        d.querySelector('[data-archive]').onclick = async () => {
          if (!(await confirm('Delete this template?', 'Services already made from it keep their plans. Repeating services stop using it.'))) return;
          await patch(`/templates/${t.id}`, { archived: true });
          close('deleted');
        };
      },
      onSubmit: (f) => patch(`/templates/${t.id}`, formData(f)),
    });
    if (r === 'deleted') { toast('Template deleted.'); go('/templates'); } else if (r) template(el, id).catch(fail);
  });
}
