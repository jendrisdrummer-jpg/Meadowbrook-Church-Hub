// "Search the whole church" for the roll: finds someone from any campus by name (names and a small
// campus label only) and marks them here. Kept out of rollcall.js so that file stays small.
import { get, post, html, mount, dialog, debounce, toast, fail } from './lib.js';

const label = (p) => [p.first_name, p.nickname ? `“${p.nickname}”` : '', p.last_name].filter(Boolean).join(' ');

// Resolves to the person marked present, or undefined if they closed it without choosing.
export function searchChurch(s, start = '') {
  let marked;
  return dialog({
    title: 'Search the whole church', submit: null, cancel: 'Close',
    body: html`<p class="muted small" style="margin-top:0">Find someone from another campus so they aren’t added twice. Picking them marks them here.</p>
      <input type="search" aria-label="Search by name" placeholder="First or last name" value="${start}" data-q>
      <div class="picker-list" data-list><div class="muted small">Start typing…</div></div>`,
    onOpen: (d, close) => {
      const input = d.querySelector('[data-q]');
      const list = d.querySelector('[data-list]');
      let rows = [];
      let seq = 0;
      const run = debounce(async () => {
        const q = input.value.trim();
        const mine = ++seq;
        if (q.length < 2) { mount(list, html`<div class="muted small">Start typing…</div>`); return; }
        try {
          const out = (await get(`/services/${s.id}/roll/search?q=${encodeURIComponent(q)}`)).people;
          if (mine !== seq) return;
          rows = out;
          mount(list, rows.length ? rows.map((p, i) => html`<button type="button" data-i="${i}"><span>${label(p)}</span>${p.campus ? html` <span class="pill">${p.campus}</span>` : ''}</button>`)
            : html`<div class="muted small">No one found. You can add them as a new guest.</div>`);
        } catch (e) { fail(e); }
      }, 250);
      input.addEventListener('input', run);
      if (input.value.trim().length >= 2) run();
      list.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const p = rows[b.dataset.i];
        b.disabled = true;
        try {
          await post(`/services/${s.id}/roll/church`, { person_id: p.id });
          marked = p;
          toast(`${label(p)} marked here.`);
          close();
        } catch (err) { b.disabled = false; fail(err); }
      });
    },
  }).then(() => marked);
}
