// App shell: sign-in check, navigation, campus switcher and a small hash router.
import { get, html, mount, icon, avatar, $, fail } from './lib.js';

const RANK = { volunteer: 0, leader: 1, staff: 2, admin: 3 };

const NAV = [
  { path: '/', label: 'Home', icon: 'home', min: 'volunteer', mobile: true },
  { path: '/my', label: 'My Schedule', icon: 'user', min: 'volunteer', mobile: true },
  { path: '/services', label: 'Services', icon: 'calendar', min: 'volunteer', mobile: true },
  { path: '/people', label: 'People', icon: 'people', min: 'leader', mobile: true },
  { path: '/teams', label: 'Teams', icon: 'teams', min: 'leader' },
  { path: '/songs', label: 'Songs', icon: 'music', min: 'leader' },
  { path: '/attendance', label: 'Attendance', icon: 'chart', min: 'leader' },
  { path: '/checkin', label: 'Kids Check-in', icon: 'checkin', min: 'leader', external: true, mobile: true },
  { sep: true, min: 'admin' },
  { path: '/settings', label: 'Settings', icon: 'settings', min: 'admin' },
];

const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/my$/, 'my'],
  [/^\/people$/, 'people'],
  [/^\/people\/(\d+)$/, 'person'],
  [/^\/teams$/, 'teams'],
  [/^\/teams\/(\d+)$/, 'team'],
  [/^\/services$/, 'services'],
  [/^\/services\/(\d+)$/, 'service'],
  [/^\/songs$/, 'songs'],
  [/^\/attendance$/, 'attendance'],
  [/^\/settings(?:\/(\w+))?$/, 'settings'],
];

export const state = { me: null, campuses: [], settings: {}, campusId: null };

export const can = (role) => RANK[state.me?.role] >= RANK[role];
export const go = (path) => { location.hash = '#' + path; };
export const campusName = (id) => state.campuses.find((c) => c.id === id)?.short_name || state.campuses.find((c) => c.id === id)?.name || '';
export const campusById = (id) => state.campuses.find((c) => c.id === id);
export const visibleCampuses = () => state.campuses.filter((c) => c.active && (!state.me.campusIds || state.me.campusIds.includes(c.id)));
// Query-string suffix for the campus picked in the sidebar ("" = all campuses).
export const campusQuery = (sep = '?') => (state.campusId ? `${sep}campus_id=${state.campusId}` : '');

export function setTitle(title, actions = '') {
  $('[data-title]').textContent = title;
  document.title = `${title} · ${state.settings.church_name || 'Church Hub'}`;
  mount($('[data-actions]'), actions);
}

async function boot() {
  try {
    state.me = await get('/me');
  } catch {
    location.href = '/login';
    return;
  }
  [state.campuses, state.settings] = await Promise.all([get('/campuses'), get('/settings')]);
  const saved = Number(localStorage.getItem('mb.campus')) || null;
  state.campusId = visibleCampuses().some((c) => c.id === saved) ? saved : (visibleCampuses().length === 1 ? visibleCampuses()[0].id : null);
  $('[data-church]').textContent = state.settings.church_name;
  drawChrome();
  window.addEventListener('hashchange', route);
  route();
}

function drawChrome() {
  const items = NAV.filter((n) => can(n.min));
  const link = (n) => html`<a href="${n.external ? n.path : '#' + n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`;
  mount($('[data-nav]'), items.map((n) => (n.sep ? html`<div class="nav-sep"></div>` : link(n))));
  mount($('[data-bottomnav]'), items.filter((n) => n.mobile).map(link));
  const camps = visibleCampuses();
  const sel = $('[data-campus]');
  mount(sel, html`${camps.length > 1 || !state.me.campusIds ? html`<option value="">All campuses</option>` : ''}${camps.map((c) => html`<option value="${c.id}">${c.name}</option>`)}`);
  sel.value = state.campusId ?? '';
  sel.closest('label').classList.toggle('hidden', camps.length < 2);
  sel.onchange = () => {
    state.campusId = Number(sel.value) || null;
    localStorage.setItem('mb.campus', state.campusId ?? '');
    route();
  };
  mount($('[data-me]'), html`${avatar({ first_name: state.me.name, photo: state.me.photo })}<span class="small">${state.me.name}<br><span class="muted">${state.me.role}</span></span>
    <button class="icon-btn" title="Sign out" data-logout style="margin-left:auto">${icon('logout')}</button>`);
  $('[data-logout]').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST', headers: { 'x-mb': '1' } }).catch(() => {});
    location.href = '/login';
  };
}

let renderSeq = 0;
async function route() {
  const path = location.hash.slice(1) || '/';
  const seq = ++renderSeq;
  const hit = ROUTES.map(([re, page]) => [path.match(re), page]).find(([m]) => m);
  const content = $('[data-content]');
  document.querySelectorAll('[data-path]').forEach((a) => {
    const p = a.dataset.path;
    a.classList.toggle('on', p === '/' ? path === '/' : path.startsWith(p));
  });
  if (!hit) { setTitle('Not found'); mount(content, html`<div class="empty">That page doesn’t exist.</div>`); return; }
  const [m, page] = hit;
  try {
    const mod = await import(`./pages/${page}.js`);
    if (seq !== renderSeq) return;
    // A fresh element per page, so one page's event handlers never leak into the next.
    const pageEl = document.createElement('div');
    content.replaceChildren(pageEl);
    await mod.default(pageEl, ...m.slice(1));
  } catch (e) {
    if (seq !== renderSeq) return;
    setTitle('Something went wrong');
    mount(content, html`<div class="alert bad">${e.message}</div>`);
    fail(e);
  }
  window.scrollTo(0, 0);
}

boot();
