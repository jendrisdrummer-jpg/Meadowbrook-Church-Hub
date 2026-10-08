// The order of service: a table of what happens when (minutes, time frame, type, name and details,
// who's leading). Rows drag to reorder; edit and delete appear on the right of each row; a row at
// the bottom adds items inline, with a searchable song picker.
import { get, post, patch, put, del, html, raw, mount, icon, displayName, dialog, formData, options, toast, toastAction, fail, fmtDate, fmtTime, fmtLength, parseLength, addDays } from './lib.js';

export const TYPES = ['Announcement', 'Song', 'Offering', 'Prayer', 'Message', 'Video', 'Other'];

const clock = (minutesFromMidnight) => {
  const m = ((Math.round(minutesFromMidnight) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};
const minutesLabel = (sec) => (sec % 60 ? fmtLength(sec) : String(sec / 60));

// Start and end (minutes after midnight) of every row. Rows above the "service starts here"
// section count backwards so they finish as the service starts.
export function timeline(items, startsAt) {
  const [h, m] = startsAt.slice(11, 16).split(':').map(Number);
  const start = h * 60 + m;
  const k = items.findIndex((i) => i.is_start);
  const before = k > 0 ? items.slice(0, k).reduce((a, i) => a + i.length_sec, 0) / 60 : 0;
  let t = start - before;
  return items.map((i) => {
    const from = t;
    t += i.length_sec / 60;
    return { from, to: t };
  });
}

let songCache = null;
const songs = async (fresh = false) => (songCache && !fresh ? songCache : (songCache = await get('/songs')));

// opts.mode: 'service' (default) or 'template'. Templates use their own endpoints, have no
// schedule, and can add "fill in each week" slots.
export function drawPlan(panel, s, opts = {}) {
  const mode = opts.mode || 'service';
  const api = mode === 'template'
    ? { base: `/templates/${s.id}`, item: (id) => `/template-items/${id}` }
    : { base: `/services/${s.id}`, item: (id) => `/items/${id}` };
  const items = s.items;
  const edit = s.can_edit_plan;
  const toFill = items.filter((i) => i.placeholder).length;
  const times = timeline(items, s.starts_at);
  const total = items.reduce((a, i) => a + i.length_sec, 0);
  const people = [...new Map(s.positions.flatMap((p) => p.assignments).map((a) => [a.person_id, a])).values()];

  mount(panel, html`<div class="card plan-card">
    <div class="card-head"><h2>Order of service</h2>
      ${total ? html`<span class="muted small">${clock(times[0].from)} – ${clock(times.at(-1).to)} · ${Math.round(total / 60)} min</span>` : ''}
      ${s.locked ? html`<span class="pill warn">${icon('lock', 'ic small-ic')} Locked</span>` : ''}
      ${toFill && mode === 'service' ? html`<span class="pill warn">${toFill} to fill in</span>` : ''}
      ${edit && mode === 'service' ? html`<button class="btn small" data-apply>${icon('copy')} Use a template</button><button class="btn small ghost" data-copy>Copy from…</button>` : ''}
      ${mode === 'service' && opts.canSaveTemplate ? html`<button class="btn small ghost" data-save-template>Save as template</button>` : ''}
      ${mode === 'service' ? html`<button class="btn small ghost" data-print title="Print">${icon('printer')}</button>` : ''}</div>
    <div class="plan2" data-plan>
      <div class="plan2-head"><span></span><span>Min</span><span>Time frame</span><span>Type</span><span>Name</span><span>Led by</span><span></span></div>
      ${items.map((i, n) => i.kind === 'header'
        ? html`<div class="plan2-row section ${i.is_start ? 'start' : ''}" data-item="${i.id}" ${edit ? raw('draggable="true"') : ''}>
            <span class="grip">${edit ? icon('grip') : ''}</span>
            <span class="sec-title">${i.title || 'Section'}${i.is_start ? html` <span class="pill info">Service starts · ${clock(times[n].from)}</span>` : ''}</span>
            ${actions(i)}</div>`
        : html`<div class="plan2-row ${i.placeholder ? 'fill' : ''}" data-item="${i.id}" ${edit ? raw('draggable="true"') : ''}>
            <span class="grip">${edit ? icon('grip') : ''}</span>
            <span class="num">${i.length_sec ? minutesLabel(i.length_sec) : ''}</span>
            <span class="num nowrap muted">${i.length_sec ? `${clock(times[n].from)} – ${clock(times[n].to)}` : clock(times[n].from)}</span>
            <span class="type">${i.category || (i.kind === 'song' ? 'Song' : '')}</span>
            <span class="name"><b>${i.title || 'Item'}</b>${i.placeholder ? html` <span class="pill warn">${mode === 'template' ? 'Fill in each week' : 'Needs filling'}</span>` : ''}${i.kind === 'song' && i.song_key ? html` <span class="pill">${i.song_key}</span>` : ''}
              ${i.kind === 'song' && i.song_author ? html`<span class="muted small"> · ${i.song_author}</span>` : ''}
              ${i.notes ? html`<div class="details">${i.notes}</div>` : ''}</span>
            <span class="lead">${[i.first_name ? displayName(i) : '', i.info].filter(Boolean).join(', ')}</span>
            ${actions(i)}</div>`)}
      ${!items.length ? html`<div class="empty">No order of service yet.${edit ? ' Add the first item below, or copy one from another service.' : ''}</div>` : ''}
    </div>
    ${edit ? html`<form class="plan2-add" data-add autocomplete="off">
      <select name="kind" aria-label="Type">${options([{ value: 'header', label: 'Section' }, ...TYPES.map((t) => ({ value: t, label: t }))], 'Announcement')}</select>
      <span class="add-title"><input type="text" name="title" placeholder="Add an item, e.g. Welcome" aria-label="Name"><div class="suggest hidden" data-suggest></div></span>
      <input type="text" name="length" placeholder="Min" inputmode="numeric" aria-label="Minutes" class="add-min">
      <button class="btn primary small">${icon('plus')} Add</button>
      ${mode === 'template' ? html`<label class="check small add-fill"><input type="checkbox" name="placeholder"> Fill in each week (e.g. speaker, songs, announcements)</label>` : ''}
    </form>` : ''}
  </div>`);

  function actions(i) {
    return edit ? html`<span class="row-actions"><button class="icon-btn" data-edit-item="${i.id}" title="Edit">${icon('edit')}</button>
      <button class="icon-btn danger" data-del-item="${i.id}" title="Remove">${icon('trash')}</button></span>` : html`<span></span>`;
  }

  const save = (list) => { s.items = list; drawPlan(panel, s, opts); };

  panel.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-print]')) return printPlan(s);
      if (b.dataset.editItem) {
        const list = await itemDialog(s, items.find((i) => i.id === Number(b.dataset.editItem)), people, api, mode);
        if (list) save(list);
      }
      if (b.dataset.delItem) {
        const item = items.find((i) => i.id === Number(b.dataset.delItem));
        const at = items.indexOf(item);
        save(await del(api.item(item.id)));
        toastAction(`Removed “${item.title || 'item'}”.`, 'Undo', async () => {
          try {
            const restored = await post(`${api.base}/items`, pick(item));
            const ids = restored.map((x) => x.id);
            const newId = ids.at(-1);
            ids.pop();
            ids.splice(at, 0, newId);
            save(await put(`${api.base}/items/order`, { ids }));
          } catch (err) { fail(err); }
        });
      }
      if (b.matches('[data-copy]')) await copyFrom(s, save);
      if (b.matches('[data-apply]')) await applyTemplateDialog(s, save, opts);
      if (b.matches('[data-save-template]')) await saveAsTemplate(s);
    } catch (err) { fail(err); }
  };

  if (!edit) return;
  wireAdd(panel, s, save, api, mode);
  wireDrag(panel, s, save, api);
}

// Fields to recreate an item (for Undo).
const pick = (i) => ({ kind: i.kind, title: i.title, song_id: i.song_id, song_key: i.song_key, length_sec: i.length_sec, person_id: i.person_id, notes: i.notes, category: i.category, info: i.info, is_start: i.is_start, placeholder: i.placeholder });

function wireAdd(panel, s, save, api, mode) {
  const form = panel.querySelector('[data-add]');
  const title = form.title;
  const box = form.querySelector('[data-suggest]');
  let picked = null;
  let list = [];
  let active = 0;

  const isSong = () => form.kind.value === 'Song';
  form.kind.onchange = () => {
    title.placeholder = isSong() ? 'Search songs…' : form.kind.value === 'header' ? 'Section name, e.g. Worship' : 'Add an item, e.g. Welcome';
    form.length.classList.toggle('hidden', form.kind.value === 'header');
    picked = null;
    hide();
    title.focus();
  };
  const hide = () => box.classList.add('hidden');
  const drawSuggest = () => {
    const q = title.value.trim();
    mount(box, html`${list.map((so, n) => html`<button type="button" class="${n === active ? 'on' : ''}" data-song="${so.id}">
        <b>${so.title}</b> <span class="muted small">${[so.author, so.default_key].filter(Boolean).join(' · ')}</span></button>`)}
      ${q ? html`<button type="button" class="${active === list.length ? 'on' : ''}" data-create>${icon('plus')} Add “${q}” as a new song</button>` : ''}`);
    box.classList.toggle('hidden', !list.length && !q);
  };
  // A "fill in each week" song slot doesn't need a real song, so skip the suggestions.
  const slot = () => mode === 'template' && form.placeholder?.checked;
  form.placeholder?.addEventListener('change', () => { picked = null; hide(); title.focus(); });
  title.addEventListener('input', async () => {
    picked = null;
    if (!isSong() || slot()) return hide();
    const q = title.value.trim().toLowerCase();
    const all = await songs();
    list = q ? all.filter((so) => so.title.toLowerCase().includes(q) || so.author.toLowerCase().includes(q)).slice(0, 8) : all.slice(0, 8);
    active = 0;
    drawSuggest();
  });
  title.addEventListener('focus', () => { if (isSong()) title.dispatchEvent(new Event('input')); });
  title.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    const max = list.length + (title.value.trim() ? 1 : 0) - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(max, active + 1); drawSuggest(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); drawSuggest(); }
    if (e.key === 'Escape') hide();
    if (e.key === 'Enter') {
      e.preventDefault();
      const btn = box.querySelectorAll('button')[active];
      btn?.click();
    }
  });
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.create) {
      try {
        const so = await post('/songs', { title: title.value.trim() });
        await songs(true);
        picked = so;
      } catch (err) { return fail(err); }
    } else picked = list.find((so) => so.id === Number(b.dataset.song));
    title.value = picked.title;
    hide();
    form.length.focus();
  };
  title.addEventListener('blur', () => setTimeout(hide, 150));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const kind = form.kind.value;
    const body = kind === 'header' ? { kind: 'header', title: title.value.trim() }
      : kind === 'Song' ? { kind: 'song', category: 'Song', song_id: picked?.id }
        : { kind: 'item', category: kind, title: title.value.trim() };
    const fill = form.placeholder?.checked;
    // A template can hold an empty song slot ("Song") to fill in each week.
    if (kind === 'Song' && !picked && !(mode === 'template' && (fill || !title.value.trim()))) { toast('Pick a song from the list, or add it as a new song.'); title.focus(); return; }
    if (kind === 'Song' && !picked) { body.title = title.value.trim() || 'Song'; body.placeholder = true; }
    if (kind !== 'Song' && !body.title) { title.focus(); return; }
    if (kind !== 'header') body.length_sec = parseLength(form.length.value);
    if (fill) body.placeholder = true;
    try {
      save(await post(`${api.base}/items`, body));
      const again = panel.querySelector('[data-add]');
      again.kind.value = kind;
      again.kind.dispatchEvent(new Event('change'));
    } catch (err) { fail(err); }
  };
}

function wireDrag(panel, s, save, api) {
  const plan = panel.querySelector('[data-plan]');
  let dragging;
  plan.addEventListener('dragstart', (e) => { dragging = e.target.closest('.plan2-row'); dragging?.classList.add('dragging'); });
  plan.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('.plan2-row');
    if (!dragging || !over || over === dragging) return;
    const after = e.clientY > over.getBoundingClientRect().top + over.offsetHeight / 2;
    over[after ? 'after' : 'before'](dragging);
  });
  plan.addEventListener('dragend', async () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    try { save(await put(`${api.base}/items/order`, { ids: [...plan.querySelectorAll('.plan2-row')].map((c) => Number(c.dataset.item)) })); } catch (err) { fail(err); }
  });
}

async function copyFrom(s, save) {
  // Same day first (e.g. copy 9:00 to 11:00), then the last five weeks, newest first.
  const day = s.starts_at.slice(0, 10);
  const recent = await get(`/services?from=${addDays(day, -35)}&to=${addDays(day, 7)}`);
  const choices = recent.filter((x) => x.id !== s.id && x.starts_at.slice(0, 10) <= day)
    .sort((a, b) => (b.starts_at.slice(0, 10) === day) - (a.starts_at.slice(0, 10) === day) || b.starts_at.localeCompare(a.starts_at));
  if (!choices.length) { toast('No nearby services to copy from.'); return; }
  let list;
  await dialog({
    title: 'Copy order of service from', submit: 'Copy',
    body: html`<label class="field">Service<select name="from">${options(choices.map((c) => ({ value: c.id, label: `${fmtDate(c.starts_at)} ${fmtTime(c.starts_at)} · ${c.campus_short || c.campus_name}` })))}</select></label>
      ${s.items.length ? html`<label class="check" style="margin-top:10px"><input type="checkbox" name="replace" checked> Replace what’s here now</label>` : ''}`,
    onSubmit: async (f) => { list = await post(`/services/${s.id}/copy-plan`, { from_service_id: Number(f.from.value), replace: f.replace?.checked ?? false }); },
  });
  if (list) save(list);
}

async function itemDialog(s, item, people, api, mode) {
  const header = item.kind === 'header';
  const song = item.kind === 'song';
  const all = song ? await songs() : [];
  let result;
  await dialog({
    title: header ? 'Edit section' : song ? 'Edit song' : 'Edit item', submit: 'Save', wide: !header,
    body: header
      ? html`<div class="stack"><label class="field">Section name<input type="text" name="title" value="${item.title}" required></label>
          <label class="check"><input type="checkbox" name="is_start" ${item.is_start ? 'checked' : ''}> The service starts here
            <span class="muted small">(rows above count down to the start time, like a pre-service huddle)</span></label></div>`
      : html`<div class="form">
          ${song ? html`<label class="field wide">Song<select name="song_id">${options(all.map((x) => ({ value: x.id, label: `${x.title}${x.author ? ` · ${x.author}` : ''}` })), item.song_id, { blank: 'Choose a song…' })}</select></label>
            <label class="field">Key<input type="text" name="song_key" value="${item.song_key}" placeholder="G"></label>`
          : html`<label class="field">Type<select name="category">${options(TYPES.filter((t) => t !== 'Song').map((t) => ({ value: t, label: t })), item.category || 'Other')}</select></label>
            <label class="field">Name<input type="text" name="title" value="${item.title}" required></label>`}
          <label class="field">Minutes<input type="text" name="length" value="${item.length_sec ? minutesLabel(item.length_sec) : ''}" placeholder="5 or 4:30" inputmode="numeric"></label>
          <label class="field">Led by<select name="person_id">${options(people.map((p) => ({ value: p.person_id, label: displayName(p) })), item.person_id, { blank: '—' })}</select></label>
          <label class="field">Or type a name<input type="text" name="info" value="${item.info}" placeholder="Pastor Dallas"></label>
          <label class="field wide">Details<textarea name="notes" rows="5" placeholder="Cues, announcements, who walks out when…">${item.notes}</textarea></label>
          <label class="check wide"><input type="checkbox" name="placeholder" ${item.placeholder ? 'checked' : ''}> ${mode === 'template' ? 'Fill in each week' : 'Still needs filling in'}</label>
        </div>`,
    // In a service, filling the slot in (choosing the song, naming who leads…) unticks "still needs filling".
    onOpen: (d) => {
      const box = d.querySelector('[name=placeholder]');
      if (!box || mode !== 'service') return;
      d.querySelectorAll('[name=song_id], [name=title], [name=info], [name=person_id], [name=notes]').forEach((el) => el.addEventListener('change', () => { box.checked = false; }));
    },
    onSubmit: async (f) => {
      const b = formData(f);
      const body = header ? { title: b.title, is_start: b.is_start }
        : { ...b, length_sec: parseLength(b.length) };
      delete body.length;
      if (song && b.song_id) body.title = all.find((x) => x.id === Number(b.song_id))?.title;
      result = await patch(api.item(item.id), body);
    },
  });
  return result;
}

function printPlan(s) {
  const times = timeline(s.items, s.starts_at);
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print.', 'bad'); return; }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  w.document.write(`<!doctype html><title>Order of service</title><style>
    body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#111} h1{font-size:20px;margin:0} p{margin:2px 0 14px;color:#555}
    table{width:100%;border-collapse:collapse} td,th{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left}
    th{font-size:11px;text-transform:uppercase;color:#666} tr.sec td{background:#eee;font-weight:700} .d{color:#555;white-space:pre-wrap;font-style:italic}</style>
    <h1>${esc(s.title || 'Order of service')}</h1><p>${esc(fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(fmtTime(s.starts_at))} · ${esc(s.campus.name)}</p>
    <table><tr><th>Min</th><th>Time</th><th>Type</th><th>Name</th><th>Led by</th></tr>
    ${s.items.map((i, n) => (i.kind === 'header'
      ? `<tr class="sec"><td colspan="5">${esc(i.title)}</td></tr>`
      : `<tr><td>${i.length_sec ? minutesLabel(i.length_sec) : ''}</td><td>${clock(times[n].from)}${i.length_sec ? `–${clock(times[n].to)}` : ''}</td><td>${esc(i.category || (i.kind === 'song' ? 'Song' : ''))}</td>
         <td><b>${esc(i.title)}</b>${i.song_key ? ` (${esc(i.song_key)})` : ''}${i.notes ? `<div class="d">${esc(i.notes)}</div>` : ''}</td><td>${esc([i.first_name ? `${i.nickname || i.first_name} ${i.last_name}` : '', i.info].filter(Boolean).join(', '))}</td></tr>`)).join('')}
    </table><script>print()<\/script>`);
  w.document.close();
}

async function applyTemplateDialog(s, save, opts) {
  const templates = (await get('/templates')).filter((t) => t.campus_id == null || t.campus_id === s.campus_id);
  if (!templates.length) { toast(opts.canSaveTemplate ? 'No templates yet. Make one under Planning → Templates, or Save as template.' : 'No templates yet.'); return; }
  let list;
  await dialog({
    title: 'Use a template', submit: 'Use template',
    body: html`<div class="stack"><label class="field">Template<select name="t">${options(templates.map((t) => ({ value: t.id, label: `${t.name}${t.fill_count ? ` (${t.fill_count} to fill in)` : ''}` })))}</select></label>
      ${s.items.length ? html`<label class="check"><input type="checkbox" name="replace" checked> Replace what’s here now</label>` : ''}
      ${opts.canSaveTemplate ? html`<label class="check"><input type="checkbox" name="needs" checked> Also use its positions needed</label>` : ''}</div>`,
    onSubmit: async (f) => {
      list = await post(`/services/${s.id}/apply-template`, { template_id: Number(f.t.value), replace: f.replace?.checked ?? false, needs: f.needs?.checked ?? false });
    },
  });
  if (list) {
    toast('Template added. Fill in the highlighted rows.');
    if (opts.onChange) opts.onChange(); else save(list);
  }
}

async function saveAsTemplate(s) {
  let made;
  await dialog({
    title: 'Save as template', submit: 'Save template',
    body: html`<div class="stack"><label class="field">Template name<input type="text" name="name" required value="${s.title || 'Sunday Morning'}"></label>
      <p class="muted small">Copies this order of service and its positions needed. Afterwards, mark the rows that change each week as “Fill in each week”.</p></div>`,
    onSubmit: async (f) => { made = await post('/templates', { name: f.name.value, campus_id: s.campus_id, from_service_id: s.id }); },
  });
  if (made) { toast('Template saved.'); location.hash = `#/templates/${made.id}`; }
}
