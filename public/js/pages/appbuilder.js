// App Builder: choose the member app's tabs and home screen, with a live phone preview.
import { get, put, api, html, mount, icon, options, toast, fail, chips, confirm, shrinkImage } from '../lib.js';
import { setTitle } from '../app.js';
import { WIDGETS, SIZES, STYLES, ICONS as WIDGET_ICONS } from '../app-widgets.js';

const TAB_INFO = {
  home: ['Home screen', 'The widgets you arrange below.'],
  events: ['Events', 'Everything coming up, from Events in the hub, on a calendar with service times. People sign up and pay right in the app.'],
  serve: ['Serving', 'Sign in to see your schedule, accept or decline, and add dates away.'],
  watch: ['Watch', 'Your livestream. YouTube links play right in the app.'],
  give: ['Give', 'Opens your online giving page.'],
  connect: ['Connect card', 'Guests tell you they were here. Cards arrive under Connect cards.'],
  chat: ['Chat', 'Team chats and groups, for signed-in volunteers. Always reachable from the chat button at the top too.'],
  tasks: ['Tasks', 'Tasks people are given (and their own), with due dates and checklists. Also under More.'],
  page: ['Page', 'Your own text: beliefs, next steps, staff, anything.'],
  link: ['Link', 'Opens any website: events, sermons, small groups sign-up…'],
  more: ['More', 'Account, notifications, appearance, campuses. Always last.'],
};
const WIDGET_ICON = { events: 'calendar', button: 'link', image: 'image', welcome: 'home', serving: 'calendar', tasks: 'tasks', times: 'clock', watch: 'play', text: 'edit' };
const ICONS = WIDGET_ICONS;
const MAX_TABS = 5;

const widgetName = (w) => (w.type === 'button' ? w.label || 'Button' : w.title || WIDGETS[w.type].label);

// One home screen widget in the list; the selected one opens to show its settings.
function widgetRow(w, i, tabTargets) {
  const d = WIDGETS[w.type];
  const k = (f) => `home.${i}.${f}`;
  const linkValue = w.url !== undefined ? '__url' : w.tab || '';
  return html`<div class="w-row ${w.id === SELECTED.id ? 'on' : ''}" data-row="${w.id}">
    <button type="button" class="w-row-head" data-pick="${w.id}">${icon(WIDGET_ICON[w.type])}<span class="grow"><b>${widgetName(w)}</b> <span class="muted small">${d.label} · ${SIZES[w.size]?.label || ''}</span></span>${icon('down', 'ic small-ic')}</button>
    ${w.id === SELECTED.id ? html`<div class="w-row-body">
      <div class="field"><span>Size</span><div class="seg w-sizes">${d.sizes.map((sz) => html`<button type="button" class="${w.size === sz ? 'on' : ''}" data-size="${i}:${sz}" title="${SIZES[sz].label}">${sizeIcon(sz)}<span>${SIZES[sz].label}</span></button>`)}</div></div>
      <div class="field"><span>Look</span><div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(STYLES).map(([st, label]) => html`<button type="button" class="chip ${w.style === st ? 'on' : ''}" data-style="${i}:${st}">${label}</button>`)}
        ${w.style === 'color' ? html`<input type="color" data-k="${k('color')}" value="${w.color || '#135fd1'}" aria-label="Color" class="w-color">` : ''}</div></div>
      ${d.image ? html`<div class="field"><span>Picture${w.type === 'image' ? '' : ' (optional, shows behind the words)'}</span><div class="row" style="gap:8px">
        ${w.image ? html`<img src="${w.image}" alt="" class="w-thumb"><button type="button" class="btn small ghost" data-unimage="${i}">Remove</button>` : ''}
        <label class="btn small">${icon('upload')} ${w.image ? 'Replace' : 'Upload'}<input type="file" accept="image/*" data-image="${i}" hidden></label></div></div>` : ''}
      ${d.fields.includes('label') ? html`<label class="field">Button text<input type="text" data-k="${k('label')}" value="${w.label || ''}" maxlength="30"></label>` : ''}
      ${d.fields.includes('icon') ? html`<div class="field"><span>Icon</span><div class="w-icons">${ICONS.map((x) => html`<button type="button" class="${w.icon === x ? 'on' : ''}" data-icon="${i}:${x}" title="${x}">${icon(x)}</button>`)}</div></div>` : ''}
      ${d.fields.includes('title') ? html`<label class="field">${w.type === 'image' ? 'Caption (optional)' : 'Heading'}<input type="text" data-k="${k('title')}" value="${w.title || ''}" maxlength="120"></label>` : ''}
      ${d.fields.includes('text') ? html`<label class="field">Text<textarea data-k="${k('text')}" rows="3">${w.text || ''}</textarea></label>` : ''}
      ${d.fields.includes('link') ? html`<label class="field">Opens<select data-link="${i}">${options([...(w.type === 'image' ? [{ value: '', label: 'Nothing (just a picture)' }] : []), ...tabTargets, { value: 'giving', label: 'My giving' }, { value: '__url', label: 'A website…' }], linkValue)}</select></label>
        ${w.url !== undefined ? html`<input type="url" data-k="${k('url')}" value="${w.url}" placeholder="https://…" aria-label="Website">` : ''}` : ''}
      <p class="muted small" style="margin:0">${d.hint}</p>
      <div class="row" style="gap:6px"><button type="button" class="btn small ghost" data-up="home:${i}" ${i === 0 ? 'disabled' : ''}>↑ Earlier</button><button type="button" class="btn small ghost" data-down="home:${i}" ${i === SELECTED.count - 1 ? 'disabled' : ''}>↓ Later</button>
        <span class="grow"></span><button type="button" class="btn small ghost" data-dup="${i}">${icon('copy')} Duplicate</button><button type="button" class="btn small ghost danger" data-del="home:${i}">${icon('trash')} Remove</button></div>
    </div>` : ''}</div>`;
}
const SELECTED = { id: null, count: 0 };

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
  const [{ config }, settings] = await Promise.all([get('/app/config'), get('/settings')]);
  let cfg = structuredClone(config);
  let dirty = false;
  let selected = null; // the home screen widget being edited
  const appUrl = settings.app_url.startsWith('http') ? settings.app_url : new URL(settings.app_url, location.origin).href;

  setTitle('App Builder', html`<a class="btn ghost" href="${appUrl}" target="_blank" rel="noopener">${icon('external')} Open the app</a><button class="btn primary" data-save>Save changes</button>`);
  mount(el, html`<p class="muted" style="margin-top:-6px">Your church app is at <a href="${appUrl}" target="_blank" rel="noopener"><b>${appUrl.replace(/^https?:\/\//, '')}</b></a>. Anyone can use it; signing in adds serving schedules and notifications. Changes show in the preview straight away and reach everyone when you save.</p>
    <div class="builder"><div class="builder-edit" data-edit></div>
      <div class="builder-phone"><div class="phone"><iframe src="/app/?preview=1&edit=1" title="App preview" data-preview></iframe></div>
        <p class="muted small" style="text-align:center">On the home screen, drag widgets to move them and drag a corner to resize. Tap one to change it.</p></div></div>`);
  const frame = el.querySelector('[data-preview]');
  const sendPreview = () => frame.contentWindow?.postMessage({ type: 'app-config', config: cfg, selected, keepScroll: true }, location.origin);
  frame.addEventListener('load', sendPreview);
  const changed = (redraw = false) => { dirty = true; sendPreview(); if (redraw) draw(); };
  // The preview tells us when a widget is tapped, moved or resized on the phone.
  const onMessage = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'app-ready') sendPreview();
    if (e.data?.type === 'app-select') { selected = e.data.id; sendPreview(); draw(); scrollToWidget(); }
    if (e.data?.type === 'app-home') { cfg.home = e.data.home; selected = e.data.select ?? selected; changed(true); }
  };
  window.addEventListener('message', onMessage);
  const scrollToWidget = () => box.querySelector('.w-row.on')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const box = el.querySelector('[data-edit]');
  function draw() {
    SELECTED.id = selected;
    SELECTED.count = cfg.home.length;
    const onCount = cfg.tabs.filter((t) => t.on).length;
    const tabTargets = cfg.tabs.filter((t) => t.type !== 'link').map((t) => ({ value: t.id, label: `${t.label} tab` }));
    mount(box, html`
      <div class="card"><div class="card-head"><h2>Tabs</h2><span class="muted small">${onCount} of ${MAX_TABS} on the bottom bar</span>
          <button class="btn small" data-add-tab="page">${icon('plus')} Page</button><button class="btn small" data-add-tab="link">${icon('plus')} Link</button></div>
        ${cfg.tabs.map((t, i) => html`<div class="b-row ${t.on ? '' : 'off'}">
          <div class="b-move">${t.type !== 'more' ? html`<button type="button" class="icon-btn" data-up="tabs:${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-down="tabs:${i}" ${i >= cfg.tabs.length - 2 ? 'disabled' : ''} aria-label="Move down">↓</button>` : ''}</div>
          <select data-k="tabs.${i}.icon" aria-label="Icon" class="b-icon">${options(ICONS.map((x) => ({ value: x, label: x })), t.icon)}</select>
          <span class="b-icon-preview">${icon(t.icon)}</span>
          <div class="b-main"><input type="text" data-k="tabs.${i}.label" value="${t.label}" maxlength="20" aria-label="Tab name">
            <span class="muted small">${TAB_INFO[t.type][0]} · ${TAB_INFO[t.type][1]}</span>
            ${t.type === 'link' ? html`<input type="url" data-k="tabs.${i}.url" value="${t.url || ''}" placeholder="https://…" aria-label="Link">` : ''}
            ${t.type === 'page' ? html`<input type="text" data-k="tabs.${i}.title" value="${t.title || ''}" placeholder="Page heading"><textarea data-k="tabs.${i}.body" rows="4" placeholder="What the page says">${t.body || ''}</textarea>` : ''}
          </div>
          ${t.type !== 'more' ? html`<label class="check small"><input type="checkbox" data-k="tabs.${i}.on" ${t.on ? 'checked' : ''}> On</label>` : html`<span class="muted small">Always on</span>`}
          ${['page', 'link'].includes(t.type) ? html`<button type="button" class="icon-btn danger" data-del="tabs:${i}" title="Remove">${icon('trash')}</button>` : html`<span style="width:30px"></span>`}
        </div>`)}
        <p class="muted small" style="margin:8px 0 0">Tabs that are off still appear in the app’s More tab, so pages and links can live there.</p></div>

      <div class="card" data-home><div class="card-head"><h2>Home screen</h2><span class="muted small">${cfg.home.length} widget${cfg.home.length === 1 ? '' : 's'}</span></div>
        <p class="muted small" style="margin:0 0 10px">Widgets sit on a grid four squares wide. Drag them around on the phone, drag a corner to make one bigger or smaller, and tap one to change it here.</p>
        <div class="w-add">${Object.entries(WIDGETS).map(([k, d]) => html`<button type="button" class="w-add-btn" data-add-widget="${k}" title="${d.hint}">${icon(WIDGET_ICON[k])}<span>${d.label}</span></button>`)}</div>
        <div class="w-rows">${cfg.home.map((w, i) => widgetRow(w, i, tabTargets))}</div>
        ${!cfg.home.length ? html`<p class="muted">Add widgets to build the home screen.</p>` : ''}</div>

      <div class="card"><h2>Links</h2><div class="form">
        <label class="field wide">Livestream<input type="url" data-k="watch_url" value="${cfg.watch_url}" placeholder="https://www.youtube.com/@yourchurch/live or a channel link">
          <span class="muted small">A YouTube channel link (youtube.com/channel/…) shows your live service whenever you’re live. Facebook and other links open in the browser.</span></label>
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
    let o = cfg;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = value;
  };

  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.type === 'checkbox') return;
    setPath(k, e.target.value);
    changed(e.target.tagName === 'SELECT');
  });
  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.k && t.type === 'checkbox') {
      if (t.checked && cfg.tabs.filter((x) => x.on).length >= MAX_TABS) { t.checked = false; return toast(`Only ${MAX_TABS} tabs fit along the bottom of a phone. Turn one off first.`, 'bad'); }
      setPath(t.dataset.k, t.checked);
      return changed(true);
    }
    if (t.dataset.link !== undefined) {
      const w = cfg.home[Number(t.dataset.link)];
      delete w.url; delete w.tab;
      if (t.value === '__url') w.url = '';
      else if (t.value) w.tab = t.value;
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
      if (!(await confirm('Remove this?', 'It comes off the app when you save.', 'Remove'))) return;
      cfg[list].splice(Number(i), 1);
      return changed(true);
    }
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

  document.querySelector('[data-actions] [data-save]').onclick = async () => {
    try {
      cfg = await put('/app/config', cfg);
      dirty = false;
      toast('Saved. Everyone sees the changes the next time they open the app.');
      draw();
      frame.contentWindow?.location.reload();
    } catch (err) { fail(err); }
  };
  // Leaving with unsaved changes asks first.
  const guard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const off = () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('message', onMessage); window.removeEventListener('hashchange', off); };
  window.addEventListener('hashchange', off);

  draw();
}
