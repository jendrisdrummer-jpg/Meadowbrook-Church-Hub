// Search everything from one box (Ctrl/⌘ K, or /): people, teams, songs, services, events, your
// tasks, and the hub's own pages. Arrow keys move, Enter opens, Esc closes.
import { get, html, mount, icon, avatar } from './lib.js';

const TYPE_ICON = { person: 'user', team: 'teams', song: 'music', service: 'calendar', event: 'calendar', task: 'tasks', page: 'link' };
let open = null;

// pages(): the hub pages this person can open, as [{ path, label, icon, external }].
export function initSearch(pages, go) {
  document.addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSearch(pages, go); }
    else if (e.key === '/' && !typing && !open && !document.querySelector('dialog[open]')) { e.preventDefault(); openSearch(pages, go); }
  });
}

export function searchButton() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return html`<button type="button" class="search-btn" data-search-open aria-label="Search">${icon('search')}<span>Search</span><kbd>${mac ? '⌘' : 'Ctrl'} K</kbd></button>`;
}

export function openSearch(pages, go) {
  if (open) return open.querySelector('input').focus();
  const box = document.createElement('div');
  box.className = 'sp-backdrop';
  box.innerHTML = `<div class="sp" role="dialog" aria-label="Search" aria-modal="true">
    <div class="sp-input"></div>
    <div class="sp-results" id="sp-results" role="listbox"></div>
    <div class="sp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div></div>`;
  mount(box.querySelector('.sp-input'), html`${icon('search')}<input type="search" placeholder="Search people, songs, services, teams, events…" autocomplete="off" spellcheck="false" aria-controls="sp-results"><kbd>Esc</kbd>`);
  document.body.append(box);
  open = box;
  const input = box.querySelector('input');
  const results = box.querySelector('.sp-results');
  let items = [];
  let active = 0;
  let seq = 0;
  let timer;

  const close = () => { box.remove(); open = null; document.removeEventListener('keydown', keys, true); };
  const choose = (it) => {
    if (!it) return;
    close();
    if (it.external) location.href = it.href; else go(it.href);
  };
  const pageMatches = (q) => pages().filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, q ? 4 : 8)
    .map((p) => ({ type: 'page', title: p.label, sub: 'Go to page', href: p.path, external: p.external, icon: p.icon }));

  function draw(groups, q) {
    const pageGroup = pageMatches(q);
    const all = [...groups, ...(pageGroup.length ? [{ key: 'pages', label: q ? 'Pages' : 'Go to', items: pageGroup }] : [])];
    items = all.flatMap((g) => g.items);
    active = Math.min(active, Math.max(0, items.length - 1));
    let n = -1;
    mount(results, all.length ? html`${all.map((g) => html`<div class="sp-group">${g.label}</div>${g.items.map((it) => {
      n += 1;
      return html`<button type="button" class="sp-item ${n === active ? 'on' : ''}" role="option" aria-selected="${n === active}" data-i="${n}">
        ${it.type === 'person' ? avatar({ first_name: it.title, last_name: it.title.split(' ').at(-1), photo: it.photo }, 'sp-av') : html`<span class="sp-ic">${icon(it.icon || TYPE_ICON[it.type])}</span>`}
        <span class="grow"><b>${it.title}</b>${it.sub ? html`<span class="muted small">${it.sub}</span>` : ''}</span>
        ${n === active ? html`<kbd>Enter</kbd>` : ''}</button>`;
    })}`)}` : html`<p class="sp-empty">Nothing found for “${q}”.</p>`);
    results.querySelector('.sp-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  async function search() {
    const q = input.value.trim().toLowerCase();
    const mine = ++seq;
    if (q.length < 2) { active = 0; return draw([], q); }
    const d = await get(`/search?q=${encodeURIComponent(q)}`).catch(() => ({ groups: [] }));
    if (mine !== seq || !open) return;
    active = 0;
    draw(d.groups, q);
  }

  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      results.querySelectorAll('.sp-item').forEach((b, i) => {
        b.classList.toggle('on', i === active);
        b.setAttribute('aria-selected', i === active);
        b.querySelector('kbd')?.remove();
        if (i === active) { b.insertAdjacentHTML('beforeend', '<kbd>Enter</kbd>'); b.scrollIntoView({ block: 'nearest' }); }
      });
    }
    if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); choose(items[active]); }
  }
  document.addEventListener('keydown', keys, true);
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 140); });
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  results.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(items[Number(b.dataset.i)]); });
  results.addEventListener('mousemove', (e) => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== active) { active = Number(b.dataset.i); results.querySelectorAll('.sp-item').forEach((x, i) => x.classList.toggle('on', i === active)); }
  });
  draw([], '');
  input.focus();
}
