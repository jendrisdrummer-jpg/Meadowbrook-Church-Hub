// App shell: sign-in check, navigation, campus switcher and a small hash router.
import { get, post, patch, html, raw, mount, icon, avatar, $, fail } from './lib.js';
import { initSearch, searchButton, openSearch } from './search.js';

const RANK = { volunteer: 0, leader: 1, staff: 2, admin: 3 };

// Sidebar sections: five, and nothing hidden below the fold. New areas slot into the group they belong to.
// Help and Feedback live beside the user's name (HELP_LINKS), not in a group. `badge` keys that nothing
// fills yet ('connect', 'forms') stay hidden until a count is sent to setBadge().
const NAV = [
  { group: '', items: [
    { path: '/', label: 'Home', icon: 'home', min: 'volunteer', mobile: true },
    { path: '/my', label: 'My Schedule', short: 'Schedule', icon: 'user', min: 'volunteer', mobile: true },
    { path: '/chat', label: 'Chat', icon: 'chat', min: 'volunteer', mobile: true, badge: 'chat' },
    { path: '/tasks', label: 'Tasks', icon: 'tasks', min: 'volunteer', badge: 'tasks' },
  ] },
  { group: 'People', items: [
    { path: '/people', label: 'People', icon: 'people', min: 'leader', mobile: true },
    { path: '/teams', label: 'Teams', icon: 'teams', min: 'leader' },
    { path: '/groups', label: 'Groups', icon: 'groups', min: 'volunteer' },
  ] },
  { group: 'Services', items: [
    { path: '/services', label: 'Services', icon: 'calendar', min: 'volunteer' },
    { path: '/attendance', label: 'Attendance', icon: 'chart', min: 'leader' },
    // For accounts with the Attendance switch who aren't leaders: the roll and headcount screens only.
    { path: '/take-attendance', label: 'Attendance', icon: 'chart', min: 'volunteer', attendanceOnly: true, mobile: true },
    { path: '/schedule', label: 'Volunteer schedule', icon: 'roster', min: 'leader' },
    { path: '/songs', label: 'Songs', icon: 'music', min: 'leader' },
    { path: '/templates', label: 'Templates', icon: 'copy', min: 'staff' },
  ] },
  { group: 'Church app', items: [
    { path: '/events', label: 'Events', icon: 'event', min: 'staff' },
    { path: '/announcements', label: 'Announcements', icon: 'bell', min: 'volunteer', announce: true },
    { path: '/forms', label: 'Forms', icon: 'file', min: 'staff', badge: 'forms' },
    { path: '/connect', label: 'Connect cards', icon: 'hand', min: 'leader', badge: 'connect' },
    { path: '/media', label: 'Media', icon: 'play', min: 'staff', badge: 'media' },
    { path: '/app-builder', label: 'App Builder', icon: 'phone', min: 'volunteer', appEditor: true },
  ] },
  { group: 'More', items: [
    { path: '/giving', label: 'Giving', icon: 'heart', min: 'volunteer', finance: true },
    { path: '/checkin', label: 'Kids Check-in', short: 'Check-in', icon: 'checkin', min: 'leader', external: true },
    { path: '/stations', label: 'Check-in iPads', icon: 'tablet', min: 'staff' },
    { path: '/settings', label: 'Settings', icon: 'settings', min: 'admin' },
  ] },
];
// Beside the user's name in the sidebar, and in the footer of the phone More sheet. Still found by search.
const HELP_LINKS = [
  { path: '/help', label: 'Help', icon: 'info', min: 'volunteer' },
  { path: '/feedback', label: 'Feedback', icon: 'chat', min: 'volunteer' },
];

const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['device', 'Match my device']];

export function applyTheme(theme, accent) {
  const root = document.documentElement;
  root.dataset.theme = theme || 'light';
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) root.style.setProperty('--accent', accent);
  try {
    localStorage.setItem('mb.theme', root.dataset.theme);
    if (accent) localStorage.setItem('mb.accent', accent);
  } catch { /* private window: the choice still applies to this page */ }
}

const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/my$/, 'my'],
  [/^\/chat(?:\/(\d+))?$/, 'chat'],
  [/^\/tasks$/, 'tasks'],
  [/^\/giving(?:\/(\w+))?$/, 'giving'],
  [/^\/tasks\/(new|\d+)$/, 'task'],
  [/^\/people$/, 'people'],
  [/^\/people\/(\d+)$/, 'person'],
  [/^\/teams$/, 'teams'],
  [/^\/teams\/(\d+)$/, 'team'],
  [/^\/groups$/, 'groups'],
  [/^\/groups\/(\d+)$/, 'group'],
  [/^\/services$/, 'services'],
  [/^\/services\/(\d+)$/, 'service'],
  [/^\/schedule$/, 'schedule'],
  [/^\/songs$/, 'songs'],
  [/^\/events$/, 'events'],
  [/^\/events\/(new|\d+)(?:\/(signups))?$/, 'event'],
  [/^\/templates$/, 'templates'],
  [/^\/templates\/(\d+)$/, 'template'],
  [/^\/attendance$/, 'attendance'],
  [/^\/take-attendance(?:\/(\d+))?$/, 'take-attendance'],
  [/^\/connect$/, 'connect'],
  [/^\/forms(?:\/(new|\d+)(?:\/(responses))?)?$/, 'forms'],
  [/^\/announcements$/, 'announcements'],
  [/^\/stations$/, 'stations'],
  [/^\/media(?:\/(published|skipped|hidden|setup|podcast))?$/, 'media'],
  [/^\/media\/(\d+)$/, 'media-item'],
  [/^\/app-builder$/, 'appbuilder'],
  [/^\/settings(?:\/(\w+))?$/, 'settings'],
  [/^\/feedback$/, 'feedback'],
  [/^\/help$/, 'help'],
];

export const state = { me: null, campuses: [], settings: {}, campusId: null, lastPath: '' };

export const can = (role) => RANK[state.me?.role] >= RANK[role];
export const go = (path) => { location.hash = '#' + path; };
export const campusName = (id) => state.campuses.find((c) => c.id === id)?.short_name || state.campuses.find((c) => c.id === id)?.name || '';
export const campusById = (id) => state.campuses.find((c) => c.id === id);
export const visibleCampuses = () => state.campuses.filter((c) => c.active && (!state.me.campusIds || state.me.campusIds.includes(c.id)));
// Query-string suffix for the campus picked in the sidebar ("" = all campuses).
export const campusQuery = (sep = '?') => (state.campusId ? `${sep}campus_id=${state.campusId}` : '');

// "?decline=12" style options after a page's path in the address.
export const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');

let focusTitleNext = false; // after the person moves to another page, focus its title so keyboard and screen reader users start there
export function setTitle(title, actions = '') {
  $('[data-title]').textContent = title;
  if (focusTitleNext) { focusTitleNext = false; $('[data-title]').focus({ preventScroll: true }); }
  $('[data-title]').classList.remove('greeting');
  drawCampusTag();
  document.title = `${title} · ${state.settings.church_name || 'Church Hub'}`;
  mount($('[data-actions]'), actions);
}

// "North only": shown beside the page title whenever a campus is picked, so nobody mistakes a
// filtered list for the whole church.
export function drawCampusTag() {
  const tag = $('[data-campus-tag]');
  if (!tag) return;
  const on = state.campusId && visibleCampuses().length > 1;
  tag.textContent = on ? `${campusName(state.campusId)} only` : '';
  tag.classList.toggle('hidden', !on);
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
  $('.brand-mark').textContent = (state.settings.church_name || 'C').trim()[0].toUpperCase();
  applyTheme(state.me.theme, state.settings.brand_color);
  drawChrome();
  // The skip link must not touch the address (pages are routed by it), so it moves focus by hand.
  document.querySelector('[data-skip]')?.addEventListener('click', (e) => { e.preventDefault(); const m = $('#main'); m.focus(); m.scrollIntoView({ block: 'start' }); });
  window.addEventListener('hashchange', () => { if (bellOpen) { bellOpen = false; drawBell(); } focusTitleNext = true; route(); });
  route();
  initSearch(searchPages, go);
  drawBell();
  refreshBadges();
  refreshAttentionBadges(true);
  setInterval(() => { if (!document.hidden) { drawBell(); refreshBadges(); } }, 90e3);
  setInterval(() => { if (!document.hidden) refreshAttentionBadges(true); }, 300e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { drawBell(); refreshBadges(); refreshAttentionBadges(); } });
  window.addEventListener('focus', () => refreshAttentionBadges());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // A notification tapped while the app is open moves it to that page.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate') location.href = e.data.url;
    });
  }
}

// Counts on menu items: unread chat messages, and my tasks due today or late.
const badgeCounts = {};
const MORE_KINDS = ['tasks', 'forms', 'connect', 'media'];
function setBadge(kind, n) {
  badgeCounts[kind] = n;
  // The phone's More button carries the counts for pages that aren't on the bottom bar.
  if (MORE_KINDS.includes(kind)) setBadge('more', MORE_KINDS.reduce((sum, k) => sum + (badgeCounts[k] || 0), 0));
  document.querySelectorAll(`[data-badge="${kind}"]`).forEach((b) => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); });
}
// Paint the last known counts onto badges that were just drawn (the More sheet is built on demand).
const paintBadges = (root) => root.querySelectorAll('[data-badge]').forEach((b) => {
  const n = badgeCounts[b.dataset.badge] || 0;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
});
export async function refreshChatBadge() {
  try { setBadge('chat', (await get('/chats/unread')).total); } catch { /* try again later */ }
}
export async function refreshBadges() {
  refreshChatBadge();
  try { setBadge('tasks', (await get('/tasks/summary')).due); } catch { /* try again later */ }
}

// What's waiting for staff and leaders (connect cards, new form responses), for the menu badges.
// Asked on load, when the tab is shown again, and every 5 minutes; other people's counts are zero.
let attentionAt = 0;
export async function refreshAttentionBadges(force = false) {
  if (!force && Date.now() - attentionAt < 60e3) return;
  attentionAt = Date.now();
  try {
    const a = await get(`/attention${campusQuery()}`);
    setBadge('connect', a.connect_cards + a.signups);
    setBadge('forms', a.forms_new);
    setBadge('media', a.media_review || 0);
  } catch { /* try again later */ }
}

// ---------------------------------------------------------------- notifications bell
let bellOpen = false;
async function drawBell() {
  const box = $('[data-bell]');
  let d;
  try { d = await get('/notifications'); } catch { return; }
  const ago = (t) => {
    const mins = Math.round((Date.now() - Date.parse(`${t.replace(' ', 'T')}Z`)) / 60e3);
    return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : new Date(`${t.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  mount(box, html`<button type="button" class="icon-btn bell ${d.unread ? 'has' : ''}" data-bell-btn aria-label="Notifications${d.unread ? ` (${d.unread} new)` : ''}">${icon('bell')}${d.unread ? html`<span class="bell-count">${d.unread > 9 ? '9+' : d.unread}</span>` : ''}</button>
    ${bellOpen ? html`<div class="menu bell-menu" role="menu">
      <div class="menu-head row">Notifications<span class="spacer"></span>${d.unread ? html`<button type="button" class="btn small ghost" data-read-all>Mark all read</button>` : ''}</div>
      ${d.items.length ? d.items.map((n) => html`<a href="${n.url || '#/'}" class="bell-item ${n.read_at ? '' : 'new'}" data-note="${n.id}">
        <b>${n.read_at ? '' : html`<span class="sr-only">New: </span>`}${n.title}</b><span class="small">${n.body}</span><span class="muted small">${ago(n.created_at)}</span></a>`)
        : html`<p class="muted small" style="padding:8px 12px">Nothing yet. You’ll see it here when you’re scheduled.</p>`}
      <a href="#/my" class="bell-foot small">Notification settings</a>
    </div>` : ''}`);
  box.onclick = async (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-bell-btn]')) { bellOpen = !bellOpen; return drawBell(); }
    if (e.target.closest('[data-read-all]')) { await post('/notifications/read', {}).catch(fail); return drawBell(); }
    const note = e.target.closest('[data-note]');
    if (note) { post('/notifications/read', { ids: [Number(note.dataset.note)] }).catch(() => {}); }
    if (e.target.closest('a')) { bellOpen = false; setTimeout(drawBell, 300); }
  };
}
document.addEventListener('click', (e) => {
  if (bellOpen && !e.target.closest('[data-bell]')) { bellOpen = false; drawBell(); }
});

// The pages this account can open. Finance pages are for accounts with the Finance permission,
// whatever their role; Announcements and Edit the app (App Builder) likewise.
const searchPages = () => [...visibleNav().flatMap((g) => g.items), ...HELP_LINKS.filter((n) => can(n.min))];
const visibleNav = () => NAV.map((g) => ({ ...g, items: g.items.filter((n) => can(n.min) && (!n.finance || state.me.finance) && (!n.announce || state.me.announce) && (!n.appEditor || state.me.appEditor) && (!n.attendanceOnly || (state.me.attendance && !can('leader')))) })).filter((g) => g.items.length);

function drawChrome() {
  const groups = visibleNav();
  mount($('[data-search]'), searchButton());
  $('[data-search]').onclick = () => openSearch(searchPages, go);
  const link = (n, label = n.label) => html`<a href="${n.external ? n.path : '#' + n.path}" data-path="${n.path}">${icon(n.icon)}<span>${label}</span>${n.badge ? html`<span class="nav-badge hidden" data-badge="${n.badge}"></span>` : ''}</a>`;
  mount($('[data-nav]'), groups.map((g) => html`${g.group ? html`<div class="nav-group">${g.group}</div>` : ''}${g.items.map((n) => link(n))}`));
  mount($('[data-bottomnav]'), html`${groups.flatMap((g) => g.items).filter((n) => n.mobile).map((n) => link(n, n.short || n.label))}
    <button type="button" data-more aria-haspopup="dialog">${icon('menu')}<span>More</span><span class="nav-badge hidden" data-badge="more"></span></button>`);
  $('[data-more]').onclick = openMore;
  paintBadges(document);
  const sel = $('[data-campus]');
  fillCampusSelect(sel);
  sel.closest('label').classList.toggle('hidden', visibleCampuses().length < 2);
  sel.onchange = () => pickCampus(sel.value);
  mount($('[data-side-links]'), HELP_LINKS.filter((n) => can(n.min)).map((n) => html`<a class="icon-btn" href="#${n.path}" data-path="${n.path}" title="${n.label}" aria-label="${n.label}">${icon(n.icon)}</a>`));
  drawCampusTag();
  drawMe();
}

function fillCampusSelect(sel) {
  const camps = visibleCampuses();
  mount(sel, html`${camps.length > 1 || !state.me.campusIds ? html`<option value="">All campuses</option>` : ''}${camps.map((c) => html`<option value="${c.id}">${c.name}</option>`)}`);
  sel.value = state.campusId ?? '';
}
function pickCampus(value) {
  state.campusId = Number(value) || null;
  localStorage.setItem('mb.campus', state.campusId ?? '');
  document.querySelectorAll('[data-campus]').forEach((s) => { s.value = state.campusId ?? ''; });
  drawCampusTag();
  route();
}

// ---------------------------------------------------------------- phone "More" sheet
// Everything the sidebar offers on a laptop, for the phone: the same visibleNav() groups (so what
// someone can see never changes), minus what already sits on the bottom bar.
async function signOut() {
  await fetch('/auth/logout', { method: 'POST', headers: { 'x-mb': '1' } }).catch(() => {});
  location.href = '/login';
}
function openMore() {
  if (document.querySelector('dialog.sheet')) return;
  const here = (location.hash.slice(1) || '/').split('?')[0];
  const onBar = new Set(visibleNav().flatMap((g) => g.items).filter((n) => n.mobile).map((n) => n.path));
  const footer = new Set(['/help', '/feedback']);
  const groups = visibleNav().map((g) => ({ ...g, items: g.items.filter((n) => !onBar.has(n.path) && !footer.has(n.path)) })).filter((g) => g.items.length);
  const tile = (n) => html`<a class="sheet-tile ${here === n.path || (n.path !== '/' && here.startsWith(n.path)) ? 'on' : ''}" href="${n.external ? n.path : '#' + n.path}">${icon(n.icon)}<span>${n.short || n.label}</span>${n.badge ? html`<span class="nav-badge hidden" data-badge="${n.badge}"></span>` : ''}</a>`;
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.setAttribute('aria-labelledby', 'more-title');
  const camps = visibleCampuses();
  mount(dlg, html`<div class="sheet-body">
    <div class="sheet-head"><h2 id="more-title">More</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    ${camps.length > 1 ? html`<label class="field">Campus<select data-campus></select></label>` : ''}
    ${groups.map((g) => html`<section aria-label="${g.group || 'Everyday'}"><div class="sheet-group">${g.group || 'Everyday'}</div><div class="sheet-tiles">${g.items.map(tile)}</div></section>`)}
    <div class="sheet-group">Appearance</div>
    <div class="seg" role="group" aria-label="Appearance">${THEMES.map(([v, label]) => html`<button type="button" data-theme-pick="${v}" aria-pressed="${String(state.me.theme === v)}" class="${state.me.theme === v ? 'on' : ''}">${label}</button>`)}</div>
    <div class="sheet-foot">
      <a href="#/help">${icon('info')} Help</a>
      <a href="#/feedback">${icon('chat')} Feedback</a>
      <button type="button" data-logout>${icon('logout')} Sign out</button>
    </div>
  </div>`);
  document.body.append(dlg);
  const csel = dlg.querySelector('[data-campus]');
  if (csel) { fillCampusSelect(csel); csel.onchange = () => pickCampus(csel.value); }
  paintBadges(dlg);
  const close = () => dlg.close();
  dlg.addEventListener('close', () => { dlg.remove(); window.removeEventListener('hashchange', close); });
  window.addEventListener('hashchange', close);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]') || e.target.closest('a')) return close();
    const pick = e.target.closest('[data-theme-pick]');
    if (pick) {
      state.me.theme = pick.dataset.themePick;
      applyTheme(state.me.theme, state.settings.brand_color);
      patch('/me', { theme: state.me.theme }).catch(fail);
      dlg.querySelectorAll('[data-theme-pick]').forEach((b) => { const on = b === pick; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    }
    if (e.target.closest('[data-logout]')) signOut();
  });
  dlg.showModal();
}

// The signed-in person's menu: appearance and sign out.
// On phones the sidebar is hidden, so the same menu also sits in the top bar.
function drawMe(open = false, sel = '[data-me]') {
  if (sel === '[data-me]' && !open) drawMe(false, '[data-me-top]');
  const box = $(sel);
  mount(box, html`${avatar({ first_name: state.me.name, photo: state.me.photo })}<span class="small">${state.me.name}<br><span class="muted">${state.me.role}</span></span>
    ${open ? html`<div class="menu" role="menu">
      <div class="menu-head">Appearance</div>
      ${THEMES.map(([v, label]) => html`<button type="button" data-theme-pick="${v}" class="${state.me.theme === v ? 'on' : ''}">${state.me.theme === v ? icon('check') : html`<span style="width:17px"></span>`}${label}</button>`)}
      <hr><button type="button" data-logout>${icon('logout')} Sign out</button>
    </div>` : ''}`);
  box.onclick = async (e) => {
    // Keep the document listener below from closing the menu we're about to redraw.
    e.stopPropagation();
    const pick = e.target.closest('[data-theme-pick]');
    if (pick) {
      state.me.theme = pick.dataset.themePick;
      applyTheme(state.me.theme, state.settings.brand_color);
      patch('/me', { theme: state.me.theme }).catch(fail);
      return drawMe(true, sel);
    }
    if (e.target.closest('[data-logout]')) {
      return signOut();
    }
    if (!e.target.closest('.menu')) drawMe(!open, sel);
  };
  // Never let the menu run off the screen, whatever the layout puts the avatar next to.
  const menu = box.querySelector('.menu');
  if (menu) {
    const r = menu.getBoundingClientRect();
    const shift = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
    if (shift) menu.style.transform = `translateX(${shift}px)`;
  }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-me], [data-me-top]') && document.querySelector('[data-me] .menu, [data-me-top] .menu')) drawMe(false);
});

// Pages whose forms must not open by URL for people the server would refuse anyway (the server guards
// hold; this just shows the normal refusal instead of a form or an error).
const PAGE_RULES = { 'take-attendance': (me) => me.attendance || can('leader'), giving: (me) => me.finance, settings: () => can('admin'), appbuilder: (me) => me.appEditor, announcements: (me) => me.announce || can('admin') };

let renderSeq = 0;
async function route() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (path !== '/feedback') state.lastPath = path; // so feedback says which page it was about
  const seq = ++renderSeq;
  const hit = ROUTES.map(([re, page]) => [path.match(re), page]).find(([m]) => m);
  const content = $('[data-content]');
  document.querySelectorAll('[data-path]').forEach((a) => {
    const p = a.dataset.path;
    a.classList.toggle('on', p === '/' ? path === '/' : path.startsWith(p));
  });
  // On a page that lives under More, light up More so people know where they are.
  document.querySelector('[data-more]')?.classList.toggle('on', !document.querySelector('[data-bottomnav] a.on'));
  if (!hit) { setTitle('Not found'); mount(content, html`<div class="empty">That page doesn’t exist.</div>`); return; }
  const [m, page] = hit;
  if (PAGE_RULES[page] && !PAGE_RULES[page](state.me)) {
    setTitle('No access');
    mount(content, html`<div class="empty">You don’t have access to this page. If you think you should, ask an admin.</div>`);
    return;
  }
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
