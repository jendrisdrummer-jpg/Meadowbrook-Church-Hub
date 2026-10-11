// Media: the library the app's Watch tab shows. New services come in from YouTube on their own;
// here staff fix titles and trims, tag them, and set up the channel.
import { get, post, put, html, mount, icon, dialog, toast, fail, fmtDate, options, debounce } from '../lib.js';
import { setTitle, go } from '../app.js';
import { hms } from '../video.js';

const TABS = [['published', 'Library'], ['skipped', 'Skipped'], ['hidden', 'Hidden'], ['setup', 'Setup']];
const ago = (utc) => {
  if (!utc) return 'never';
  const mins = Math.round((Date.now() - new Date(`${utc.replace(' ', 'T')}Z`)) / 60e3);
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} minutes ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} hours ago`;
  return fmtDate(new Date(`${utc.replace(' ', 'T')}Z`).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric' });
};

export default async function media(el, tab) {
  const setup = await get('/media/setup');
  tab ||= setup.settings.channel_id ? 'published' : 'setup';
  setTitle('Media', html`<button class="btn" data-sync ${setup.settings.channel_id ? '' : 'disabled'}>${icon('download')} Check for new videos</button>
    <button class="btn primary" data-add>${icon('plus')} Add a video</button>`);
  const actions = document.querySelector('[data-actions]');
  actions.querySelector('[data-sync]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = await post('/media/sync', {});
      toast(r.added ? `${r.added} new ${r.added === 1 ? 'video' : 'videos'} added.` : 'You’re up to date.');
      media(el, tab === 'setup' ? 'published' : tab);
    } catch (err) { fail(err); b.disabled = false; }
  };
  actions.querySelector('[data-add]').onclick = async () => {
    let made = null;
    const ok = await dialog({
      title: 'Add a video', submit: 'Add',
      body: html`<label class="field">YouTube address<input type="url" name="url" placeholder="https://www.youtube.com/watch?v=…" required></label>
        <p class="muted small" style="margin:0">For a special service or anything the automatic check skipped. It shows in the app with its own title and trim, which you set next.</p>`,
      onSubmit: async (f) => { made = await post('/media', { url: f.url.value }); },
    });
    if (ok && made) go(`/media/${made.id}`);
  };

  const head = (counts) => html`<div class="tabs">${TABS.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}${counts?.[k] ? html` <span class="muted">${counts[k]}</span>` : ''}</button>`)}</div>`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) go(t.dataset.tab === 'published' ? '/media' : `/media/${t.dataset.tab}`);
  };

  if (tab === 'setup') return drawSetup(el, setup, head);

  const d = await get(`/media?status=${tab}`);
  const live = d.status.live;
  let q = '';
  let speaker = '';
  let series = '';
  const draw = () => {
    const needle = q.toLowerCase();
    const shown = d.items.filter((m) => (!speaker || m.speaker === speaker) && (!series || m.series === series)
      && (!needle || [m.title, m.speaker, m.series, m.scripture, m.yt_title, ...m.topics].join(' ').toLowerCase().includes(needle)));
    mount(el.querySelector('[data-list]'), shown.length ? html`<div class="md-grid">${shown.map((m) => html`<a class="md-card" href="#/media/${m.id}">
        <span class="md-pic" style="background-image:url('${m.picture}')">${m.length ? html`<span class="md-len">${hms(m.length)}</span>` : ''}${m.start || m.end ? html`<span class="md-trimmed">${icon('edit')} Trimmed</span>` : ''}</span>
        <span class="md-body"><b>${m.title}</b>
          <span class="muted small">${[fmtDate(m.day, { month: 'short', day: 'numeric', year: 'numeric' }), m.speaker].filter(Boolean).join(' · ')}</span>
          ${m.series ? html`<span class="pill">${m.series}</span>` : ''}
          ${tab === 'skipped' ? html`<span class="muted small">${m.skip_reason}</span>` : ''}</span></a>`)}</div>`
      : html`<div class="card empty">${d.items.length ? 'Nothing matches.' : tab === 'skipped' ? 'Nothing skipped. Short clips and Shorts land here, in case you want one in the library.' : tab === 'hidden' ? 'Nothing hidden.' : 'No videos yet. They come in on their own after each service; Check for new videos looks now.'}</div>`);
  };
  mount(el, html`${head(d.counts)}
    ${live ? html`<div class="alert good md-live"><span class="md-dot"></span><b>Live now:</b> ${live.title}. The app’s Watch tab is showing it.</div>` : ''}
    ${d.status.last_error ? html`<div class="alert bad">The last check didn’t work: ${d.status.last_error}</div>` : ''}
    ${tab === 'skipped' ? html`<p class="muted" style="margin-top:0">Videos that didn’t look like a full service (Shorts, or under ${d.settings.min_minutes} minutes). Open one and choose <b>Publish</b> to add it to the library.</p>` : ''}
    <div class="row md-tools"><input type="search" placeholder="Search titles, speakers, topics…" data-q class="grow">
      ${d.speakers.length ? html`<select data-speaker>${options(d.speakers.map((x) => ({ value: x, label: x })), '', { blank: 'Every speaker' })}</select>` : ''}
      ${d.series.length ? html`<select data-series>${options(d.series.map((x) => ({ value: x, label: x })), '', { blank: 'Every series' })}</select>` : ''}</div>
    <div data-list></div>
    <p class="muted small">Last checked YouTube ${ago(d.status.last_sync)}${d.settings.channel_title ? ` (${d.settings.channel_title})` : ''}. New services come in on their own within the hour.</p>`);
  el.querySelector('[data-q]').oninput = debounce((e) => { q = e.target.value; draw(); }, 150);
  const sp = el.querySelector('[data-speaker]');
  if (sp) sp.onchange = () => { speaker = sp.value; draw(); };
  const se = el.querySelector('[data-series]');
  if (se) se.onchange = () => { series = se.value; draw(); };
  draw();
}

function drawSetup(el, setup, head) {
  const { settings: s, status, formats, api_key: hasKey } = setup;
  mount(el, html`${head(null)}<div class="grid two md-setup">
    <form class="card stack" data-form>
      <h2 style="margin:0">YouTube channel</h2>
      <p class="muted small" style="margin:0">Every hour the hub checks your channel. When a service is over, it lands in the app’s Watch tab with its date, campus, speaker, series and title filled in from that day’s order of service. Nothing on YouTube changes.</p>
      <label class="field">Channel address or @handle<input type="text" name="channel" value="${s.channel_input}" placeholder="youtube.com/@yourchurch">
        ${s.channel_id ? html`<span class="small"><span class="pill good">${icon('check')} ${s.channel_title || s.channel_id}</span> · last checked ${ago(status.last_sync)}</span>` : ''}</label>
      ${status.last_error ? html`<div class="alert bad">${status.last_error}</div>` : ''}
      <label class="field">How your video titles are written<select name="title_format">${options(Object.entries(formats).map(([value, label]) => ({ value, label })), s.title_format)}</select>
        <span class="muted small">Used when the order of service doesn’t name the message. With “Series | Title”, a video called <i>Unshakable | Standing Firm</i> becomes the title “Standing Firm” in the series “Unshakable”.</span></label>
      <label class="field">Full services are at least<span class="row" style="gap:8px"><input type="number" name="min_minutes" min="1" max="180" value="${s.min_minutes}" style="width:90px"> minutes</span>
        <span class="muted small">Shorter videos (and Shorts) go to Skipped instead of the app.</span></label>
      <label class="check"><input type="checkbox" name="notify_live" ${s.notify_live ? 'checked' : ''}> Notify the app when we go live</label>
      <label class="check"><input type="checkbox" name="notify_new" ${s.notify_new ? 'checked' : ''}> Notify the app when a new message is added</label>
      <span class="muted small" style="margin-top:-6px">Goes to everyone with notifications on, including guests who turned on announcements. People can turn these off for themselves.</span>
      <div class="row end"><button class="btn primary">Save</button></div>
    </form>
    <div class="card stack">
      <h2 style="margin:0">See every video ${hasKey ? html`<span class="pill good">${icon('check')} On</span>` : html`<span class="pill">Optional</span>`}</h2>
      ${hasKey
        ? html`<p class="small" style="margin:0">The hub can see your whole channel, with each video’s exact length and when you’re live.</p>
          <button class="btn" data-deep ${s.channel_id ? '' : 'disabled'}>${icon('download')} Bring in older videos</button>
          <span class="muted small">Goes back through the whole channel once. Full services land in the library; you can hide any.</span>`
        : html`<p class="small" style="margin:0">Without this the hub sees your latest 15 videos, which is plenty week to week. To bring in older services too, add a free YouTube key (about 5 minutes):</p>
          <ol class="small md-steps"><li>Go to <b>console.cloud.google.com</b>, in the same project you use for Google sign-in.</li>
            <li><b>APIs &amp; Services → Library</b>: find <b>YouTube Data API v3</b> and click <b>Enable</b>.</li>
            <li><b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Click the key, under <b>API restrictions</b> pick <b>YouTube Data API v3</b>, and save.</li>
            <li>In Render → your service → <b>Environment</b>, add <code>YOUTUBE_API_KEY</code> with that key.</li></ol>`}
      <h2 style="margin:8px 0 0">In the app</h2>
      <p class="small" style="margin:0">The <b>Watch</b> tab shows the library with your titles, pictures and trims: search, and filter by speaker, series and topic. When you’re live, the live service is at the top. Add a <b>Latest message</b> widget to the home screen in the App Builder.</p>
    </div></div>`);

  const f = el.querySelector('[data-form]');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button.primary');
    b.disabled = true;
    try {
      const r = await put('/media/setup', { channel: f.channel.value, title_format: f.title_format.value, min_minutes: Number(f.min_minutes.value), notify_live: f.notify_live.checked, notify_new: f.notify_new.checked });
      const first = r.settings.channel_id && !s.channel_id;
      if (first) {
        toast(`Connected to ${r.settings.channel_title || 'your channel'}. Looking for videos…`);
        await post('/media/sync', {}).catch(fail);
        return go('/media');
      }
      toast('Saved.');
      media(el, 'setup');
    } catch (err) { fail(err); b.disabled = false; }
  };
  const deep = el.querySelector('[data-deep]');
  if (deep) {
    deep.onclick = async () => {
      deep.disabled = true;
      deep.textContent = 'Bringing in older videos…';
      try {
        const r = await post('/media/sync', { deep: true });
        toast(`${r.added} added to the library${r.skipped ? `, ${r.skipped} skipped` : ''}.`);
        go('/media');
      } catch (err) { fail(err); deep.disabled = false; }
    };
  }
}
