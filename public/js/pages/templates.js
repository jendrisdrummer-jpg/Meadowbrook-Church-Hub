// Service templates library.
import { get, post, html, mount, icon, dialog, formData, options, toast } from '../lib.js';
import { state, can, setTitle, go, visibleCampuses } from '../app.js';

export default async function templates(el) {
  setTitle('Templates', can('staff') ? html`<button class="btn primary" data-add>${icon('plus')} New template</button>` : '');
  const list = (await get('/templates')).filter((t) => !state.campusId || t.campus_id == null || t.campus_id === state.campusId);
  mount(el, html`<p class="muted" style="margin-top:-6px">Reusable orders of service. Start a service from one, or link one to a repeating service so every new Sunday arrives already laid out.
      Rows marked <span class="pill warn">Fill in each week</span> show as “Needs filling” until someone completes them.</p>
    ${list.length ? html`<div class="grid three">${list.map((t) => html`<a class="card" href="#/templates/${t.id}" style="color:inherit;text-decoration:none">
      <h2>${t.name}</h2>
      <div class="muted small">${t.campus_id ? t.campus_short || t.campus_name : 'All campuses'} · ${t.item_count} ${t.item_count === 1 ? 'row' : 'rows'}${t.needs_count ? ` · ${t.needs_count} positions` : ''}</div>
      ${t.description ? html`<p class="small" style="margin:8px 0 0">${t.description}</p>` : ''}
      <div class="row small" style="margin-top:10px">${t.fill_count ? html`<span class="pill warn">${t.fill_count} to fill in</span>` : ''}
        ${t.series_count ? html`<span class="pill info">${icon('calendar', 'ic small-ic')} Used by ${t.series_count} repeating ${t.series_count === 1 ? 'service' : 'services'}</span>` : ''}</div>
    </a>`)}</div>`
    : html`<div class="card empty">No templates yet.${can('staff') ? html` Create one here, or open a finished service and choose <b>Save as template</b>.` : ''}</div>`}`);

  document.querySelector('[data-add]')?.addEventListener('click', async () => {
    let made;
    await dialog({
      title: 'New template',
      body: html`<div class="form">
        <label class="field wide">Name<input type="text" name="name" required placeholder="Sunday Morning"></label>
        <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), state.campusId, state.me.campusIds ? {} : { blank: 'All campuses' })}</select></label>
        <label class="field wide">Description (optional)<input type="text" name="description" placeholder="Our regular Sunday service"></label></div>`,
      onSubmit: async (f) => { made = await post('/templates', formData(f)); },
    });
    if (made) { toast('Template created. Add its rows.'); go(`/templates/${made.id}`); }
  });
}
