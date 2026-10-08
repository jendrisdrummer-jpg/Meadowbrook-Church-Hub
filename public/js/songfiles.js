// Song files in the dashboard and the app: little chips on each song in a plan (charts and lyrics
// open; audio plays right there), and the list where leaders add and organise them.
import { api, patch, del, html, mount, icon, options, toast, fail, confirm, dialog } from './lib.js';

export const KIND = { chart: 'Chords', lyrics: 'Lyrics', sheet: 'Sheet music', audio: 'Audio', other: 'File' };
const KIND_ICON = { chart: 'music', lyrics: 'file', sheet: 'book', audio: 'play', other: 'file' };
const sizeLabel = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// Charts, lyrics and sheet music for the key being played first; files for other keys say which
// key they're in. Audio stays on the song itself (see songSheet), not in the plan.
export function fileChips(files = [], key = '') {
  files = files.filter((f) => f.kind !== 'audio');
  if (!files.length) return '';
  const k = String(key || '').trim().toLowerCase();
  const rank = (f) => (!f.song_key ? 1 : f.song_key.toLowerCase() === k ? 0 : 2);
  const list = [...files].sort((a, b) => rank(a) - rank(b));
  return html`<span class="sf-chips">${list.map((f) => {
    const label = html`${icon(KIND_ICON[f.kind] || 'file', 'ic small-ic')}${KIND[f.kind] || 'File'}${f.song_key ? html` <span class="sf-key">${f.song_key}</span>` : ''}`;
    return f.kind === 'audio'
      ? html`<button type="button" class="sf-chip ${rank(f) === 2 ? 'other-key' : ''}" data-play="${f.id}" data-name="${f.name}" title="${f.name}">${label}</button>`
      : html`<a class="sf-chip ${rank(f) === 2 ? 'other-key' : ''}" href="/api/song-files/${f.id}" target="_blank" rel="noopener" title="${f.name}">${label}</a>`;
  })}</span>`;
}

// A song's name in a plan opens the song: its key, author and every file, with audio to listen to.
export function songTitle(item) {
  const name = item.title || item.song_title || 'Song';
  return item.files?.length ? html`<button type="button" class="song-link" data-song-sheet="${item.id}" title="Open this song">${name}</button>` : html`<b>${name}</b>`;
}

export function songSheet(item) {
  const files = item.files || [];
  const key = String(item.song_key || '').toLowerCase();
  const rank = (f) => (f.kind === 'audio' ? 3 : !f.song_key ? 1 : f.song_key.toLowerCase() === key ? 0 : 2);
  return dialog({
    title: item.song_title || item.title || 'Song',
    submit: false, cancel: 'Close',
    body: html`<p class="muted" style="margin:0 0 12px">${[item.song_author, item.song_key ? `Key of ${item.song_key}` : ''].filter(Boolean).join(' · ')}</p>
      <div class="sf-sheet">${[...files].sort((a, b) => rank(a) - rank(b)).map((f) => (f.kind === 'audio'
        ? html`<div class="sf-sheet-row audio"><span class="sf-ic">${icon('play')}</span><span class="grow"><b>${f.name}</b><audio controls preload="none" src="/api/song-files/${f.id}"></audio></span></div>`
        : html`<a class="sf-sheet-row" href="/api/song-files/${f.id}" target="_blank" rel="noopener"><span class="sf-ic">${icon(KIND_ICON[f.kind] || 'file')}</span>
            <span class="grow"><b>${f.name}</b><br><span class="muted small">${KIND[f.kind] || 'File'}${f.song_key ? ` · ${f.song_key}` : ''}</span></span>${icon('external', 'ic small-ic')}</a>`))}</div>`,
  });
}

// Opens the song when its name is tapped. items() returns the plan's current rows.
export function wireSongSheets(root, items) {
  if (root.dataset.sfWired) return;
  root.dataset.sfWired = '1';
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-song-sheet]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const item = items().find((i) => String(i.id) === b.dataset.songSheet);
    if (item) songSheet(item);
  }, true);
}

// ---------------------------------------------------------------- managing a song's files
export async function songFilesEditor(el, song, files, onChange = () => {}) {
  let listening = null;
  const draw = () => mount(el, html`<div class="sf-list">
      ${files.map((f) => html`<div class="sf-row" data-f="${f.id}">
        <span class="sf-ic">${icon(KIND_ICON[f.kind] || 'file')}</span>
        <input type="text" value="${f.name}" data-fk="name" aria-label="Name">
        <select data-fk="kind" aria-label="What it is">${options(Object.entries(KIND).map(([value, label]) => ({ value, label })), f.kind)}</select>
        <input type="text" value="${f.song_key}" data-fk="song_key" placeholder="Any key" aria-label="Key" class="sf-keyin">
        ${f.kind === 'audio' ? html`<button type="button" class="btn small ghost" data-listen="${f.id}" title="Listen">${icon('play')}</button>`
          : html`<a class="btn small ghost" href="/api/song-files/${f.id}" target="_blank" rel="noopener" title="Open">${icon('external')}</a>`}
        <button type="button" class="icon-btn danger" data-fdel="${f.id}" title="Remove">${icon('trash')}</button>
        <span class="muted small sf-size">${sizeLabel(f.size)}</span>
        ${f.kind === 'audio' && listening === f.id ? html`<audio class="sf-audio" controls autoplay src="/api/song-files/${f.id}"></audio>` : ''}</div>`)}
      ${files.length ? '' : html`<p class="muted small" style="margin:0">No files yet. Add chord charts, lyrics or sheet music (PDF, picture or text) and audio (MP3, M4A, WAV).</p>`}
    </div>
    <label class="sf-drop" data-drop>${icon('upload')} <span><b>Add files</b> or drop them here</span>
      <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.mp3,.m4a,.wav,.aac,.ogg,application/pdf,image/*,text/plain,audio/*" data-files hidden></label>`);

  async function upload(list) {
    for (const file of list) {
      const type = file.type || (/\.mp3$/i.test(file.name) ? 'audio/mpeg' : /\.m4a$/i.test(file.name) ? 'audio/mp4' : /\.txt$/i.test(file.name) ? 'text/plain' : '');
      try {
        toast(`Uploading ${file.name}…`);
        const base = file.name.replace(/\.[^.]+$/, '');
        // A file named for its key ("Way Maker - G.pdf") is for that key; otherwise any key.
        const key = base.match(/[-_ (]([A-G][#b]?m?)\)?$/)?.[1] || '';
        const made = await api('POST', `/songs/${song.id}/files?name=${encodeURIComponent(base)}&key=${encodeURIComponent(key)}`, new Blob([file], { type }));
        files.push(made);
      } catch (err) { fail(err); }
    }
    draw();
    onChange(files);
  }

  el.onchange = async (e) => {
    const t = e.target;
    if (t.matches('[data-files]')) return upload([...t.files]);
    const row = t.closest('[data-f]');
    if (row && t.dataset.fk) {
      try {
        const f = await patch(`/song-files/${row.dataset.f}`, { [t.dataset.fk]: t.value });
        Object.assign(files.find((x) => x.id === f.id), f);
        if (t.dataset.fk === 'kind') draw();
        onChange(files);
      } catch (err) { fail(err); }
    }
  };
  el.onclick = async (e) => {
    const l = e.target.closest('[data-listen]');
    if (l) { e.preventDefault(); listening = listening === Number(l.dataset.listen) ? null : Number(l.dataset.listen); return draw(); }
    const b = e.target.closest('[data-fdel]');
    if (!b) return;
    e.preventDefault();
    if (!(await confirm('Remove this file?', 'It comes off the song everywhere it’s used.', 'Remove'))) return;
    try {
      await del(`/song-files/${b.dataset.fdel}`);
      files.splice(files.findIndex((x) => x.id === Number(b.dataset.fdel)), 1);
      draw();
      onChange(files);
    } catch (err) { fail(err); }
  };
  el.ondragover = (e) => { if (e.target.closest('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('over'); } };
  el.ondragleave = (e) => e.target.closest('[data-drop]')?.classList.remove('over');
  el.ondrop = (e) => {
    if (!e.target.closest('[data-drop]')) return;
    e.preventDefault();
    upload([...e.dataTransfer.files]);
  };
  draw();
}
