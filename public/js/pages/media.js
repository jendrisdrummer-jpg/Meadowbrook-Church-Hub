// Media: the library the app's Watch tab shows. New services come in from YouTube on their own;
// here staff fix titles and trims, tag them, and set up the channel.
import { api, get, post, put, patch, html, mount, icon, dialog, toast, fail, fmtDate, options, debounce, confirm, shrinkImage } from '../lib.js';
import { setTitle, go } from '../app.js';
import { hms } from '../video.js';
import { uploadToMux, looseTitle } from '../mux-upload.js';

const TABS = [['published', 'Library'], ['skipped', 'Skipped'], ['hidden', 'Hidden'], ['podcast', 'Podcast'], ['setup', 'Setup']];
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
  tab ||= setup.settings.channel_id || setup.mux.configured ? 'published' : 'setup';
  setTitle('Media', html`<button class="btn" data-sync ${setup.settings.channel_id || setup.status.mux ? '' : 'disabled'}>${icon('download')} Check for new videos</button>
    ${setup.mux.configured ? html`<label class="btn">${icon('upload')} Upload videos<input type="file" accept="video/*" multiple data-bulk hidden></label>` : ''}
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

  const bulk = actions.querySelector('[data-bulk]');
  if (bulk) bulk.onchange = () => { const files = [...bulk.files]; bulk.value = ''; if (files.length) bulkUpload(el, files, () => media(el, tab)); };

  const head = (counts) => html`<div class="tabs">${TABS.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}${counts?.[k] ? html` <span class="muted">${counts[k]}</span>` : ''}</button>`)}</div>`;
  el.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) go(t.dataset.tab === 'published' ? '/media' : `/media/${t.dataset.tab}`);
    if (e.target.closest('[data-show-live]')) {
      try { await post('/media/live/show', {}); toast('It’s in the app now.'); media(el, tab); } catch (err) { fail(err); }
    }
  };

  if (tab === 'setup') return drawSetup(el, setup, head);
  if (tab === 'podcast') return drawPodcast(el, head);

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
        <span class="md-pic" style="background-image:url('${m.picture}')">${m.length ? html`<span class="md-len">${hms(m.length)}</span>` : ''}${m.start || m.end ? html`<span class="md-trimmed">${icon('edit')} Trimmed</span>` : ''}${m.source !== 'mux' ? html`<span class="md-src">YouTube player</span>` : m.upload_status ? html`<span class="md-src">Getting ready…</span>` : ''}</span>
        <span class="md-body"><b>${m.title}</b>
          <span class="muted small">${[fmtDate(m.day, { month: 'short', day: 'numeric', year: 'numeric' }), m.speaker].filter(Boolean).join(' · ')}</span>
          ${m.series ? html`<span class="pill">${m.series}</span>` : ''}
          ${tab === 'skipped' ? html`<span class="muted small">${m.skip_reason}</span>` : ''}</span></a>`)}</div>`
      : html`<div class="card empty">${d.items.length ? 'Nothing matches.' : tab === 'skipped' ? 'Nothing skipped. Short clips and Shorts land here, in case you want one in the library.' : tab === 'hidden' ? 'Nothing hidden.' : 'No videos yet. They come in on their own after each service; Check for new videos looks now.'}</div>`);
  };
  mount(el, html`${head(d.counts)}
    ${live && live.public === false ? html`<div class="alert md-live"><span class="md-dot"></span><span class="grow"><b>Receiving a stream</b> outside service times (a rehearsal?). It isn’t in the app.</span><button class="btn small primary" data-show-live>Show it in the app</button></div>`
      : live ? html`<div class="alert good md-live"><span class="md-dot"></span><b>Live now:</b> ${live.title}. The app’s Watch tab is showing it.</div>` : ''}
    ${d.status.last_error ? html`<div class="alert bad">The last check didn’t work: ${d.status.last_error}</div>` : ''}
    ${tab === 'skipped' ? html`<p class="muted" style="margin-top:0">Videos that didn’t look like a full service (Shorts, or under ${d.settings.min_minutes} minutes). Open one and choose <b>Publish</b> to add it to the library.</p>` : ''}
    <div class="row md-tools"><input type="search" placeholder="Search titles, speakers, topics…" data-q class="grow">
      ${d.speakers.length ? html`<select data-speaker>${options(d.speakers.map((x) => ({ value: x, label: x })), '', { blank: 'Every speaker' })}</select>` : ''}
      ${d.series.length ? html`<select data-series>${options(d.series.map((x) => ({ value: x, label: x })), '', { blank: 'Every series' })}</select>` : ''}</div>
    <div data-list></div>
    <p class="muted small">${d.status.mux ? 'Streaming through Mux: each service comes in a few minutes after the stream ends.' : html`Last checked YouTube ${ago(d.status.last_sync)}${d.settings.channel_title ? ` (${d.settings.channel_title})` : ''}. New services come in on their own within the hour.`}</p>`);
  el.querySelector('[data-q]').oninput = debounce((e) => { q = e.target.value; draw(); }, 150);
  const sp = el.querySelector('[data-speaker]');
  if (sp) sp.onchange = () => { speaker = sp.value; draw(); };
  const se = el.querySelector('[data-series]');
  if (se) se.onchange = () => { series = se.value; draw(); };
  draw();
}

function streamingCard(x, s) {
  const steps = html`<ol class="small md-steps">
    <li>Sign up at <a href="https://dashboard.mux.com/signup" target="_blank" rel="noopener">dashboard.mux.com/signup</a> and add a card (Billing).</li>
    <li>In Mux: <b>Settings → Access Tokens → Generate new token</b>. Pick the <b>Production</b> environment and tick <b>Mux Video</b> with Read and Write.</li>
    <li>In Render → your service → <b>Environment</b>, add <code>MUX_TOKEN_ID</code> and <code>MUX_TOKEN_SECRET</code> with the two values it shows, and save. (Only there, never in an email or chat.)</li>
    <li>Come back here for your stream key.</li></ol>`;
  if (!x.configured) {
    return html`<div class="card stack md-stream"><h2 style="margin:0">Live streaming <span class="pill">Not set up</span></h2>
      <p class="small" style="margin:0">Stream from vMix to the church’s own video host (Mux). The app plays it in its own player, with no YouTube, and every service lands here when it ends, ready to trim.</p>${steps}</div>`;
  }
  if (!x.live_stream_id) {
    return html`<div class="card stack md-stream"><h2 style="margin:0">Live streaming <span class="pill good">${icon('check')} Mux connected</span></h2>
      <p class="small" style="margin:0">Make your stream key. It stays the same every week, so it goes into vMix once.</p>
      <button class="btn primary" data-make-key>${icon('video')} Make the stream key</button></div>`;
  }
  return html`<div class="card stack md-stream"><h2 style="margin:0">Live streaming <span class="pill good">${icon('check')} Ready</span></h2>
    <p class="small" style="margin:0">In vMix: <b>Settings → Outputs / Streaming</b> (the gear next to <b>Stream</b>), Destination <b>Custom RTMP Server</b>:</p>
    <div class="md-key"><span class="muted small">URL</span><code>${x.server}</code><button class="btn small ghost" data-copy="${x.server}">${icon('copy')} Copy</button></div>
    <div class="md-key"><span class="muted small">Stream key</span><code data-key>${'•'.repeat(18)}</code><button class="btn small ghost" data-reveal>Show</button><button class="btn small ghost" data-copy="${x.stream_key}">${icon('copy')} Copy</button></div>
    <p class="muted small" style="margin:0">Anyone with the key can stream to your app, so keep it to the media team. During a service (from 30 minutes before) it goes live in the app on its own; any other time it waits here until you choose <b>Show it in the app</b>.</p>
    <h3 style="margin:6px 0 0">Also on YouTube</h3>
    <p class="small" style="margin:0">Cheapest: in vMix, add YouTube as a second destination (vMix sends both at once). Or have Mux forward it (about 2¢ a minute):</p>
    <form class="row" data-yt style="gap:8px;flex-wrap:wrap">${x.youtube_forward
      ? html`<span class="pill good">${icon('check')} Forwarding to YouTube</span><button type="button" class="btn small ghost" data-yt-off>Stop</button>`
      : html`<input type="password" name="key" placeholder="YouTube stream key (YouTube Studio → Go live → Stream)" class="grow" autocomplete="off"><button class="btn small">Forward to YouTube</button>`}</form>
    <form class="row" data-keep style="gap:8px;align-items:flex-end;flex-wrap:wrap"><label class="field" style="margin:0">After trimming, keep the full recording<select name="keep_full_days">${options([{ value: 7, label: 'For a week' }, { value: 30, label: 'For 30 days' }, { value: 90, label: 'For 90 days' }, { value: 0, label: 'Always' }], s.keep_full_days ?? 30)}</select></label>
      <span class="muted small grow">Then only the trimmed copy is kept, which costs less to store.</span></form>
    <button class="btn small ghost danger" data-reset-key style="justify-self:start">Make a new stream key</button></div>`;
}

function drawSetup(el, setup, head) {
  const { settings: s, status, formats, api_key: hasKey } = setup;
  mount(el, html`${head(null)}${streamingCard(setup.mux, s)}<div class="grid two md-setup">
    <form class="card stack" data-form>
      <h2 style="margin:0">YouTube channel</h2>
      ${status.mux ? html`<p class="small" style="margin:0"><span class="pill">Older videos only</span> You’re streaming through Mux, so new services come from there. The channel is for bringing in past services.</p>` : ''}
      <p class="muted small" style="margin:0">Every hour the hub checks your channel. When a service is over, it lands in the app’s Watch tab with its date, campus, speaker, series and title filled in from that day’s order of service. Nothing on YouTube changes.</p>
      <label class="field">Channel address or @handle<input type="text" name="channel" value="${s.channel_input}" placeholder="youtube.com/@yourchurch">
        ${s.channel_id ? html`<span class="small"><span class="pill good">${icon('check')} ${s.channel_title || s.channel_id}</span> · last checked ${ago(status.last_sync)}</span>` : ''}</label>
      ${status.last_error ? html`<div class="alert bad">${status.last_error}</div>` : ''}
      <label class="field">How your video titles are written<select name="title_format">${options(Object.entries(formats).map(([value, label]) => ({ value, label })), s.title_format)}</select>
        <span class="muted small">Used when the order of service doesn’t name the message. With “Series | Title”, a video called <i>Unshakable | Standing Firm</i> becomes the title “Standing Firm” in the series “Unshakable”.</span></label>
      <label class="field">Full services are at least<span class="row" style="gap:8px"><input type="number" name="min_minutes" min="1" max="180" value="${s.min_minutes}" style="width:90px"> minutes</span>
        <span class="muted small">Shorter videos (and Shorts) go to Skipped instead of the app.</span></label>
      <label class="check"><input type="checkbox" name="own_player_only" ${s.own_player_only ? 'checked' : ''}> Only show videos that play in our own player</label>
      <span class="muted small" style="margin-top:-6px">Hides ones still on YouTube until their video file is uploaded (Upload videos).</span>
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
      const r = await put('/media/setup', { channel: f.channel.value, title_format: f.title_format.value, min_minutes: Number(f.min_minutes.value), notify_live: f.notify_live.checked, notify_new: f.notify_new.checked, own_player_only: f.own_player_only.checked });
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
  const card = el.querySelector('.md-stream');
  card.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-make-key]')) { b.disabled = true; await post('/media/mux/stream', {}); toast('Your stream key is ready.'); return media(el, 'setup'); }
      if (b.dataset.copy) { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); }
      if (b.matches('[data-reveal]')) { const k = card.querySelector('[data-key]'); const shown = b.textContent === 'Hide'; k.textContent = shown ? '•'.repeat(18) : setup.mux.stream_key; b.textContent = shown ? 'Show' : 'Hide'; }
      if (b.matches('[data-yt-off]')) { await put('/media/mux/youtube', { key: '' }); toast('Stopped forwarding to YouTube.'); media(el, 'setup'); }
      if (b.matches('[data-reset-key]')) {
        if (!(await confirm('Make a new stream key?', 'The old key stops working right away, so vMix needs the new one before the next service.', 'Make a new key'))) return;
        await post('/media/mux/reset-key', {});
        toast('New key made. Put it in vMix.');
        media(el, 'setup');
      }
    } catch (err) { fail(err); b.disabled = false; }
  };
  const yt = card.querySelector('[data-yt]');
  if (yt && yt.key) {
    yt.onsubmit = async (e) => {
      e.preventDefault();
      if (!yt.key.value.trim()) return toast('Paste the stream key from YouTube Studio.');
      try { await put('/media/mux/youtube', { key: yt.key.value.trim() }); toast('Mux will send the stream on to YouTube too.'); media(el, 'setup'); } catch (err) { fail(err); }
    };
  }
  const keep = card.querySelector('[data-keep]');
  if (keep) keep.keep_full_days.onchange = async () => { try { await put('/media/setup', { keep_full_days: Number(keep.keep_full_days.value) }); toast('Saved.'); } catch (err) { fail(err); } };
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

// Several video files at once (downloaded from YouTube Studio, or anything else). Each one goes
// onto the library video with the same title, so it switches to our own player; any other file
// becomes a new video.
async function bulkUpload(el, files, done) {
  const lists = await Promise.all(['published', 'hidden', 'skipped'].map((st) => get(`/media?status=${st}`)));
  const all = lists.flatMap((d) => d.items);
  const box = document.createElement('div');
  box.className = 'card stack md-bulk';
  el.prepend(box);
  const rows = files.map((f) => {
    const key = looseTitle(f.name);
    const match = all.find((m) => looseTitle(m.yt_title) === key || looseTitle(m.title) === key);
    return { file: f, match, state: 'Waiting', pct: 0 };
  });
  const draw = () => mount(box, html`<h2 style="margin:0">Uploading ${files.length} ${files.length === 1 ? 'video' : 'videos'} <span class="muted small">Keep this page open</span></h2>
    ${rows.map((r) => html`<div class="md-bulk-row"><span class="grow"><b>${r.file.name}</b><br><span class="muted small">${r.match ? `Onto “${r.match.title}”` : 'A new video'} · ${r.state}</span></span>
      <span class="meter" style="width:160px"><span style="width:${r.pct}%"></span></span></div>`)}`);
  draw();
  for (const r of rows) {
    try {
      if (r.match?.source === 'mux' && !r.match.upload_status) { r.state = 'Already in our player'; r.pct = 100; draw(); continue; }
      r.state = 'Uploading';
      draw();
      const { id, url } = r.match ? { id: r.match.id, ...(await post(`/media/${r.match.id}/upload`, {})) } : await post('/media/uploads', { title: r.file.name });
      let last = 0;
      await uploadToMux(url, r.file, (f) => { r.pct = Math.round(f * 100); if (r.pct !== last) { last = r.pct; draw(); } });
      await post(`/media/${id}/upload/done`, {});
      r.state = 'Uploaded; Mux is getting it ready';
    } catch (err) { r.state = `Didn’t work: ${err.message}`; }
    draw();
  }
  toast('Uploads finished. Each switches to our own player once Mux has it ready (a few minutes).');
  setTimeout(done, 1500);
}

// ---------------------------------------------------------------- the podcast
const EP_STATE = {
  ready: html`<span class="pill good">In the podcast</span>`,
  making: html`<span class="pill warn">Making the audio…</span>`,
  uploading: html`<span class="pill warn">Video on its way to Mux</span>`,
  failed: html`<span class="pill bad">Audio didn’t work</span>`,
  youtube: html`<span class="pill">Only on YouTube</span>`,
  off: html`<span class="pill">Left out</span>`,
};

async function drawPodcast(el, head) {
  const d = await get('/media/podcast');
  const p = d.settings;
  let image = p.image;
  mount(el, html`${head(null)}
    ${!d.mux ? html`<div class="alert">The podcast uses the audio of messages streamed or uploaded through Mux. Set up streaming in <a href="#/media/setup">Setup</a> first.</div>` : ''}
    <div class="grid two md-setup">
      <form class="card stack" data-pod>
        <h2 style="margin:0">Podcast ${p.enabled ? html`<span class="pill good">${icon('check')} On</span>` : html`<span class="pill">Off</span>`}</h2>
        <p class="small" style="margin:0">Every message in the library becomes a podcast episode on its own: the audio of its trimmed part, with its title, speaker, series and scripture. Podcast apps check for new ones every few hours.</p>
        <label class="check"><input type="checkbox" name="enabled" ${p.enabled ? 'checked' : ''}> Turn on the podcast</label>
        <label class="field">Podcast name<input type="text" name="title" value="${p.title}" maxlength="150" required></label>
        <label class="field">Host or church<input type="text" name="author" value="${p.author}" maxlength="120"></label>
        <label class="field">About the podcast<textarea name="description" rows="3" maxlength="4000" placeholder="Messages from our Sunday services…">${p.description}</textarea></label>
        <label class="field">Owner email<input type="email" name="email" value="${p.email}" placeholder="media@yourchurch.org">
          <span class="muted small">Podcast apps send a code here to confirm the podcast is yours. It’s in the feed, so use a church address.</span></label>
        <label class="field">Category<select name="subcategory">${options([{ value: 'Christianity', label: 'Religion & Spirituality › Christianity' }, { value: 'Religion', label: 'Religion & Spirituality › Religion' }, { value: 'Spirituality', label: 'Religion & Spirituality › Spirituality' }], p.subcategory)}</select></label>
        <div class="field"><span>Cover art</span>
          <div class="row" style="gap:12px;align-items:center"><span class="pod-art" data-art style="${image ? `background-image:url('${image}')` : ''}">${image ? '' : icon('image')}</span>
            <span class="stack" style="gap:6px"><label class="btn small" style="justify-self:start">${icon('upload')} Upload a square picture<input type="file" accept="image/jpeg,image/png" data-art-file hidden></label>
              <span class="muted small">At least 1400 × 1400 (3000 × 3000 is best), JPG or PNG.</span></span></div></div>
        <div class="row end"><button class="btn primary">Save</button></div>
      </form>
      <div class="card stack">
        <h2 style="margin:0">Put it on Apple Podcasts and Spotify</h2>
        <p class="small" style="margin:0">Your feed’s address. Submit it once to each app; after that they pick up new episodes on their own.</p>
        <div class="md-key"><code>${d.feed_url}</code><button class="btn small ghost" data-copy="${d.feed_url}">${icon('copy')} Copy</button></div>
        <ol class="small md-steps">
          <li><b>Apple Podcasts:</b> sign in at <a href="https://podcastsconnect.apple.com" target="_blank" rel="noopener">podcastsconnect.apple.com</a> → <b>+</b> → <b>New Show</b> → <b>Add a show with an RSS feed</b>, paste the address, and submit. Apple reviews it (usually a day or two).</li>
          <li><b>Spotify:</b> at <a href="https://creators.spotify.com" target="_blank" rel="noopener">creators.spotify.com</a> choose to add an existing podcast, paste the address, and enter the code Spotify emails to the owner email.</li>
          <li>Others (Amazon Music, Pocket Casts, Overcast…) find it through Apple, or take the same address.</li></ol>
        <p class="muted small" style="margin:0">Turn the podcast on and have at least one episode ready before submitting: the apps check the feed when you do.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Episodes</h2>
      ${d.episodes.length ? html`<table class="list"><thead><tr><th>Message</th><th>Date</th><th>Podcast</th><th></th></tr></thead><tbody>
        ${d.episodes.map((e) => html`<tr><td><a href="#/media/${e.id}"><b>${e.title}</b></a>${e.speaker ? html`<div class="muted small">${e.speaker}</div>` : ''}</td>
          <td class="nowrap small">${fmtDate(e.day, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${EP_STATE[e.state] || ''}</td>
          <td style="text-align:right"><button class="btn small ghost" data-ep="${e.id}" data-on="${e.podcast ? '' : '1'}">${e.podcast ? 'Leave out' : 'Include'}</button></td></tr>`)}</tbody></table>`
        : html`<p class="muted" style="margin:0">No messages yet.</p>`}
      <p class="muted small" style="margin:8px 0 0">“Only on YouTube” ones can join once their video file is uploaded (open the video → Play it in our own player).</p></div>`);

  const f = el.querySelector('[data-pod]');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await put('/media/podcast', { enabled: f.enabled.checked, title: f.title.value, author: f.author.value, description: f.description.value, email: f.email.value, subcategory: f.subcategory.value, image });
      toast(f.enabled.checked ? 'Saved. Episodes appear in the feed as their audio is ready.' : 'Saved.');
      drawPodcast(el, head);
    } catch (err) { fail(err); }
  };
  el.querySelector('[data-art-file]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = await createImageBitmap(file).catch(() => null);
    if (img && (img.width < 1400 || Math.abs(img.width - img.height) > 4)) toast('Podcast apps want a square picture at least 1400 × 1400. This one may be turned down.', 'bad');
    try {
      image = (await api('POST', '/app/images', await shrinkImage(file, 3000))).url;
      const art = el.querySelector('[data-art]');
      art.style.backgroundImage = `url('${image}')`;
      art.textContent = '';
      toast('Cover art added. Save to keep it.');
    } catch (err) { fail(err); }
  };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) return go(t.dataset.tab === 'published' ? '/media' : `/media/${t.dataset.tab}`);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy) { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); }
    if (b.dataset.ep) {
      try { await patch(`/media/${b.dataset.ep}`, { podcast: Boolean(b.dataset.on) }); drawPodcast(el, head); } catch (err) { fail(err); }
    }
  };
}
