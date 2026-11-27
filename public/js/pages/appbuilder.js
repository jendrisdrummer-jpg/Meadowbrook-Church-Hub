// App Builder: choose the member app's tabs and home screen, with a live phone preview.
import { get, put, api, html, raw, mount, icon, options, toast, fail, chips, confirm, shrinkImage } from '../lib.js';
import { setTitle } from '../app.js';
import { WIDGETS, SIZES, STYLES, ICONS, MAX_LINKS, DEFAULT_APP, linkableTab } from '../app-widgets.js';

// [short name, what it does]. The long text sits behind a small "?" so rows stay short on a phone.
const TAB_INFO = {
  home: ['Home screen', 'The widgets you arrange below. Always on.'],
  events: ['Events', 'Everything coming up, from Events in the hub, on a calendar with service times. People sign up and pay right in the app.'],
  serve: ['Serving', 'Sign in to see your schedule, accept or decline, and add dates away.'],
  watch: ['Watch', 'Past messages from Media (search, speaker, series, topic), and the livestream when you’re live.'],
  give: ['Give', 'Opens your online giving page.'],
  connect: ['Connect card', 'Guests tell you they were here. Cards arrive under Connect cards.'],
  chat: ['Chat', 'Team chats and groups, for signed-in volunteers. Always reachable from the chat button at the top too.'],
  tasks: ['Tasks', 'Tasks people are given (and their own), with due dates and checklists. Also under More.'],
  page: ['Page', 'Your own text: beliefs, next steps, staff, anything.'],
  link: ['Link', 'Opens any website: events, sermons, small groups sign-up…'],
  more: ['More', 'Account, notifications, appearance, campuses. Always last and always on.'],
};
const WIDGET_ICON = { countdown: 'clock', events: 'calendar', button: 'link', image: 'image', welcome: 'home', serving: 'calendar', thisweek: 'clock', tasks: 'tasks', times: 'clock', watch: 'play', sermon: 'video', text: 'edit', announcement: 'bell', linklist: 'menu' };
const MAX_TABS = 5;

// What this widget is called in the list: the words on it, or its kind when it has none.
const customName = (w) => (w.type === 'button' ? w.label : w.title) || '';
const widgetName = (w) => customName(w) || WIDGETS[w.type].label;

const SELECTED = { id: null, count: 0 };
let CAMPUSES = [];
let TARGETS = []; // the tabs a button or link can open

const getAt = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const targetValue = (o) => (o.url !== undefined ? '__url' : o.tab || '');
const needsTarget = (o, optional) => !optional && o.url === undefined && !o.tab;

// "Opens…" choice for a button, picture, announcement or one link in a list. `path` says where the
// thing lives in the settings (e.g. home.2 or home.4.links.1). optional: it may open nothing.
function targetField(path, o, { optional = '', label = 'Opens' } = {}) {
  const emptyUrl = o.url === '';
  return html`<label class="field">${label}<select data-link="${path}">${options([
    ...(optional ? [{ value: '', label: optional }] : needsTarget(o) ? [{ value: '', label: 'Choose where it opens…' }] : []),
    ...TARGETS, { value: 'giving', label: 'My giving' }, { value: '__url', label: 'A website…' }], targetValue(o))}</select></label>
    ${o.url !== undefined ? html`<input type="url" data-k="${path}.url" value="${o.url}" placeholder="https://…" aria-label="Website" class="${emptyUrl ? 'bad' : ''}"><p class="b-hint" data-hint ${emptyUrl ? '' : 'hidden'}>Add a website</p>` : ''}
    ${needsTarget(o) ? html`<p class="b-hint">Choose where it opens</p>` : ''}`;
}

// One home screen widget in the list; the selected one opens to show its settings.
function widgetRow(w, i) {
  const d = WIDGETS[w.type];
  const k = (f) => `home.${i}.${f}`;
  const size = SIZES[w.size];
  const named = customName(w);
  return html`<div class="w-row ${w.id === SELECTED.id ? 'on' : ''}" data-row="${w.id}">
    <button type="button" class="w-row-head" data-pick="${w.id}">${icon(WIDGET_ICON[w.type])}<span class="grow"><b>${widgetName(w)}</b> <span class="muted small">${named ? `${d.label} · ` : ''}${size?.label || ''}</span></span>${icon('down', 'ic small-ic')}</button>
    ${w.id === SELECTED.id ? html`<div class="w-row-body">
      <div class="field"><span>Size</span><div class="seg w-sizes">${d.sizes.map((sz) => html`<button type="button" class="${w.size === sz ? 'on' : ''}" data-size="${i}:${sz}" title="${SIZES[sz].plain}">${sizeIcon(sz)}<span>${SIZES[sz].label}</span></button>`)}</div>
        <p class="muted small" style="margin:6px 0 0">${size?.plain || ''}</p></div>
      <div class="field"><span>Look</span><div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(STYLES).map(([st, label]) => html`<button type="button" class="chip ${w.style === st ? 'on' : ''}" data-style="${i}:${st}">${label}</button>`)}
        ${w.style === 'color' ? html`<input type="color" data-k="${k('color')}" value="${w.color || '#135fd1'}" aria-label="Color" class="w-color">` : ''}</div></div>
      ${d.image ? html`<div class="field"><span>Picture${w.type === 'image' ? '' : ' (optional, shows behind the words)'}</span><div class="row" style="gap:8px">
        ${w.image ? html`<img src="${w.image}" alt="" class="w-thumb"><button type="button" class="btn small ghost" data-unimage="${i}">Remove</button>` : ''}
        <label class="btn small">${icon('upload')} ${w.image ? 'Replace' : 'Upload'}<input type="file" accept="image/*" data-image="${i}" hidden></label></div></div>` : ''}
      ${d.fields.includes('label') ? html`<label class="field">Button text<input type="text" data-k="${k('label')}" value="${w.label || ''}" maxlength="30"></label>` : ''}
      ${d.fields.includes('icon') ? html`<div class="field"><span>Icon</span>${iconPicker(`data-icon="${i}:`, w.icon)}</div>` : ''}
      ${d.fields.includes('campus') && CAMPUSES.length > 1 ? html`<label class="field">Campus<select data-campus="${i}">${options([{ value: '', label: 'Any campus (the soonest)' }, ...CAMPUSES.map((c) => ({ value: c.id, label: c.name }))], w.campus_id ?? '')}</select></label>` : ''}
      ${d.fields.includes('title') ? html`<label class="field">${{ image: 'Caption (optional)', countdown: 'Heading (optional)', announcement: 'Headline' }[w.type] || 'Heading'}<input type="text" data-k="${k('title')}" value="${w.title || ''}" maxlength="${w.type === 'announcement' ? 80 : 120}"></label>` : ''}
      ${d.fields.includes('text') ? html`<label class="field">Text<textarea data-k="${k('text')}" rows="3" maxlength="${w.type === 'announcement' ? 300 : 4000}">${w.text || ''}</textarea></label>` : ''}
      ${d.fields.includes('link') ? targetField(`home.${i}`, w, { optional: w.type === 'image' ? 'Nothing (just a picture)' : w.type === 'announcement' ? 'Nothing (just show it)' : '' }) : ''}
      ${d.fields.includes('ends') ? html`<label class="field">Hide after<input type="date" data-k="${k('ends')}" value="${w.ends || ''}"><span class="muted small">Optional. It stays up through this day and hides itself the day after.</span></label>` : ''}
      ${d.fields.includes('links') ? html`<div class="field"><span>Links (${(w.links || []).length} of ${MAX_LINKS})</span>
        ${(w.links || []).map((x, j) => html`<div class="b-ll"><div class="row" style="gap:6px"><input type="text" data-k="${k(`links.${j}.label`)}" value="${x.label || ''}" maxlength="40" placeholder="Link text" aria-label="Link text"><button type="button" class="icon-btn danger" data-del-link="${i}:${j}" aria-label="Remove this link">${icon('trash')}</button></div>
          ${targetField(k(`links.${j}`), x)}</div>`)}
        <button type="button" class="btn small" data-add-link="${i}" ${(w.links || []).length >= MAX_LINKS ? 'disabled' : ''}>${icon('plus')} ${(w.links || []).length >= MAX_LINKS ? `${MAX_LINKS} of ${MAX_LINKS} links` : 'Add a link'}</button></div>` : ''}
      <p class="muted small" style="margin:0">${d.hint}</p>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" class="btn small ghost" data-up="home:${i}" ${i === 0 ? 'disabled' : ''}>↑ Earlier</button><button type="button" class="btn small ghost" data-down="home:${i}" ${i === SELECTED.count - 1 ? 'disabled' : ''}>↓ Later</button>
        <span class="grow"></span><button type="button" class="btn small ghost" data-dup="${i}">${icon('copy')} Duplicate</button><button type="button" class="btn small ghost danger" data-del="home:${i}">${icon('trash')} Remove</button></div>
    </div>` : ''}</div>`;
}

// A grid of icons to choose from; `attr` is the start of a data attribute (the choice is appended).
function iconPicker(attr, current) {
  return html`<div class="w-icons">${ICONS.map((x) => html`<button type="button" class="${current === x ? 'on' : ''}" ${raw(`${attr}${x}"`)} title="${x}" aria-label="${x}">${icon(x)}</button>`)}</div>`;
}

// A tiny drawing of a size on the four-wide grid.
function sizeIcon(sz) {
  const s = SIZES[sz];
  return html`<svg viewBox="0 0 28 16" class="w-size-ic" aria-hidden="true"><rect x="0.5" y="0.5" width="27" height="15" rx="2" fill="none" stroke="currentColor" opacity=".3"/><rect x="1.5" y="1.5" width="${s.w * 6.25}" height="${s.h ? s.h * 6.5 : 13}" rx="1.5" fill="currentColor"/></svg>`;
}

// Asks for a picture before adding a Picture widget.
function pickFile() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export default async function appBuilder(el) {
  const [{ config, campuses }, settings] = await Promise.all([get('/app/config'), get('/settings')]);
  CAMPUSES = campuses || [];
  let cfg = structuredClone(config);
  let dirty = false;
  let selected = null; // the home screen widget being edited
  let previewAs = 'me'; // or 'guest': the signed-out view, drawn by the preview alone
  const appUrl = settings.app_url.startsWith('http') ? settings.app_url : new URL(settings.app_url, location.origin).href;
  const frameSrc = () => `/app/?preview=${previewAs === 'guest' ? 'guest' : '1'}&edit=1`;

  setTitle('App Builder', html`<a class="btn ghost b-wide-only" href="${appUrl}" target="_blank" rel="noopener">${icon('external')} Open the app</a><button class="btn b-narrow-only" data-preview-open>${icon('phone')} Preview</button><button class="btn primary" data-save>Save changes</button>`);
  mount(el, html`<p class="muted" style="margin-top:-6px">Your church app is at <a href="${appUrl}" target="_blank" rel="noopener"><b>${appUrl.replace(/^https?:\/\//, '')}</b></a>. Anyone can use it; signing in adds serving schedules and notifications. Changes show in the preview straight away and reach everyone when you save.</p>
    <div class="b-tools"><span class="muted small" data-state></span><span class="grow"></span>
      <button type="button" class="btn small ghost" data-discard>Discard changes</button><button type="button" class="btn small ghost" data-reset>Reset to starting layout</button></div>
    <div class="builder"><div class="builder-edit" data-edit></div>
      <div class="builder-phone" data-phone><div class="b-sheet-head"><b>Preview</b><button type="button" class="btn small" data-preview-close>${icon('x')} Close</button></div>
        <div class="seg b-as" role="group" aria-label="Preview as"><button type="button" class="on" data-as="me">Me</button><button type="button" data-as="guest">A guest</button></div>
        <div class="phone"><iframe src="${frameSrc()}" title="App preview" data-preview></iframe></div>
        <p class="muted small" style="text-align:center">On the home screen, drag widgets to move them and drag a corner to resize. Tap one to change it.</p></div></div>`);
  const frame = el.querySelector('[data-preview]');
  const phone = el.querySelector('[data-phone]');
  const sendPreview = () => frame.contentWindow?.postMessage({ type: 'app-config', config: cfg, selected, keepScroll: true }, location.origin);
  frame.addEventListener('load', sendPreview);
  const updateTools = () => {
    el.querySelector('[data-state]').textContent = dirty ? 'You have changes that aren’t saved yet.' : 'Everything is saved.';
    el.querySelector('[data-discard]').disabled = !dirty;
  };
  const changed = (redraw = false) => { dirty = true; updateTools(); sendPreview(); if (redraw) draw(); };
  // The preview tells us when a widget is tapped, moved or resized on the phone.
  const onMessage = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'app-ready') sendPreview();
    if (e.data?.type === 'app-select') { selected = e.data.id; sendPreview(); draw(); scrollToWidget(); }
    if (e.data?.type === 'app-home') { cfg.home = e.data.home; selected = e.data.select ?? selected; changed(true); }
  };
  window.addEventListener('message', onMessage);
  const scrollToWidget = () => box.querySelector('.w-row.on')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // On a phone the preview opens full screen instead of sitting at the bottom of a long page.
  const sheet = (open) => { phone.classList.toggle('b-sheet-open', open); if (open) setTimeout(sendPreview, 50); };
  const onKey = (e) => { if (e.key === 'Escape') sheet(false); };
  document.addEventListener('keydown', onKey);
  document.querySelector('[data-actions] [data-preview-open]').onclick = () => sheet(true);
  phone.querySelector('[data-preview-close]').onclick = () => sheet(false);
  phone.querySelector('.b-as').addEventListener('click', (e) => {
    const b = e.target.closest('[data-as]');
    if (!b || b.dataset.as === previewAs) return;
    previewAs = b.dataset.as;
    phone.querySelectorAll('[data-as]').forEach((x) => x.classList.toggle('on', x.dataset.as === previewAs));
    frame.src = frameSrc();
  });

  // Buttons and links that open a tab (so removing the tab can clear them first).
  const refsTo = (tabId) => cfg.home.reduce((n, w) => n + (w.tab === tabId ? 1 : 0) + (w.links || []).filter((x) => x.tab === tabId).length, 0);
  const clearRefs = (tabId) => cfg.home.forEach((w) => { if (w.tab === tabId) delete w.tab; (w.links || []).forEach((x) => { if (x.tab === tabId) delete x.tab; }); });
  const refsText = (n) => (n === 1 ? '1 button or link opens this tab' : `${n} buttons and links open this tab`);
  // A tab that stops being a place to go (removed, or a Page switched off): its buttons stop opening it.
  const checkDead = () => cfg.home.forEach((w) => {
    if (w.tab && !linkableTab(cfg.tabs, w.tab)) delete w.tab;
    (w.links || []).forEach((x) => { if (x.tab && !linkableTab(cfg.tabs, x.tab)) delete x.tab; });
  });

  const box = el.querySelector('[data-edit]');
  function draw() {
    SELECTED.id = selected;
    SELECTED.count = cfg.home.length;
    cfg.home.forEach((w) => { if (w.type === 'linklist') w.links ||= []; });
    const onCount = cfg.tabs.filter((t) => t.on).length;
    const full = onCount >= MAX_TABS;
    TARGETS = cfg.tabs.filter((t) => linkableTab(cfg.tabs, t.id)).map((t) => ({ value: t.id, label: `${t.label} tab` }));
    mount(box, html`
      <div class="card"><div class="card-head"><h2>Tabs</h2><span class="b-count ${full ? 'full' : ''}">${onCount} of ${MAX_TABS} tabs${full ? ', the bar is full' : ''}</span>
          <button class="btn small" data-add-tab="page">${icon('plus')} Page</button><button class="btn small" data-add-tab="link">${icon('plus')} Link</button></div>
        ${cfg.tabs.map((t, i) => html`<div class="b-row ${t.on ? '' : 'off'}">
          <div class="b-move">${t.type !== 'more' ? html`<button type="button" class="icon-btn" data-up="tabs:${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-down="tabs:${i}" ${i >= cfg.tabs.length - 2 ? 'disabled' : ''} aria-label="Move down">↓</button>` : ''}</div>
          <details class="b-icon"><summary title="Icon" aria-label="Icon: ${t.icon}"><span class="b-icon-preview">${icon(t.icon)}</span>${icon('down', 'ic small-ic')}</summary>
            ${iconPicker(`data-tabicon="${i}:`, t.icon)}</details>
          <div class="b-main"><input type="text" data-k="tabs.${i}.label" value="${t.label}" maxlength="20" aria-label="Tab name">
            <div class="muted small b-kind">${TAB_INFO[t.type][0]}<details class="b-help"><summary aria-label="What is this?">?</summary><p>${TAB_INFO[t.type][1]}</p></details></div>
            ${t.type === 'link' ? html`<input type="url" data-k="tabs.${i}.url" value="${t.url || ''}" placeholder="https://…" aria-label="Link" class="${t.url ? '' : 'bad'}"><p class="b-hint" data-hint ${t.url ? 'hidden' : ''}>Add a website</p>` : ''}
            ${t.type === 'page' ? html`<input type="text" data-k="tabs.${i}.title" value="${t.title || ''}" placeholder="Page heading"><textarea data-k="tabs.${i}.body" rows="4" placeholder="What the page says">${t.body || ''}</textarea>` : ''}
          </div>
          ${['more', 'home'].includes(t.type) ? html`<span class="muted small b-on">Always on</span>` : html`<label class="check small b-on"><input type="checkbox" data-k="tabs.${i}.on" ${t.on ? 'checked' : ''} ${!t.on && full ? 'disabled' : ''} ${!t.on && full ? raw('title="The bottom bar is full. Turn another tab off first."') : ''}> On</label>`}
          ${['page', 'link'].includes(t.type) ? html`<button type="button" class="icon-btn danger b-del" data-del="tabs:${i}" title="Remove" aria-label="Remove this tab">${icon('trash')}</button>` : html`<span class="b-del-gap"></span>`}
        </div>`)}
        <p class="muted small" style="margin:8px 0 0">Tabs that are off still appear in the app’s More tab, so pages and links can live there.</p></div>

      <div class="card" data-home><div class="card-head"><h2>Home screen</h2><span class="muted small">${cfg.home.length} widget${cfg.home.length === 1 ? '' : 's'}</span></div>
        <p class="muted small" style="margin:0 0 10px">Widgets sit on a grid four squares wide. Drag them around on the phone, drag a corner to make one bigger or smaller, and tap one to change it here.</p>
        <div class="w-add">${Object.entries(WIDGETS).map(([k, d]) => html`<button type="button" class="w-add-btn" data-add-widget="${k}" title="${d.hint}">${icon(WIDGET_ICON[k])}<span>${d.label}</span></button>`)}</div>
        <div class="w-rows">${cfg.home.map((w, i) => widgetRow(w, i))}</div>
        ${!cfg.home.length ? html`<p class="muted">Add widgets to build the home screen.</p>` : ''}</div>

      <div class="card"><h2>Links</h2><div class="form">
        <label class="field wide">Livestream<input type="url" data-k="watch_url" value="${cfg.watch_url}" placeholder="https://www.youtube.com/@yourchurch/live or a channel link">
          <span class="muted small">Once Media in the hub has your channel, Watch shows the library and goes live on its own; this link is used until then. A YouTube channel link (youtube.com/channel/…) shows your live service whenever you’re live.</span></label>
        <label class="field wide">Online giving<input type="url" data-k="give_url" value="${cfg.give_url}" placeholder="Your Subsplash or other giving page">
          <span class="muted small">Give opens this page. Built-in giving can replace it later.</span></label></div></div>

      <div class="card"><h2>Connect card</h2><div class="form">
        <label class="field wide">Heading<input type="text" data-k="connect.title" value="${cfg.connect.title}"></label>
        <label class="field wide">Intro<textarea data-k="connect.intro" rows="2">${cfg.connect.intro}</textarea></label></div>
        <p class="small" style="margin:12px 0 6px"><b>“I’m interested in…” choices</b></p><div data-interests></div></div>`);
    chips(box.querySelector('[data-interests]'), cfg.connect.interests, (list) => { cfg.connect.interests = [...list]; changed(); }, { placeholder: 'e.g. Baptism', addLabel: 'Add' });
  }

  const setPath = (path, value) => {
    const keys = path.split('.');
    const o = keys.slice(0, -1).reduce((x, k) => x[k], cfg);
    o[keys.at(-1)] = value;
  };

  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.type === 'checkbox') return;
    setPath(k, e.target.value);
    // A website box shows its red hint until something is typed, without redrawing (and losing the cursor).
    if (e.target.type === 'url' && e.target.nextElementSibling?.dataset.hint !== undefined) {
      e.target.classList.toggle('bad', !e.target.value.trim());
      e.target.nextElementSibling.hidden = Boolean(e.target.value.trim());
    }
    changed(e.target.tagName === 'SELECT');
  });
  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.k && t.type === 'checkbox') {
      if (t.checked && cfg.tabs.filter((x) => x.on).length >= MAX_TABS) { t.checked = false; return toast(`Only ${MAX_TABS} tabs fit along the bottom of a phone. Turn one off first.`, 'bad'); }
      const tab = getAt(cfg, t.dataset.k.replace(/\.on$/, ''));
      const n = !t.checked && tab.type === 'page' ? refsTo(tab.id) : 0;
      if (n && !(await confirm(`Turn off “${tab.label}”?`, `${refsText(n)}. Once it’s off, they won’t open anything until you choose a new place for them.`, 'Turn off', { danger: false }))) { t.checked = true; return; }
      setPath(t.dataset.k, t.checked);
      checkDead();
      return changed(true);
    }
    if (t.dataset.campus !== undefined) {
      cfg.home[Number(t.dataset.campus)].campus_id = t.value ? Number(t.value) : null;
      return changed(true);
    }
    if (t.dataset.link !== undefined) {
      const o = getAt(cfg, t.dataset.link);
      delete o.url; delete o.tab;
      if (t.value === '__url') o.url = '';
      else if (t.value) o.tab = t.value;
      return changed(true);
    }
    if (t.dataset.image !== undefined && t.files[0]) {
      const w = cfg.home[Number(t.dataset.image)];
      try {
        toast('Uploading…');
        w.image = (await api('POST', '/app/images', await shrinkImage(t.files[0], 1600))).url;
        changed(true);
      } catch (err) { fail(err); }
    }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const move = (spec, d) => {
      const [list, i] = spec.split(':');
      const arr = cfg[list];
      const j = Number(i) + d;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      changed(true);
    };
    if (b.dataset.up) return move(b.dataset.up, -1);
    if (b.dataset.down) return move(b.dataset.down, 1);
    if (b.dataset.del) {
      const [list, i] = b.dataset.del.split(':');
      const item = cfg[list][Number(i)];
      if (list === 'tabs') {
        const n = refsTo(item.id);
        if (!(await confirm(`Remove the “${item.label}” tab?`, n ? `${refsText(n)}. They’ll stop opening anything, and you can choose a new place for them. It comes off the app when you save.` : 'It comes off the app when you save.', 'Remove'))) return;
        cfg.tabs.splice(Number(i), 1);
        checkDead();
        return changed(true);
      }
      if (!(await confirm(`Remove “${widgetName(item)}”?`, 'It comes off the home screen when you save.', 'Remove'))) return;
      cfg[list].splice(Number(i), 1);
      return changed(true);
    }
    if (b.dataset.tabicon) { const [i, name] = b.dataset.tabicon.split(':'); cfg.tabs[i].icon = name; return changed(true); }
    if (b.dataset.addTab) {
      const type = b.dataset.addTab;
      const on = cfg.tabs.filter((t) => t.on).length < MAX_TABS;
      cfg.tabs.splice(cfg.tabs.length - 1, 0, type === 'page'
        ? { id: `page-${Date.now().toString(36)}`, type, label: 'About', icon: 'info', on, title: '', body: '' }
        : { id: `link-${Date.now().toString(36)}`, type, label: 'Events', icon: 'calendar', on, url: '' });
      if (!on) toast('Added to the More tab. Turn another tab off to put it on the bottom bar.');
      return changed(true);
    }
    // Home screen widgets
    if (b.dataset.pick) { selected = selected === b.dataset.pick ? null : b.dataset.pick; sendPreview(); return draw(); }
    if (b.dataset.addWidget) {
      const type = b.dataset.addWidget;
      const d = WIDGETS[type];
      const w = { id: `${type}-${Date.now().toString(36)}`, type, size: d.size, style: d.style };
      if (type === 'button') Object.assign(w, { label: 'New button', icon: 'link', tab: cfg.tabs[0].id });
      if (type === 'times') w.title = 'Service times';
      if (type === 'welcome') Object.assign(w, { title: 'Welcome home', text: '' });
      if (type === 'text') Object.assign(w, { title: 'Heading', text: '' });
      if (type === 'announcement') Object.assign(w, { title: 'Good news', text: '' });
      if (type === 'linklist') Object.assign(w, { title: 'Quick links', links: [{ label: 'New link', tab: cfg.tabs[0].id }] });
      if (type === 'image') {
        const file = await pickFile();
        if (!file) return;
        try { w.image = (await api('POST', '/app/images', await shrinkImage(file, 1600))).url; } catch (err) { return fail(err); }
      }
      cfg.home.push(w);
      selected = w.id;
      changed(true);
      return scrollToWidget();
    }
    if (b.dataset.addLink) { (cfg.home[b.dataset.addLink].links ||= []).push({ label: '', tab: cfg.tabs[0].id }); return changed(true); }
    if (b.dataset.delLink) { const [wi, j] = b.dataset.delLink.split(':'); cfg.home[wi].links.splice(Number(j), 1); return changed(true); }
    const [wi, val] = (b.dataset.size || b.dataset.style || b.dataset.icon || '').split(':');
    if (b.dataset.size) { cfg.home[wi].size = val; return changed(true); }
    if (b.dataset.style) {
      cfg.home[wi].style = val;
      if (val === 'color') cfg.home[wi].color ||= '#135fd1';
      return changed(true);
    }
    if (b.dataset.icon) { cfg.home[wi].icon = val; return changed(true); }
    if (b.dataset.unimage) {
      if (cfg.home[b.dataset.unimage].type === 'image') return toast('A Picture widget needs a picture. Replace it, or remove the widget.', 'bad');
      delete cfg.home[b.dataset.unimage].image;
      return changed(true);
    }
    if (b.dataset.dup) {
      const w = { ...structuredClone(cfg.home[b.dataset.dup]), id: `${cfg.home[b.dataset.dup].type}-${Date.now().toString(36)}` };
      cfg.home.splice(Number(b.dataset.dup) + 1, 0, w);
      selected = w.id;
      return changed(true);
    }
  });

  // Things that can't be saved as they are: a website left empty, a link with nowhere to go.
  const problems = () => {
    const out = [];
    for (const t of cfg.tabs) if (t.type === 'link' && !t.url?.trim()) out.push({ msg: `Add a website for the “${t.label}” tab.` });
    for (const w of cfg.home) {
      const name = widgetName(w);
      const d = WIDGETS[w.type];
      if (d.fields.includes('label') && !w.label?.trim()) out.push({ id: w.id, msg: 'Give the button some text.' });
      if (w.type === 'announcement' && !w.title?.trim()) out.push({ id: w.id, msg: 'Give the announcement a headline.' });
      if (d.fields.includes('link')) {
        if (w.url !== undefined && !w.url.trim()) out.push({ id: w.id, msg: `Add a website for “${name}”.` });
        else if (w.type === 'button' && w.url === undefined && !w.tab) out.push({ id: w.id, msg: `Choose where “${name}” opens.` });
      }
      for (const x of w.links || []) {
        if (!x.label?.trim()) out.push({ id: w.id, msg: `Give each link in “${name}” some text.` });
        else if (x.url !== undefined ? !x.url.trim() : !x.tab) out.push({ id: w.id, msg: `Choose where “${x.label}” opens, in “${name}”.` });
      }
    }
    return out;
  };

  const save = async () => {
    const [first] = problems();
    if (first) {
      toast(first.msg, 'bad');
      if (first.id) { selected = first.id; sendPreview(); draw(); scrollToWidget(); }
      return;
    }
    if (!cfg.home.length && !(await confirm('Your home screen is empty', 'The Home tab will show nothing. Save it anyway?', 'Save anyway', { danger: false }))) return;
    try {
      cfg = await put('/app/config', cfg);
      dirty = false;
      updateTools();
      toast('Saved. Everyone sees the changes the next time they open the app.');
      draw();
      frame.contentWindow?.location.reload();
    } catch (err) { fail(err); }
  };
  document.querySelector('[data-actions] [data-save]').onclick = save;

  // Go back to what's saved.
  el.querySelector('[data-discard]').onclick = async () => {
    if (dirty && !(await confirm('Discard your changes?', 'The builder goes back to what’s saved, and what you changed since is lost.', 'Discard'))) return;
    try {
      cfg = structuredClone((await get('/app/config')).config);
      dirty = false; selected = null;
      updateTools(); draw(); sendPreview();
      toast('Back to what’s saved.');
    } catch (err) { fail(err); }
  };
  // The tabs and home screen a new church starts with. Nothing is saved until Save; Discard undoes it.
  el.querySelector('[data-reset]').onclick = async () => {
    if (!(await confirm('Reset to the starting layout?', 'The tabs and home screen go back to how a new church’s app starts, and any pages and links you added come off. Your livestream, giving and connect card settings stay. Nothing changes in the app until you press Save changes.', 'Reset', { danger: false }))) return;
    cfg.tabs = structuredClone(DEFAULT_APP.tabs);
    cfg.home = structuredClone(DEFAULT_APP.home);
    selected = null;
    changed(true);
  };

  // Leaving with unsaved changes asks first.
  const guard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const off = () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('message', onMessage); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', off); };
  window.addEventListener('hashchange', off);

  updateTools();
  draw();
}
