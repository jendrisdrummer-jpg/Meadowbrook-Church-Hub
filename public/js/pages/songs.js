// Song library, with when each song was last used.
import { get, post, patch, html, mount, icon, dialog, formData, debounce, fmtDate } from '../lib.js';
import { setTitle } from '../app.js';

export default async function songs(el) {
  setTitle('Songs', html`<button class="btn primary" data-add>${icon('plus')} Add song</button>`);
  mount(el, html`<div class="card"><input type="search" data-q placeholder="Search title or author" style="max-width:340px;margin-bottom:12px"><div class="table-wrap" data-list></div></div>`);
  let rows = [];
  const load = async () => {
    rows = await get(`/songs?q=${encodeURIComponent(el.querySelector('[data-q]').value)}`);
    mount(el.querySelector('[data-list]'), rows.length ? html`<table class="list"><thead><tr><th>Title</th><th>Key</th><th>CCLI #</th><th>Last used</th><th>Past year</th></tr></thead>
      <tbody>${rows.map((s, i) => html`<tr class="click" data-i="${i}"><td><b>${s.title}</b><div class="muted small">${s.author}</div></td><td>${s.default_key}</td>
        <td class="muted">${s.ccli}</td><td class="muted small">${s.last_used ? fmtDate(s.last_used.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}</td><td class="num">${s.uses_year}×</td></tr>`)}</tbody></table>`
      : html`<div class="empty">No songs yet.</div>`);
  };
  const edit = async (s = {}) => {
    const ok = await dialog({
      title: s.id ? 'Edit song' : 'Add a song',
      body: html`<div class="form">
        <label class="field wide">Title<input type="text" name="title" value="${s.title || ''}" required></label>
        <label class="field wide">Author(s)<input type="text" name="author" value="${s.author || ''}"></label>
        <label class="field">Default key<input type="text" name="default_key" value="${s.default_key || ''}"></label>
        <label class="field">BPM<input type="number" name="bpm" value="${s.bpm ?? ''}"></label>
        <label class="field">CCLI song #<input type="text" name="ccli" value="${s.ccli || ''}"></label>
        <label class="field wide">Notes<textarea name="notes">${s.notes || ''}</textarea></label>
        ${s.id ? html`<label class="check wide"><input type="checkbox" name="archived"> Retire this song</label>` : ''}</div>`,
      onSubmit: (f) => (s.id ? patch(`/songs/${s.id}`, formData(f)) : post('/songs', formData(f))),
    });
    if (ok) load();
  };
  el.querySelector('[data-q]').addEventListener('input', debounce(load));
  el.onclick = (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) edit(rows[tr.dataset.i]); };
  document.querySelector('[data-add]').onclick = () => edit();
  load();
}
