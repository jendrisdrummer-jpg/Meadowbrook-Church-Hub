// The member app: what's on it comes from the dashboard's App Builder. Anyone can use it;
// signing in adds the person's serving schedule, service plans and notifications.
import { get, post, patch, html, raw, mount, icon, displayName, fmtDate, fmtTime, toast, fail, DAYS } from '../lib.js';
import { timeline } from '../plan.js';
import { drawSchedule, drawNotifyCard } from '../myschedule.js';
import { isIOS, isMobile, isInstalled, canPromptInstall, promptInstall, currentSubscription } from '../push.js';
import { openChat } from '../chat.js';
import { taskList, taskPage, taskRow } from '../tasks.js';

const $ = (s) => document.querySelector(s);
let app; // { church_name, brand_color, config, times, campuses, user, hub_url }
const preview = new URLSearchParams(location.search).has('preview');

const ROLES = ['volunteer', 'leader', 'staff', 'admin'];
const atLeast = (role) => app.user && ROLES.indexOf(app.user.role) >= ROLES.indexOf(role);
const tabs = () => app.config.tabs.filter((t) => t.on);
const signInHref = (back) => `/login?next=${encodeURIComponent(`/app/#${back}`)}`;
const clock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function applyTheme() {
  const root = document.documentElement;
  if (app.user?.theme) root.dataset.theme = app.user.theme;
  if (/^#[0-9a-f]{6}$/i.test(app.brand_color)) root.style.setProperty('--accent', app.brand_color);
  try {
    localStorage.setItem('mb.theme', root.dataset.theme);
    localStorage.setItem('mb.accent', app.brand_color);
  } catch { /* private window */ }
}

// Every screen's title bar ends with the bell and, to its right, the chat button.
function setTitle(title, actions = '') {
  $('[data-title]').textContent = title;
  document.title = `${title} · ${app.church_name}`;
  mount($('[data-actions]'), html`${actions}${headerButtons()}`);
  refreshChatBadge();
}

async function boot() {
  app = await get('/app/config');
  applyTheme();
  window.addEventListener('hashchange', route);
  // The App Builder's preview reloads this with fresh settings.
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'app-config') { app.config = e.data.config; route(); }
  });
  if ('serviceWorker' in navigator && !preview) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'navigate') location.href = e.data.url; });
  }
  route();
}

function drawTabs(current) {
  mount($('[data-tabs]'), tabs().map((t) => html`<a href="${t.type === 'link' ? t.url : `#/${t.id}`}" ${t.type === 'link' ? raw('target="_blank" rel="noopener"') : ''} class="${t.id === current ? 'on' : ''}">${icon(t.icon)}<span>${t.label}</span>${['chat', 'tasks'].includes(t.type) ? html`<span class="nav-badge hidden" data-badge="${t.type}"></span>` : ''}</a>`));
}

// Counts: unread chat messages (chat button, Chat tab) and my tasks due today or late.
async function refreshChatBadge() {
  if (!app.user || preview) return;
  const set = (kind, n) => document.querySelectorAll(`[data-badge="${kind}"]`).forEach((b) => { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); });
  get('/chats/unread').then((d) => set('chat', d.total)).catch(() => {});
  get('/tasks/summary').then((d) => set('tasks', d.due)).catch(() => {});
}
const chatTab = () => app.config.tabs.find((t) => t.type === 'chat');
const tasksTab = () => app.config.tabs.find((t) => t.type === 'tasks');

let seq = 0;
async function route() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query || '');
  const mine = ++seq;
  const el = document.createElement('div');
  $('[data-content]').replaceChildren(el);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'plan' && parts[1]) { drawTabs('serve'); return await plan(el, parts[1], q); }
    if (parts[0] === 'inbox') { drawTabs('more'); return await inbox(el); }
    if (parts[0] === 'tasks') { drawTabs(tasksTab()?.on ? tasksTab().id : 'more'); return await tasks(el, tasksTab() || { label: 'Tasks' }, parts[1], q); }
    if (parts[0] === 'chat') { drawTabs(chatTab()?.on ? chatTab().id : 'more'); return await chat(el, chatTab() || { label: 'Chat' }, parts[1]); }
    // Tabs that are off still open (from the More tab or a home screen button).
    const tab = app.config.tabs.find((t) => t.id === parts[0] && t.type !== 'link') || tabs()[0];
    drawTabs(tab.on ? tab.id : 'more');
    await (PAGES[tab.type] || page)(el, tab, q);
  } catch (e) {
    if (mine !== seq) return;
    setTitle('Something went wrong');
    mount(el, html`<div class="alert bad">${e.message}</div>`);
  }
}

// ---------------------------------------------------------------- home
async function home(el, tab) {
  setTitle(tab.label === 'Home' ? app.church_name : tab.label);
  const blocks = app.config.home;
  const needServing = blocks.some((b) => b.type === 'serving') && app.user?.linked;
  const mine = needServing ? await get('/my/schedule').catch(() => null) : null;
  const myTasks = blocks.some((b) => b.type === 'tasks') && app.user && !preview ? await get('/tasks?view=mine').catch(() => []) : [];
  mount(el, html`${installBanner()}${blocks.map((b) => block(b, mine, myTasks)).filter(Boolean).map((x) => html`<div class="m-block">${x}</div>`)}`);
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.done) { await patch(`/tasks/${b.dataset.done}`, { done: true }); toast('Done!'); refreshChatBadge(); return home(el, tab); }
      if (b.dataset.accept) { await patch(`/assignments/${b.dataset.accept}`, { status: 'accepted' }); toast('Thanks for serving!'); home(el, tab); }
      if (b.matches('[data-install-now]')) { await promptInstall(); home(el, tab); }
      if (b.matches('[data-hide-banner]')) { localStorage.setItem('mb.app.banner', '1'); home(el, tab); }
    } catch (err) { fail(err); }
  };
}

function block(b, mine, myTasks = []) {
  if (b.type === 'tasks') {
    if (!myTasks.length) return null;
    return html`<div class="card"><div class="card-head"><h2>My tasks</h2><a class="btn small ghost" href="#/tasks">All</a></div>
      <div class="task-list">${myTasks.slice(0, 4).map((t) => taskRow(t, { showWho: false }))}</div></div>`;
  }
  if (b.type === 'welcome') {
    return html`<div class="m-hero"><small>${app.church_name}</small><h2>${b.title || 'Welcome'}</h2>${b.text ? html`<p>${b.text}</p>` : ''}</div>`;
  }
  if (b.type === 'text') {
    return html`<div class="card m-text">${b.title ? html`<h2 style="margin:0">${b.title}</h2>` : ''}<p>${b.text}</p></div>`;
  }
  if (b.type === 'buttons') {
    return html`<div class="m-buttons">${b.items.map((x, i) => html`<a class="btn ${i === 0 ? 'primary' : ''}" href="${x.url || `#/${x.tab}`}" ${x.url ? raw('target="_blank" rel="noopener"') : ''}>${x.label}</a>`)}</div>`;
  }
  if (b.type === 'times') {
    if (!app.times.length) return null;
    const byCampus = Map.groupBy(app.times, (t) => t.campus_id);
    return html`<div class="card m-times">${b.title ? html`<h2>${b.title}</h2>` : ''}
      ${[...byCampus.values()].map((list) => {
        const c = list[0];
        const byDay = Map.groupBy(list, (t) => t.day_of_week);
        return html`<div class="campus"><b>${c.campus_name}</b>
          ${[...byDay].map(([day, ts]) => html`<div><span class="t">${DAYS[day]}s</span> · ${ts.map((t) => clock(t.start_time)).join(' & ')}</div>`)}
          ${c.address ? html`<a class="small" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon('map', 'ic small-ic')} ${c.address}</a>` : ''}</div>`;
      })}</div>`;
  }
  if (b.type === 'serving') {
    if (!app.user) return html`<a class="card row" href="${signInHref('/serve')}" style="color:inherit;text-decoration:none">${icon('calendar')}<span class="grow" style="margin-right:auto"><b>Serve on a team?</b><br><span class="muted small">Sign in to see when you’re scheduled.</span></span>${icon('external', 'ic small-ic')}</a>`;
    const next = (mine?.assignments || []).filter((a) => a.status !== 'declined').slice(0, 3);
    if (!next.length) return null;
    return html`<div class="card"><div class="card-head"><h2>You’re serving</h2><a class="btn small ghost" href="#/serve">All</a></div>
      ${next.map((a) => html`<div class="m-serving-row"><div class="what"><b>${fmtDate(a.starts_at)}</b> · ${fmtTime(a.starts_at)}<div class="muted small">${a.position} · ${a.campus}</div></div>
        ${a.status === 'pending' ? html`<button class="btn small primary" data-accept="${a.id}">Accept</button>` : html`<a class="btn small ghost" href="#/plan/${a.service_id}">Plan</a>`}</div>`)}</div>`;
  }
  if (b.type === 'watch') {
    const embed = videoEmbed(app.config.watch_url);
    if (!app.config.watch_url) return null;
    return html`<div class="card">${b.title ? html`<h2>${b.title}</h2>` : ''}${embed ? html`<div class="m-video"><iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Livestream"></iframe></div>`
      : html`<a class="btn primary" href="${app.config.watch_url}" target="_blank" rel="noopener">${icon('play')} Watch</a>`}</div>`;
  }
  return null;
}

function installBanner() {
  let hidden = false;
  try { hidden = localStorage.getItem('mb.app.banner') === '1'; } catch { /* ignore */ }
  if (preview || hidden || isInstalled() || !isMobile) return '';
  return html`<div class="m-banner">${icon('phone')}<span class="grow">Add the ${app.church_name} app to your home screen.</span>
    ${canPromptInstall() ? html`<button class="btn small primary" data-install-now>Add</button>` : html`<a class="btn small primary" href="#/more?install=1">How</a>`}
    <button class="icon-btn" data-hide-banner aria-label="Hide">${icon('x')}</button></div>`;
}

// YouTube links become an embedded player; anything else is opened as a link.
function videoEmbed(url) {
  if (!url) return '';
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
  if (host === 'youtube.com') {
    const ch = u.pathname.match(/^\/channel\/([\w-]+)/);
    if (ch) return `https://www.youtube.com/embed/live_stream?channel=${ch[1]}`;
    const live = u.pathname.match(/^\/(?:live|embed)\/([\w-]+)/);
    if (live) return `https://www.youtube.com/embed/${live[1]}`;
    if (u.searchParams.get('v')) return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
  }
  if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`;
  return '';
}

// ---------------------------------------------------------------- serve (sign-in)
async function serve(el, tab, q) {
  setTitle(tab.label);
  if (!app.user) {
    mount(el, html`<div class="card m-big-action">${icon('calendar')}<h2 style="margin:0">See when you’re serving</h2>
      <p class="muted" style="margin:0">Sign in to accept or decline, add dates you’ll be away, and see the order of service.</p>
      <a class="btn primary" href="${signInHref(`/${tab.id}`)}">Sign in</a></div>`);
    return;
  }
  // Two views: my own schedule, or every service (any campus) to look up a plan and who's serving.
  const all = q.get('view') === 'all';
  const switcher = html`<div class="seg m-seg" role="tablist"><a href="#/${tab.id}" class="${all ? '' : 'on'}">My schedule</a><a href="#/${tab.id}?view=all" class="${all ? 'on' : ''}">All services</a></div>`;
  if (all) return allServices(el, tab, switcher);
  if (!app.user.linked) {
    mount(el, html`${switcher}<div class="card"><p>You’re signed in as <b>${app.user.name}</b>, but your account isn’t linked to the church directory yet, so there’s no schedule to show.</p><p class="muted small">Ask a church admin to link your account. You can still look at <a href="#/${tab.id}?view=all">all services</a>.</p></div>`);
    return;
  }
  const decline = q.get('decline');
  if (decline) history.replaceState(null, '', `#/${tab.id}`);
  // Notifications are set up under More; here, just a nudge until they're on.
  const sub = await currentSubscription().catch(() => null);
  const on = sub && 'Notification' in window && Notification.permission === 'granted';
  mount(el, html`${switcher}${on || preview ? '' : html`<a class="m-banner" href="#/more" style="text-decoration:none">${icon('bell')}<span class="grow">Get a notification when you’re scheduled</span>${icon('external', 'ic small-ic')}</a>`}<div data-schedule></div>`);
  await drawSchedule(el.querySelector('[data-schedule]'), { planHref: (a) => `#/plan/${a.service_id}`, decline });
}

// Every service in a month, at one campus or all: a small calendar, then each day's services.
async function allServices(el, tab, switcher) {
  const remembered = (k, fallback) => { try { return sessionStorage.getItem(k) || fallback; } catch { return fallback; } };
  const remember = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private window */ } };
  let month = remembered('mb.app.month', new Date().toLocaleDateString('en-CA').slice(0, 7));
  let campus = Number(remembered('mb.app.campus', '')) || null;
  const today = new Date().toLocaleDateString('en-CA');

  async function draw() {
    const first = `${month}-01`;
    const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const last = `${month}-${String(days).padStart(2, '0')}`;
    const list = (await get(`/services?all=1&from=${first < today && month === today.slice(0, 7) ? today : first}&to=${last}${campus ? `&campus_id=${campus}` : ''}`));
    const byDay = Map.groupBy(list, (x) => x.starts_at.slice(0, 10));
    const label = new Date(`${first}T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const lead = new Date(`${first}T12:00`).getDay();
    const status = (x) => (x.my_status === 'pending' ? html`<span class="pill warn">Please reply</span>` : x.my_status === 'accepted' ? html`<span class="pill good">You’re serving</span>` : '');
    mount(el, html`${switcher}
      <div class="card m-cal-card">
        <div class="row"><button class="btn small ghost" data-shift="-1" aria-label="Previous month">‹</button><b class="m-cal-title">${label}</b><button class="btn small ghost" data-shift="1" aria-label="Next month">›</button></div>
        ${app.campuses.length > 1 ? html`<div class="m-chips">${[{ id: null, short_name: 'All' }, ...app.campuses].map((c) => html`<button class="chip ${campus === c.id ? 'on' : ''}" data-campus="${c.id ?? ''}">${c.short_name || c.name}</button>`)}</div>` : ''}
        <div class="m-cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => html`<span class="dow">${d}</span>`)}
          ${Array.from({ length: lead }, () => html`<span></span>`)}
          ${Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, '0')}`;
            const has = byDay.get(day);
            const mine = has?.some((x) => x.my_status && x.my_status !== 'declined');
            return html`<button class="day ${has ? 'has' : ''} ${mine ? 'mine' : ''} ${day === today ? 'today' : ''}" ${has ? '' : 'disabled'} data-day="${day}">${i + 1}</button>`;
          })}</div>
      </div>
      ${list.length ? [...byDay].map(([day, rows]) => html`<div class="m-day" id="d-${day}"><h3>${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        <div class="card m-list">${rows.map((x) => html`<a href="#/plan/${x.id}?from=all"><span class="m-svc-time">${fmtTime(x.starts_at)}</span>
          <span class="grow"><b>${x.campus_short || x.campus_name}</b>${x.title || x.series ? html`<br><span class="muted small">${[x.title, x.series].filter(Boolean).join(' · ')}</span>` : ''}</span>${status(x)}</a>`)}</div></div>`)
        : html`<div class="m-empty">${icon('calendar')}<p>No services ${campus ? 'at this campus ' : ''}in ${label}.</p></div>`}`);
  }

  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.shift) {
      const d = new Date(`${month}-15T12:00`);
      d.setMonth(d.getMonth() + Number(b.dataset.shift));
      month = d.toLocaleDateString('en-CA').slice(0, 7);
      remember('mb.app.month', month);
      draw().catch(fail);
    } else if (b.dataset.campus !== undefined) {
      campus = Number(b.dataset.campus) || null;
      remember('mb.app.campus', campus ?? '');
      draw().catch(fail);
    } else if (b.dataset.day) {
      el.querySelector(`#d-${b.dataset.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  await draw();
}

// One service: tabs for the order of service and who's serving (the last choice is remembered),
// with the signed-in person's own spot shown first.
async function plan(el, id, q) {
  setTitle('Service', html`<a class="btn small ghost" href="${q?.get('from') === 'all' ? '#/serve?view=all' : '#/serve'}">Back</a>`);
  const s = await get(`/services/${id}`);
  const times = timeline(s.items, s.starts_at);
  const fmt = (m) => new Date(2000, 0, 1, 0, Math.round(m)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const serving = s.positions.filter((p) => p.assignments.some((a) => a.status !== 'declined'));
  const teams = [...Map.groupBy(serving, (p) => p.team_id).values()].map((ps) => ({ id: ps[0].team_id, name: ps[0].team_name, color: ps[0].team_color, positions: ps }));
  const me = app.user?.person_id;
  const mine = serving.filter((p) => p.assignments.some((a) => a.person_id === me && a.status !== 'declined'));
  const saved = (k, fallback) => { try { return localStorage.getItem(k) || fallback; } catch { return fallback; } };
  let view = saved('mb.app.planTab', 'plan');
  let team = null; // team filter on Who's serving

  function draw() {
    try { localStorage.setItem('mb.app.planTab', view); } catch { /* private window */ }
    const shown = team ? teams.filter((t) => t.id === team) : teams;
    mount(el, html`<div class="card"><h2 style="margin:0">${fmtDate(s.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <div class="muted">${fmtTime(s.starts_at)} · ${s.campus.name}${s.title ? ` · ${s.title}` : ''}</div>
        ${s.notes ? html`<p class="small" style="white-space:pre-line">${s.notes}</p>` : ''}
        ${mine.length ? html`<div class="m-banner" style="margin:12px 0 0">${icon('check')}<span class="grow">You’re serving: <b>${mine.map((p) => p.name).join(', ')}</b></span></div>` : ''}</div>
      <div class="seg m-seg" role="tablist"><a href="#" role="tab" data-view="plan" class="${view === 'plan' ? 'on' : ''}">Order of service</a><a href="#" role="tab" data-view="team" class="${view === 'team' ? 'on' : ''}">Who’s serving</a></div>
      ${view === 'plan'
        ? html`<div class="card">${s.items.length ? s.items.map((i, n) => (i.kind === 'header'
          ? html`<div class="m-plan-row section">${i.title}</div>`
          : html`<div class="m-plan-row"><span class="when">${fmt(times[n].from)}</span><div><b>${i.title || 'Item'}</b>${i.song_key ? html` <span class="pill">${i.song_key}</span>` : ''}
              ${i.first_name || i.info ? html`<div class="muted small">${[i.first_name ? displayName(i) : '', i.info].filter(Boolean).join(', ')}</div>` : ''}
              ${i.notes ? html`<div class="details">${i.notes}</div>` : ''}</div></div>`))
          : html`<p class="muted" style="margin:0">The order of service isn’t ready yet.</p>`}</div>`
        : html`${teams.length > 1 ? html`<div class="m-chips" style="margin:0 0 10px">${[{ id: null, name: 'All teams' }, ...teams].map((t) => html`<button class="chip ${team === t.id ? 'on' : ''}" data-team="${t.id ?? ''}">${t.color ? html`<span class="dot" style="background:${t.color}"></span> ` : ''}${t.name}</button>`)}</div>` : ''}
          <div class="card">${shown.length ? shown.map((t) => html`<div class="m-team">
            <div class="m-team-name"><span class="dot" style="background:${t.color}"></span>${t.name}</div>
            ${t.positions.map((p) => html`<div class="small m-pos"><b>${p.name}</b> <span class="muted">· ${p.assignments.filter((a) => a.status !== 'declined').map((a) => (a.person_id === me ? html`<b class="is-me">${displayName(a)} (you)</b>` : displayName(a)))
              .reduce((acc, x, i) => (i ? html`${acc}, ${x}` : x), '')}</span></div>`)}</div>`)
          : html`<p class="muted small" style="margin:0">No one has been scheduled yet.</p>`}</div>`}`);
  }

  el.onclick = (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { e.preventDefault(); view = v.dataset.view; return draw(); }
    const t = e.target.closest('[data-team]');
    if (t) { team = Number(t.dataset.team) || null; draw(); }
  };
  draw();
}

// ---------------------------------------------------------------- watch, give, page, link
function watch(el, tab) {
  setTitle(tab.label);
  const url = app.config.watch_url;
  const embed = videoEmbed(url);
  mount(el, url
    ? html`${embed ? html`<div class="m-video"><iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Livestream"></iframe></div>` : ''}
      <div class="card m-big-action" style="margin-top:14px">${icon('play')}<p class="muted" style="margin:0">${embed ? 'Not live right now? Catch up on past services there.' : 'Watch our services online.'}</p>
        <a class="btn ${embed ? '' : 'primary'}" href="${url}" target="_blank" rel="noopener">Open ${embed ? 'the channel' : 'the livestream'} ${icon('external')}</a></div>`
    : html`<div class="m-empty">${icon('play')}<p>The livestream isn’t set up yet.</p></div>`);
}

function give(el, tab) {
  setTitle(tab.label);
  const url = app.config.give_url;
  mount(el, url
    ? html`<div class="card m-big-action">${icon('heart')}<h2 style="margin:0">Thank you for your generosity</h2>
        <p class="muted" style="margin:0">Give securely online, one time or recurring.</p>
        <a class="btn primary" href="${url}" target="_blank" rel="noopener">Give now ${icon('external')}</a></div>`
    : html`<div class="m-empty">${icon('heart')}<p>Online giving isn’t set up yet.</p></div>`);
}

function page(el, tab) {
  setTitle(tab.label);
  mount(el, html`<div class="card m-text">${tab.title ? html`<h2 style="margin:0">${tab.title}</h2>` : ''}<p>${tab.body || ''}</p></div>`);
}

function link(el, tab) {
  setTitle(tab.label);
  mount(el, html`<div class="card m-big-action">${icon(tab.icon)}<a class="btn primary" href="${tab.url}" target="_blank" rel="noopener">Open ${tab.label} ${icon('external')}</a></div>`);
}

// ---------------------------------------------------------------- connect card
function connect(el, tab) {
  setTitle(tab.label);
  const c = app.config.connect;
  const camps = app.campuses;
  mount(el, html`<form class="card m-form" autocomplete="on">
    <h2 style="margin:0 0 4px">${c.title}</h2>${c.intro ? html`<p class="muted" style="margin:0 0 14px">${c.intro}</p>` : ''}
    <div class="form">
      <label class="field">First name<input type="text" name="first_name" required autocomplete="given-name"></label>
      <label class="field">Last name<input type="text" name="last_name" autocomplete="family-name"></label>
      <label class="field">Email<input type="email" name="email" autocomplete="email"></label>
      <label class="field">Phone<input type="tel" name="phone" autocomplete="tel"></label>
      ${camps.length > 1 ? html`<label class="field wide">Campus<select name="campus_id">${camps.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>` : ''}
    </div>
    <label class="check"><input type="checkbox" name="first_time"> This is my first time here</label>
    ${c.interests.length ? html`<p style="margin:14px 0 0"><b>I’m interested in…</b></p><div class="checks">${c.interests.map((x) => html`<label class="check"><input type="checkbox" name="interest" value="${x}"> ${x}</label>`)}</div>` : ''}
    <label class="field">Prayer request or question (optional)<textarea name="message" rows="3"></textarea></label>
    <input class="m-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn primary" style="width:100%;min-height:48px;justify-content:center">Send</button>
  </form>`);
  const f = el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (preview) return toast('This is a preview.');
    const body = {
      first_name: f.first_name.value, last_name: f.last_name.value, email: f.email.value, phone: f.phone.value,
      campus_id: f.campus_id?.value || camps[0]?.id, first_time: f.first_time.checked, message: f.message.value, website: f.website.value,
      interests: [...f.querySelectorAll('[name=interest]:checked')].map((x) => x.value),
    };
    try {
      await post('/public/connect', body);
      mount(el, html`<div class="card m-big-action">${icon('check')}<h2 style="margin:0">Thank you, ${body.first_name}!</h2><p class="muted" style="margin:0">Someone from our team will be in touch soon.</p><a class="btn" href="#/">Back home</a></div>`);
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- more
async function more(el, tab, q) {
  setTitle(tab.label);
  const extra = app.config.tabs.filter((t) => !t.on && t.type !== 'more' && ['page', 'link', 'watch', 'give', 'connect'].includes(t.type));
  const share = html`<svg class="share-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
  const showInstall = !isInstalled() && (isMobile || q.get('install'));
  mount(el, html`<div class="card">${app.user
      ? html`<div class="row"><b>${app.user.name}</b><span class="spacer"></span><button class="btn small ghost" data-logout>Sign out</button></div>`
      : html`<div class="row"><span>Signed out</span><span class="spacer"></span><a class="btn small primary" href="${signInHref('/more')}">Sign in</a></div>`}</div>
    ${showInstall ? html`<div class="card"><h2>Get the app</h2>${isIOS
      ? html`<ol class="steps-inline small"><li>Open this page in <b>Safari</b>.</li><li>Tap the Share button ${share}.</li><li>Choose <b>Add to Home Screen</b>.</li></ol>`
      : canPromptInstall() ? html`<button class="btn primary" data-install>${icon('phone')} Add to home screen</button>`
        : html`<p class="small" style="margin:0">Open your browser’s menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>` : ''}
    ${app.user ? html`<div class="card app-card" data-notify></div>` : ''}
    <div class="card m-list">
      ${app.user ? html`<a href="#/inbox">${icon('bell')}<span class="grow">Notifications</span></a>` : ''}
      ${app.user && !chatTab()?.on ? html`<a href="#/chat">${icon('chat')}<span class="grow">Chat</span><span class="nav-badge hidden" data-badge="chat"></span></a>` : ''}
      ${app.user && !tasksTab()?.on ? html`<a href="#/tasks">${icon('check')}<span class="grow">Tasks</span><span class="nav-badge hidden" data-badge="tasks"></span></a>` : ''}
      ${extra.map((t) => html`<a href="${t.type === 'link' ? t.url : `#/${t.id}`}" ${t.type === 'link' ? raw('target="_blank" rel="noopener"') : ''}>${icon(t.icon)}<span class="grow">${t.label}</span></a>`)}
      ${app.campuses.filter((c) => c.address).map((c) => html`<a href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon('map')}<span class="grow">${c.name}<br><span class="muted small">${c.address}</span></span></a>`)}
      ${app.user ? html`<button data-theme-cycle>${icon('settings')}<span class="grow">Appearance</span><span class="muted small">${{ light: 'Light', dark: 'Dark', device: 'Match my device' }[document.documentElement.dataset.theme] || 'Light'}</span></button>` : ''}
      ${atLeast('leader') ? html`<a href="${app.hub_url ? `${app.hub_url}/` : '/'}">${icon('external')}<span class="grow">Staff dashboard</span></a>` : ''}
    </div>`);
  if (app.user) drawNotifyCard(el.querySelector('[data-notify]'), { ui: 'app', role: app.user.role }).catch(() => {});
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-logout]')) {
      await fetch('/auth/logout', { method: 'POST', headers: { 'x-mb': '1' } }).catch(() => {});
      location.href = '/app/';
    }
    if (b.matches('[data-install]')) { await promptInstall(); more(el, tab, q); }
    if (b.matches('[data-theme-cycle]')) {
      const order = ['light', 'dark', 'device'];
      const next = order[(order.indexOf(document.documentElement.dataset.theme) + 1) % 3];
      app.user.theme = next;
      applyTheme();
      patch('/me', { theme: next }).catch(fail);
      more(el, tab, q);
    }
  };
}

// ---------------------------------------------------------------- tasks
async function tasks(el, tab, id, q) {
  if (!app.user) {
    setTitle(tab.label);
    mount(el, html`<div class="card m-big-action">${icon('check')}<h2 style="margin:0">Your tasks</h2>
      <p class="muted" style="margin:0">Sign in to see tasks your team gives you, and keep your own.</p>
      <a class="btn primary" href="${signInHref('/tasks')}">Sign in</a></div>`);
    return;
  }
  if (id) return taskPage(el, id, { setTitle, q, me: app.user.person_id, onChange: refreshChatBadge });
  return taskList(el, { setTitle, q, onChange: refreshChatBadge });
}

// ---------------------------------------------------------------- chat
async function chat(el, tab, id) {
  if (!app.user) {
    setTitle(tab.label);
    mount(el, html`<div class="card m-big-action">${icon('chat')}<h2 style="margin:0">Chat with your team</h2>
      <p class="muted" style="margin:0">Sign in to message the teams you serve on.</p>
      <a class="btn primary" href="${signInHref('/chat')}">Sign in</a></div>`);
    return;
  }
  await openChat(el, { id: id ? Number(id) : null, split: false, setTitle, onUnread: refreshChatBadge });
}

// ---------------------------------------------------------------- notifications
function headerButtons() {
  return app.user && !preview ? html`<a class="icon-btn bell" href="#/inbox" aria-label="Notifications">${icon('bell')}</a><a class="icon-btn m-chat-btn" href="#/chat" aria-label="Chat">${icon('chat')}<span class="nav-badge hidden" data-badge="chat"></span></a>` : '';
}

async function inbox(el) {
  setTitle('Notifications');
  const d = await get('/notifications');
  mount(el, d.items.length ? html`<div class="card m-list">${d.items.map((n) => html`<a href="${n.app_url || '#/'}" data-note="${n.id}" style="${n.read_at ? '' : 'font-weight:600'}"><span class="grow">${n.title}<br><span class="muted small" style="font-weight:400">${n.body}</span></span></a>`)}</div>`
    : html`<div class="m-empty">${icon('bell')}<p>Nothing yet.</p></div>`);
  if (d.unread) post('/notifications/read', {}).catch(() => {});
}

const PAGES = { home, serve, watch, give, connect, page, link, more, chat: (el, tab) => chat(el, tab), tasks: (el, tab, q) => tasks(el, tab, null, q) };

boot().catch((e) => { document.body.textContent = e.message; });
