// App Builder: choose the member app's tabs and home screen, with a live phone preview.
import { get, put, html, mount, icon, options, toast, fail, chips, confirm } from '../lib.js';
import { setTitle } from '../app.js';

const TAB_INFO = {
  home: ['Home screen', 'The blocks you arrange below.'],
  serve: ['Serving', 'Sign in to see your schedule, accept or decline, and add dates away.'],
  watch: ['Watch', 'Your livestream. YouTube links play right in the app.'],
  give: ['Give', 'Opens your online giving page.'],
  connect: ['Connect card', 'Guests tell you they were here. Cards arrive under Connect cards.'],
  page: ['Page', 'Your own text: beliefs, next steps, staff, anything.'],
  link: ['Link', 'Opens any website: events, sermons, small groups sign-up…'],
  more: ['More', 'Account, notifications, appearance, campuses. Always last.'],
};
const BLOCKS = {
  welcome: 'Welcome banner',
  serving: 'My next times serving',
  buttons: 'Buttons',
  times: 'Service times',
  watch: 'Livestream player',
  text: 'Text',
};
const ICONS = ['home', 'calendar', 'user', 'play', 'heart', 'hand', 'info', 'link', 'menu', 'music', 'people', 'gift', 'book', 'chat', 'check'];
const MAX_TABS = 5;

export default async function appBuilder(el) {
  const [{ config }, settings] = await Promise.all([get('/app/config'), get('/settings')]);
  let cfg = structuredClone(config);
  let dirty = false;
  const appUrl = settings.app_url.startsWith('http') ? settings.app_url : new URL(settings.app_url, location.origin).href;

  setTitle('App Builder', html`<a class="btn ghost" href="${appUrl}" target="_blank" rel="noopener">${icon('external')} Open the app</a><button class="btn primary" data-save>Save changes</button>`);
  mount(el, html`<p class="muted" style="margin-top:-6px">Your church app is at <a href="${appUrl}" target="_blank" rel="noopener"><b>${appUrl.replace(/^https?:\/\//, '')}</b></a>. Anyone can use it; signing in adds serving schedules and notifications. Changes show in the preview straight away and reach everyone when you save.</p>
    <div class="builder"><div class="builder-edit" data-edit></div>
      <div class="builder-phone"><div class="phone"><iframe src="/app/?preview=1" title="App preview" data-preview></iframe></div><p class="muted small" style="text-align:center">Preview</p></div></div>`);
  const frame = el.querySelector('[data-preview]');
  const sendPreview = () => frame.contentWindow?.postMessage({ type: 'app-config', config: cfg }, location.origin);
  frame.addEventListener('load', sendPreview);
  const changed = (redraw = false) => { dirty = true; sendPreview(); if (redraw) draw(); };

  const box = el.querySelector('[data-edit]');
  function draw() {
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

      <div class="card"><div class="card-head"><h2>Home screen</h2>
          <select data-add-block aria-label="Add a block"><option value="">Add a block…</option>${Object.entries(BLOCKS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
        ${cfg.home.map((b, i) => html`<div class="b-row">
          <div class="b-move"><button type="button" class="icon-btn" data-up="home:${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-down="home:${i}" ${i === cfg.home.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>
          <div class="b-main"><b>${BLOCKS[b.type]}</b>
            ${['welcome', 'text', 'times', 'watch'].includes(b.type) ? html`<input type="text" data-k="home.${i}.title" value="${b.title || ''}" placeholder="Heading">` : ''}
            ${['welcome', 'text'].includes(b.type) ? html`<textarea data-k="home.${i}.text" rows="3" placeholder="Text">${b.text || ''}</textarea>` : ''}
            ${b.type === 'serving' ? html`<span class="muted small">Signed-in volunteers see their next few times serving, with Accept. Others see a “Serve on a team?” sign-in link.</span>` : ''}
            ${b.type === 'times' ? html`<span class="muted small">Filled in from your repeating services, with each campus’s address.</span>` : ''}
            ${b.type === 'watch' ? html`<span class="muted small">Uses the livestream link below.</span>` : ''}
            ${b.type === 'buttons' ? html`${(b.items || []).map((x, j) => html`<div class="row b-button">
                <input type="text" data-k="home.${i}.items.${j}.label" value="${x.label}" placeholder="Button text" maxlength="30">
                <select data-target="${i}:${j}">${options([...tabTargets, { value: '__url', label: 'A website…' }], x.url ? '__url' : x.tab)}</select>
                ${x.url !== undefined ? html`<input type="url" data-k="home.${i}.items.${j}.url" value="${x.url}" placeholder="https://…">` : ''}
                <button type="button" class="icon-btn danger" data-del-button="${i}:${j}" title="Remove">${icon('x')}</button></div>`)}
              ${(b.items || []).length < 6 ? html`<button type="button" class="btn small ghost" data-add-button="${i}">${icon('plus')} Button</button>` : ''}` : ''}
          </div>
          <button type="button" class="icon-btn danger" data-del="home:${i}" title="Remove">${icon('trash')}</button>
        </div>`)}
        ${!cfg.home.length ? html`<p class="muted">Add blocks to build the home screen.</p>` : ''}</div>

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
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.k && t.type === 'checkbox') {
      if (t.checked && cfg.tabs.filter((x) => x.on).length >= MAX_TABS) { t.checked = false; return toast(`Only ${MAX_TABS} tabs fit along the bottom of a phone. Turn one off first.`, 'bad'); }
      setPath(t.dataset.k, t.checked);
      return changed(true);
    }
    if (t.matches('[data-add-block]') && t.value) {
      const type = t.value;
      const b = { id: `${type}-${Date.now().toString(36)}`, type };
      if (type === 'text' || type === 'welcome') Object.assign(b, { title: '', text: '' });
      if (type === 'buttons') b.items = [{ label: 'Give', tab: 'give' }];
      if (type === 'times') b.title = 'Service times';
      cfg.home.push(b);
      return changed(true);
    }
    if (t.dataset.target) {
      const [i, j] = t.dataset.target.split(':').map(Number);
      const item = cfg.home[i].items[j];
      if (t.value === '__url') { delete item.tab; item.url = ''; } else { delete item.url; item.tab = t.value; }
      return changed(true);
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
    if (b.dataset.addButton) { cfg.home[Number(b.dataset.addButton)].items.push({ label: 'New button', tab: cfg.tabs[0].id }); return changed(true); }
    if (b.dataset.delButton) {
      const [i, j] = b.dataset.delButton.split(':').map(Number);
      cfg.home[i].items.splice(j, 1);
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
  const off = () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('hashchange', off); };
  window.addEventListener('hashchange', off);

  draw();
}
