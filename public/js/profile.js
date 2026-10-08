// A person's custom profile fields (milestones, classes, leadership track…), one card per section.
import { get, put, html, mount, icon, dialog, toast, fail, fmtDate } from './lib.js';

export function bySection(fields) {
  const map = new Map();
  for (const f of fields) map.set(f.section, [...(map.get(f.section) || []), f]);
  return [...map];
}

export function showValue(f, v) {
  if (v === undefined || v === null) return html`<span class="muted">—</span>`;
  switch (f.type) {
    case 'date': return fmtDate(v, { month: 'long', day: 'numeric', year: 'numeric' });
    case 'yesno': return v ? html`<span class="pill good">${icon('check')} Yes</span>` : html`<span class="pill">No</span>`;
    case 'multi': return html`${v.map((x) => html`<span class="pill info">${x}</span> `)}`;
    case 'choice': {
      // Choices read as steps (e.g. New birth: Repented → Baptized → Holy Ghost).
      const at = f.options.indexOf(v);
      return html`<span class="steps">${f.options.map((o, i) => html`<span class="step ${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${o}</span>`)}</span>`;
    }
    case 'longtext': return html`<span style="white-space:pre-wrap">${v}</span>`;
    default: return String(v);
  }
}

function input(f, v) {
  const name = `f${f.id}`;
  switch (f.type) {
    case 'date': return html`<input type="date" name="${name}" value="${v || ''}">`;
    case 'number': return html`<input type="number" name="${name}" value="${v ?? ''}" step="any">`;
    case 'yesno': return html`<select name="${name}"><option value="">—</option><option value="yes" ${v === true ? 'selected' : ''}>Yes</option><option value="no" ${v === false ? 'selected' : ''}>No</option></select>`;
    case 'choice': return html`<select name="${name}"><option value="">—</option>${f.options.map((o) => html`<option ${o === v ? 'selected' : ''}>${o}</option>`)}</select>`;
    case 'multi': return html`<div class="row">${f.options.map((o) => html`<label class="check"><input type="checkbox" name="${name}" value="${o}" ${(v || []).includes(o) ? 'checked' : ''}> ${o}</label>`)}</div>`;
    case 'longtext': return html`<textarea name="${name}" rows="4">${v || ''}</textarea>`;
    default: return html`<input type="text" name="${name}" value="${v || ''}">`;
  }
}

function read(form, f) {
  const name = `f${f.id}`;
  if (f.type === 'multi') return [...form.querySelectorAll(`[name="${name}"]:checked`)].map((c) => c.value);
  const v = form.elements[name]?.value ?? '';
  if (f.type === 'yesno') return v === '' ? null : v === 'yes';
  return v;
}

export async function drawProfile(el, personId) {
  let data;
  try {
    data = await get(`/people/${personId}/profile`);
  } catch (e) {
    if (e.status === 403) return mount(el, '');
    throw e;
  }
  const { fields, values, can_edit: canEdit } = data;
  if (!fields.length) return mount(el, '');
  mount(el, html`${bySection(fields).map(([section, list]) => html`<div class="card">
    <div class="card-head"><h2>${section}</h2>${canEdit ? html`<button class="btn small" data-edit-section="${section}">${icon('edit')} Edit</button>` : ''}</div>
    <dl class="facts">${list.map((f) => html`<dt>${f.label}</dt><dd>${showValue(f, values[f.id])}</dd>`)}</dl>
  </div>`)}`);
  el.onclick = async (e) => {
    const b = e.target.closest('[data-edit-section]');
    if (!b) return;
    const list = fields.filter((f) => f.section === b.dataset.editSection);
    const ok = await dialog({
      title: b.dataset.editSection, submit: 'Save', wide: list.some((f) => f.type === 'multi' || f.type === 'longtext'),
      body: html`<div class="stack">${list.map((f) => html`<label class="field">${f.label}${input(f, values[f.id])}</label>`)}</div>`,
      onSubmit: (form) => put(`/people/${personId}/profile`, { values: Object.fromEntries(list.map((f) => [f.id, read(form, f)])) }),
    });
    if (ok) {
      toast('Saved.');
      drawProfile(el, personId).catch(fail);
    }
  };
}
