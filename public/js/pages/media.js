// Media: one Library of every video from the church's YouTube channel (or its messages playlist).
// Videos come into the app on their own; here staff sort out the few that need a look, fix titles
// and trims, and set up where videos come from. A video opens in a side panel (a full-screen
// sheet on a phone); its address, #/media/12, still opens that panel.
import { api, get, post, put, patch, html, mount, icon, dialog, toast, fail, fmtDate, fmtTime, options, debounce, confirm, shrinkImage, chips } from '../lib.js';
import { setTitle, go, state, refreshAttentionBadges } from '../app.js';
import { hms, parseHms, mountPlayer } from '../video.js';

// The three places a video can be, with the chip that shows each.
const GROUPS = [['app', 'In the app'], ['out', 'Not in the app'], ['look', 'Needs a look']];
const groupOf = (m) => (m.status === 'published' ? 'app' : m.status === 'review' ? 'look' : 'out');
let lastGroup = '';

const ago = (utc) => {
  if (!utc) return 'never';
  const mins = Math.round((Date.now() - new Date(`${utc.replace(' ', 'T')}Z`)) / 60e3);
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} minutes ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} hours ago`;
  return fmtDate(new Date(`${utc.replace(' ', 'T')}Z`).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric' });
};
const when = (m) => fmtDate(m.day, { month: 'short', day: 'numeric', year: 'numeric' });

// tab: 'setup' draws Setup; anything else is the Library (old links like /media/skipped open it
// on that chip). opts.open: a video to open in the panel (the deep link /media/12).
export default async function media(el, tab, opts = {}) {
  if (tab === 'setup') return drawSetup(el);
  const lib = await get('/media');
  const cfg = lib.settings;
  const count = (g) => lib.items.filter((m) => groupOf(m) === g).length;
  let group = tab === 'skipped' || tab === 'hidden' ? 'out' : lastGroup;
  if (!group) group = count('app') ? 'app' : count('look') ? 'look' : count('out') ? 'out' : 'app';
  let q = '';
  let series = '';
  const connected = Boolean(cfg.channel_id);

  setTitle('Media', html`<button class="btn primary" data-add>${icon('plus')} Add a video</button>
    <button class="btn" data-sync ${connected ? '' : 'disabled'}>${icon('download')} Check for new videos</button>
    <a class="btn ghost" href="#/media/setup">${icon('settings')} Setup</a>`);
  const actions = document.querySelector('[data-actions]');
  actions.querySelector('[data-sync]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = await post('/media/sync', {});
      const bits = [r.added ? `${r.added} new in the app` : '', r.review ? `${r.review} to look at` : '', r.skipped ? `${r.skipped} left out` : ''].filter(Boolean);
      toast(bits.length ? `${bits.join(', ')}.` : 'You’re up to date.');
      refreshAttentionBadges(true);
      media(el, tab);
    } catch (err) { fail(err); b.disabled = false; }
  };
  actions.querySelector('[data-add]').onclick = async () => {
    let made = null;
    const ok = await dialog({
      title: 'Add a video', submit: 'Add',
      body: html`<label class="field">YouTube address<input type="url" name="url" placeholder="https://www.youtube.com/watch?v=…" required></label>
        <p class="muted small" style="margin:0">For a special service, or anything left out. It goes straight into the app; you can fix its title and trim next.</p>`,
      onSubmit: async (f) => { made = await post('/media', { url: f.url.value }); },
    });
    if (ok && made) { lastGroup = 'app'; await media(el, tab, { open: made.id }); }
  };

  const shown = () => {
    const needle = q.toLowerCase();
    return lib.items.filter((m) => groupOf(m) === group && (!series || m.series === series)
      && (!needle || [m.title, m.speaker, m.series, m.scripture, m.yt_title, ...m.topics].join(' ').toLowerCase().includes(needle)));
  };
  const card = (m) => {
    const g = groupOf(m);
    return html`<button type="button" class="md-card" data-open="${m.id}">
      <span class="md-pic" style="background-image:url('${m.picture}')">${m.length ? html`<span class="md-len">${hms(m.length)}</span>` : ''}${m.start || m.end ? html`<span class="md-trimmed">${icon('edit')} Trimmed</span>` : ''}</span>
      <span class="md-body"><b>${m.title}</b>
        <span class="muted small">${when(m)}</span>
        ${m.series || m.speaker ? html`<span class="muted small">${[m.series, m.speaker].filter(Boolean).join(' · ')}</span>` : ''}
        <span class="md-status">${g === 'app' ? html`<span class="pill good">${icon('check')} In the app</span>` : g === 'look' ? html`<span class="pill warn">Needs a look</span>` : html`<span class="pill">Not in the app</span>`}</span>
        ${m.reason ? html`<span class="md-why small">${m.reason}</span>` : ''}</span></button>`;
  };
  const draw = () => {
    const list = shown();
    mount(el.querySelector('[data-chips]'), html`${GROUPS.map(([g, label]) => html`<button type="button" class="md-fchip ${g === group ? 'on' : ''} ${g === 'look' && count('look') && g !== group ? 'needs' : ''}" data-group="${g}" aria-pressed="${g === group}">${label} <span class="md-n">${count(g)}</span></button>`)}`);
    mount(el.querySelector('[data-list]'), list.length ? html`<div class="md-grid">${list.map(card)}</div>`
      : html`<div class="card empty">${lib.items.length === 0
        ? (connected ? 'No videos yet. They come in on their own; Check for new videos looks now.' : html`No videos yet. Connect your YouTube channel in <a href="#/media/setup">Setup</a> and every video comes in on its own, or use <b>Add a video</b> for a single YouTube link.`)
        : q || series ? 'Nothing matches.'
          : group === 'look' ? 'Nothing needs a look. You’re all caught up.' : group === 'out' ? 'Nothing is left out. Short clips and Shorts land here, in case you want one in the app.' : 'Nothing in the app yet.'}</div>`);
    const hint = el.querySelector('[data-hint]');
    hint.hidden = group === 'app';
    hint.textContent = group === 'look' ? 'Open a video and choose Show in app, or Hide it. Nothing here is in the app until you decide.'
      : group === 'out' ? `Left out because it’s a Short, shorter than ${cfg.min_minutes} minutes, has a skipped word in its title, or you hid it. Open one and choose Show in app to add it.` : '';
  };

  const live = lib.status.live;
  mount(el, html`${live ? html`<div class="alert good md-live"><span class="md-dot"></span><span><b>Live now:</b> ${live.title}. The app’s Watch tab is showing it.</span></div>` : ''}
    ${lib.status.last_error ? html`<div class="alert bad">The last check didn’t work: ${lib.status.last_error}</div>` : ''}
    <div class="md-chips" data-chips></div>
    <p class="muted small md-hint" data-hint hidden></p>
    <div class="row md-tools"><input type="search" placeholder="Search titles, speakers, series…" data-q class="grow" aria-label="Search">
      ${lib.series.length ? html`<select data-series aria-label="Series">${options(lib.series.map((x) => ({ value: x, label: x })), '', { blank: 'Every series' })}</select>` : ''}</div>
    <div data-list></div>
    <p class="muted small md-last">${lib.status.last_sync ? html`Last checked ${ago(lib.status.last_sync)}${cfg.playlist_id ? ` · reading the playlist “${cfg.playlist_title || 'Sunday messages'}”` : cfg.channel_title ? ` · ${cfg.channel_title}` : ''}. New videos come in on their own every hour.`
      : connected ? 'Not checked yet. New videos come in on their own every hour.' : 'Not connected to YouTube yet.'}</p>`);

  el.onclick = (e) => {
    const g = e.target.closest('[data-group]');
    if (g) { group = g.dataset.group; lastGroup = group; draw(); return; }
    const c = e.target.closest('[data-open]');
    if (c) openPanel(Number(c.dataset.open), { lib, el, redraw: draw, reload: async () => { Object.assign(lib, await get('/media')); draw(); refreshAttentionBadges(true); } });
  };
  el.querySelector('[data-q]').oninput = debounce((e) => { q = e.target.value; draw(); }, 150);
  const se = el.querySelector('[data-series]');
  if (se) se.onchange = () => { series = se.value; draw(); };
  draw();
  if (opts.open) openPanel(opts.open, { lib, el, redraw: draw, reload: async () => { Object.assign(lib, await get('/media')); draw(); refreshAttentionBadges(true); } });
}

// ---------------------------------------------------------------- one video, in a side panel
async function openPanel(id, ctx) {
  const { lib } = ctx;
  let m;
  try { m = await get(`/media/${id}`); } catch (e) { fail(e); history.replaceState(null, '', '#/media'); return; }
  history.replaceState(null, '', `#/media/${id}`);
  let topics = [...m.topics];
  let image = m.image;
  let player = null;
  let dirty = false;
  const trimmed = Boolean(m.start || m.end) && !m.raw_deleted;
  const group = groupOf(m);
  const yt = m.source !== 'mux' && m.video_id ? `https://www.youtube.com/watch?v=${m.video_id}` : '';

  const dlg = document.createElement('dialog');
  dlg.className = 'md-panel';
  mount(dlg, html`<form data-form novalidate>
    <div class="md-panel-head"><h2>${m.title}</h2><button type="button" class="icon-btn" data-cancel aria-label="Close">${icon('x')}</button></div>
    <div class="md-panel-body">
      ${group === 'look' ? html`<div class="alert">${m.reason ? `${m.reason}. ` : ''}It isn’t in the app yet. Choose <b>Show in app</b> or <b>Hide from the app</b>.</div>`
        : group === 'out' ? html`<div class="alert">${m.reason ? `${m.reason}. ` : ''}It isn’t in the app. Choose <b>Show in app</b> to add it.</div>` : ''}
      <div class="md-pic md-pic-big" data-pic style="background-image:url('${m.image || m.mux_thumb || m.thumbnail || m.picture}')"></div>
      <label class="field">Title in the app<input type="text" name="title" value="${m.title}" maxlength="200" required>
        ${yt ? html`<span class="muted small">On YouTube: ${m.yt_title || '—'}</span>` : ''}</label>
      <div class="form">
        <label class="field">Date<input type="date" name="day" value="${m.day}"></label>
        <label class="field">Series<input type="text" name="series" value="${m.series}" list="md-series" maxlength="120" autocomplete="off" placeholder="Pick one or type a new one"></label>
        <label class="field">Speaker<input type="text" name="speaker" value="${m.speaker}" list="md-speakers" maxlength="120" autocomplete="off"></label>
        <label class="field">Scripture<input type="text" name="scripture" value="${m.scripture}" maxlength="200" placeholder="Acts 2:38"></label>
        <label class="field">Campus<select name="campus_id">${options(state.campuses.map((c) => ({ value: c.id, label: c.name })), m.campus_id ?? '', { blank: 'All campuses' })}</select></label>
      </div>
      <datalist id="md-series">${lib.series.map((x) => html`<option value="${x}">`)}</datalist>
      <datalist id="md-speakers">${lib.speakers.map((x) => html`<option value="${x}">`)}</datalist>
      <label class="field">Notes under the video<textarea name="description" rows="4" maxlength="4000" placeholder="Sermon notes, a link to the series, next steps…">${m.description}</textarea></label>
      <details class="md-more" ${trimmed ? 'open' : ''} data-trim-box><summary>Trim the start and end</summary>
        <div class="md-more-body">
          <div class="m-video md-player" data-player></div>
          <div class="md-trim-row"><label class="field">Starts at<input type="text" name="start" value="${m.raw_deleted ? '' : m.start ? hms(m.start) : ''}" placeholder="0:00" inputmode="numeric" ${m.raw_deleted ? 'disabled' : ''}></label>
            <button type="button" class="btn small" data-mark="start">${icon('clock')} Set to now</button>
            <button type="button" class="btn small ghost" data-jump="start">${icon('play')} Play from here</button></div>
          <div class="md-trim-row"><label class="field">Ends at<input type="text" name="end" value="${m.raw_deleted ? '' : m.end ? hms(m.end) : ''}" placeholder="${m.duration ? hms(m.duration) : 'The end'}" inputmode="numeric" ${m.raw_deleted ? 'disabled' : ''}></label>
            <button type="button" class="btn small" data-mark="end">${icon('clock')} Set to now</button>
            <button type="button" class="btn small ghost" data-jump="end">${icon('play')} Play the last 10 s</button></div>
          <p class="muted small" data-plays style="margin:0"></p>
          <p class="muted small" style="margin:0">Skip the pre-service and announcements: play to where it should start, pause, and choose <b>Set to now</b>. The app plays only this part. The video on YouTube doesn’t change.</p>
        </div></details>
      <details class="md-more"><summary>Topics, picture and service</summary>
        <div class="md-more-body">
          <div class="field"><span>Topics</span><div data-topics></div><span class="muted small">People can tap a topic in the app to see every message on it.</span></div>
          <div class="field"><span>Picture</span>
            <div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn small">${icon('upload')} Use my own picture<input type="file" accept="image/*" data-upload hidden></label>
              <button type="button" class="btn small ghost" data-yt-pic ${m.image ? '' : 'hidden'}>Use the picture from the video</button></div>
            <span class="muted small">Shown on the card and before it plays. A 16:9 picture works best.</span></div>
          <label class="field">Service<select name="service_id">${options(m.services.map((s) => ({ value: s.id, label: `${fmtTime(s.starts_at)} · ${s.campus}${s.title ? ` · ${s.title}` : ''}` })), m.service_id ?? '', { blank: m.services.length ? 'Not linked' : 'No services that day' })}</select>
            <span class="row small" style="gap:8px"><button type="button" class="btn small ghost" data-refill ${m.service_id ? '' : 'disabled'}>${icon('wand')} Fill in from the order of service</button></span></label>
        </div></details>
      <p class="muted small" style="margin:0">${m.was_live ? 'Streamed live' : 'Added'} ${fmtDate(new Date(`${m.recorded_at.replace(' ', 'T')}Z`).toLocaleDateString('en-CA'), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${m.duration ? ` · ${hms(m.duration)} long` : ''}</p>
    </div>
    <div class="md-panel-foot">
      ${m.status === 'published' ? html`<button type="button" class="btn" data-status="hidden">Hide from the app</button>` : html`<button type="button" class="btn ${group === 'app' ? '' : 'primary'}" data-status="published">${icon('check')} Show in app</button>`}
      ${yt ? html`<a class="btn ghost" href="${yt}" target="_blank" rel="noopener">${icon('external')} Open on YouTube</a>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div></form>`);
  document.body.append(dlg);
  const f = dlg.querySelector('[data-form]');
  const startIn = f.start;
  const endIn = f.end;
  chips(dlg.querySelector('[data-topics]'), topics, (list) => { topics = list; dirty = true; }, { placeholder: 'Faith, Prayer, Family…' });

  const plays = () => {
    const s = parseHms(startIn.value) || 0;
    const e = parseHms(endIn.value) ?? m.duration;
    dlg.querySelector('[data-plays]').textContent = Number.isNaN(s) || Number.isNaN(e) ? 'Use minutes and seconds, like 12:30 or 1:05:00.'
      : e ? `The app plays ${hms(Math.max(0, e - s))}${m.duration ? ` of ${hms(m.duration)}` : ''}.` : '';
  };
  startIn.oninput = plays;
  endIn.oninput = plays;
  plays();
  // The player loads only when the trim section is opened (it's a heavy embed).
  const box = dlg.querySelector('[data-trim-box]');
  let mounted = false;
  const mountIt = () => {
    if (mounted || !box.open) return;
    mounted = true;
    const src = m.source === 'mux' ? { playbackId: m.raw_playback_id || m.playback_id, poster: m.mux_thumb || m.picture } : { videoId: m.video_id };
    if (m.source === 'mux' && !src.playbackId) dlg.querySelector('[data-player]').innerHTML = '<div class="md-wait">This video isn’t ready to play here yet.</div>';
    else mountPlayer(dlg.querySelector('[data-player]'), { ...src, start: m.raw_deleted ? 0 : m.start || 0 }).then((p) => { player = p; });
  };
  box.addEventListener('toggle', mountIt);
  mountIt();

  const body = () => ({
    title: f.title.value, speaker: f.speaker.value, series: f.series.value, scripture: f.scripture.value, day: f.day.value,
    service_id: f.service_id.value || null, campus_id: f.campus_id.value || null, description: f.description.value,
    topics, image, start: startIn.value.trim() || 0, end: endIn.value.trim() || null,
  });
  // A series typed in another case joins the one already in the library.
  f.series.onchange = () => { const hit = lib.series.find((x) => x.toLowerCase() === f.series.value.trim().toLowerCase()); if (hit) f.series.value = hit; };
  dlg.addEventListener('input', () => { dirty = true; });

  const finish = () => { player?.destroy(); player = null; window.removeEventListener('hashchange', onHash); dlg.close(); };
  const onHash = () => finish();
  window.addEventListener('hashchange', onHash);
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (location.hash === `#/media/${id}`) history.replaceState(null, '', '#/media');
  });
  const askClose = async () => {
    if (dirty && !(await confirm('Leave without saving?', 'Your changes to this video won’t be kept.', 'Leave', { danger: false }))) return;
    finish();
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); askClose(); });
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) return askClose();
    if (e.target.closest('[data-cancel]')) return askClose();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mark) {
      const t = player?.time();
      if (t == null) return toast('Play the video first, or type the time.');
      (b.dataset.mark === 'start' ? startIn : endIn).value = hms(t);
      dirty = true;
      plays();
    }
    if (b.dataset.jump) {
      const s = parseHms(startIn.value) || 0;
      const end = parseHms(endIn.value);
      if (b.dataset.jump === 'start') player?.seek(s);
      else player?.seek(Math.max(s, (end ?? m.duration ?? 10) - 10));
    }
    if (b.matches('[data-refill]')) {
      try {
        const s = await get(`/media/from-service/${f.service_id.value}`);
        if (s.title) f.title.value = s.title;
        if (s.speaker) f.speaker.value = s.speaker;
        if (s.series) f.series.value = s.series;
        f.day.value = s.day;
        f.campus_id.value = s.campus_id ?? '';
        dirty = true;
        toast(s.title || s.speaker ? 'Filled in. Save to keep it.' : 'That order of service doesn’t name a message or speaker yet.');
      } catch (err) { fail(err); }
    }
    if (b.matches('[data-yt-pic]')) { image = ''; dirty = true; dlg.querySelector('[data-pic]').style.backgroundImage = `url('${m.mux_thumb || m.thumbnail}')`; b.hidden = true; }
    if (b.dataset.status) {
      const status = b.dataset.status;
      b.disabled = true;
      try {
        await patch(`/media/${m.id}`, { ...(dirty ? body() : {}), status });
        toast(status === 'published' ? 'It’s in the app now.' : 'Hidden from the app.');
        finish();
        ctx.reload();
      } catch (err) { fail(err); b.disabled = false; }
    }
  });
  f.service_id.onchange = () => { dlg.querySelector('[data-refill]').disabled = !f.service_id.value; };
  dlg.querySelector('[data-upload]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast('Uploading…');
      image = (await api('POST', '/app/images', await shrinkImage(file, 1600))).url;
      dirty = true;
      dlg.querySelector('[data-pic]').style.backgroundImage = `url('${image}')`;
      dlg.querySelector('[data-yt-pic]').hidden = false;
    } catch (err) { fail(err); }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const save = f.querySelector('button[type=submit]');
    save.disabled = true;
    try {
      const r = await patch(`/media/${m.id}`, body());
      if (r.clip_error) toast(`Saved, but the trimmed copy couldn’t be made: ${r.clip_error}`, 'bad');
      else toast(m.status === 'published' ? 'Saved. The app shows it now.' : 'Saved.');
      finish();
      ctx.reload();
    } catch (err) { fail(err); save.disabled = false; }
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- Setup
// After a messages playlist is chosen: videos already in the app that aren't in it. Hiding moves
// them to Not in the app (nothing is deleted; Show in app brings one back).
async function offerHide(count) {
  const n = `${count} ${count === 1 ? 'video' : 'videos'}`;
  if (!(await confirm(`Hide ${n} that aren’t in this playlist?`, `${n} in the app ${count === 1 ? 'isn’t' : 'aren’t'} in your messages playlist. Hiding moves ${count === 1 ? 'it' : 'them'} to Not in the app, with the reason “Not in the messages playlist”. Nothing is deleted, and you can show any of them again.`, `Hide ${n}`, { danger: false }))) return false;
  const r = await post('/media/playlist-extras/hide', {});
  toast(`${r.hidden} ${r.hidden === 1 ? 'video' : 'videos'} moved to Not in the app.`);
  refreshAttentionBadges(true);
  return true;
}

async function drawSetup(el) {
  const setup = await get('/media/setup');
  const extras = setup.settings.playlist_id ? await get('/media/playlist-extras').catch((e) => ({ count: 0, error: e.message })) : { count: 0 };
  const { settings: s, status, formats, api_key: hasKey } = setup;
  setTitle('Media setup', html`<a class="btn ghost" href="#/media">${icon('back')} Library</a>`);
  mount(el, html`<div class="md-setup-col stack">
    <form class="card stack" data-form>
      <h2 style="margin:0">YouTube channel ${s.channel_id ? html`<span class="pill good">${icon('check')} Connected</span>` : html`<span class="pill warn">Not connected</span>`}</h2>
      <p class="muted small" style="margin:0">Videos come in on their own, every hour. Each one gets its date, campus, speaker, series and title from that day’s order of service when it can. Nothing on YouTube ever changes.</p>
      <label class="field">Channel address or @handle<input type="text" name="channel" value="${s.channel_input}" placeholder="youtube.com/@yourchurch">
        ${s.channel_id ? html`<span class="small">${s.channel_title || s.channel_id} · last checked ${ago(status.last_sync)}</span>` : ''}</label>
      ${status.last_error ? html`<div class="alert bad">${status.last_error}</div>` : ''}

      <h2 style="margin:10px 0 0">Sunday messages playlist ${s.playlist_id ? html`<span class="pill good">${icon('check')} In use</span>` : html`<span class="pill">Not set</span>`}</h2>
      <label class="field">Only bring in videos from this playlist<input type="text" name="playlist" value="${s.playlist_input}" placeholder="youtube.com/playlist?list=PL…">
        <span class="muted small">${s.playlist_id ? `Reading “${s.playlist_title || 'your playlist'}”. Only videos you add to it come into the app.` : 'Make a playlist on YouTube for your Sunday messages, then paste its address here. Leave this empty to bring in every video on the channel.'}</span></label>

      ${extras.count ? html`<div class="alert"><span class="grow">${extras.count} ${extras.count === 1 ? 'video' : 'videos'} in the app ${extras.count === 1 ? 'isn’t' : 'aren’t'} in this playlist.</span>
        <button type="button" class="btn small" data-hide-extras>Hide ${extras.count} ${extras.count === 1 ? 'video' : 'videos'} that aren’t in this playlist</button></div>` : extras.error ? html`<p class="muted small" style="margin:0">${extras.error}</p>` : ''}

      <h2 style="margin:10px 0 0">Which videos stay out</h2>
      <label class="field">Videos are at least<span class="row" style="gap:8px"><input type="number" name="min_minutes" min="1" max="180" value="${s.min_minutes}" style="width:90px"> minutes long</span>
        <span class="muted small">Shorter videos and YouTube Shorts stay out of the app. You’ll still find them under Not in the app.</span></label>
      <p class="muted small" style="margin-top:-6px">Only used when there’s no messages playlist. With a playlist, every video in it comes in, however long.</p>
      <label class="field">Skip videos whose title contains…<input type="text" name="skip_words" value="${s.skip_words}" placeholder="kids, vbs, youth camp">
        <span class="muted small">Separate words with commas; capital letters don’t matter. A backup for things like kids’ ministry videos. Skipped videos are kept under Not in the app, so you can still add one by hand.</span></label>
      <label class="field">How your video titles are written<select name="title_format">${options(Object.entries(formats).map(([value, label]) => ({ value, label })), s.title_format)}</select>
        <span class="muted small">Used when the order of service doesn’t name the message. With “Series | Title”, a video called <i>Unshakable | Standing Firm</i> becomes “Standing Firm” in the series “Unshakable”.</span></label>

      <h2 style="margin:10px 0 0">Notices</h2>
      <label class="check"><input type="checkbox" name="notify_live" ${s.notify_live ? 'checked' : ''}> Tell the app when we go live</label>
      <label class="check"><input type="checkbox" name="notify_new" ${s.notify_new ? 'checked' : ''}> Tell the app when a new message is added</label>
      <span class="muted small" style="margin-top:-6px">Goes to everyone with notifications on, including guests who turned on announcements. People can turn these off for themselves.</span>
      <div class="row end"><button class="btn primary">Save</button></div>
    </form>

    <div class="card stack">
      <h2 style="margin:0">YouTube API key ${hasKey ? html`<span class="pill good">${icon('check')} On</span>` : html`<span class="pill">Off</span>`}</h2>
      ${hasKey
        ? html`<p class="small" style="margin:0">With the key on, the hub can <b>see all your videos, not just the latest 15</b>, with each one’s exact length and whether it’s live.</p>
          <button class="btn" data-deep style="justify-self:start" ${s.channel_id ? '' : 'disabled'}>${icon('download')} Bring in older videos</button>
          <span class="muted small">Goes back through ${s.playlist_id ? 'the whole playlist' : 'the whole channel'} once. Each video is sorted the same way as new ones.</span>`
        : html`<p class="small" style="margin:0">Off. Without a key the hub sees only the latest 15 videos and has to read each one’s page for its length, so some may need a look. A free key lets it <b>see all your videos, not just the latest 15</b>.</p>
          <details class="small"><summary><b>Steps for whoever manages the church’s hosting (about 5 minutes)</b></summary><ol class="small md-steps">
            <li>Go to <b>console.cloud.google.com</b>, in the same project you use for Google sign-in.</li>
            <li><b>APIs &amp; Services → Library</b>: find <b>YouTube Data API v3</b> and click <b>Enable</b>.</li>
            <li><b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Click the key, under <b>API restrictions</b> pick <b>YouTube Data API v3</b>, and save.</li>
            <li>In Render → your service → <b>Environment</b>, add <code>YOUTUBE_API_KEY</code> with that key. (Only there, never in an email or chat.)</li></ol></details>`}
    </div>

    <div class="card stack">
      <h2 style="margin:0">Going live</h2>
      <p class="small" style="margin:0">Around service times (from 30 minutes before a service starts to 2 hours after) the hub asks YouTube every couple of minutes whether you’re live. When you are, the Watch tab shows it at the top. A live video comes into the library once it’s over. At other times the hourly check is enough.</p>
      ${status.live ? html`<span class="pill good">Live now: ${status.live.title}</span>` : ''}
    </div></div>`);

  const f = el.querySelector('[data-form]');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button.primary');
    b.disabled = true;
    try {
      const r = await put('/media/setup', { channel: f.channel.value, playlist: f.playlist.value, skip_words: f.skip_words.value, title_format: f.title_format.value, min_minutes: Number(f.min_minutes.value), notify_live: f.notify_live.checked, notify_new: f.notify_new.checked });
      const first = r.settings.channel_id && !s.channel_id;
      if (first || r.settings.playlist_id !== s.playlist_id) {
        toast(first ? `Connected to ${r.settings.channel_title || 'your channel'}. Looking for videos…` : 'Saved. Looking for videos…');
        await post('/media/sync', {}).catch(fail);
        refreshAttentionBadges(true);
        if (r.settings.playlist_id && r.settings.playlist_id !== s.playlist_id) {
          const more = await get('/media/playlist-extras').catch(() => ({ count: 0 }));
          if (more.count) await offerHide(more.count).catch(fail);
        }
        return go('/media');
      }
      toast('Saved.');
      drawSetup(el);
    } catch (err) { fail(err); b.disabled = false; }
  };
  const hideBtn = el.querySelector('[data-hide-extras]');
  if (hideBtn) hideBtn.onclick = async () => { try { if (await offerHide(extras.count)) drawSetup(el); } catch (err) { fail(err); } };
  const deep = el.querySelector('[data-deep]');
  if (deep) {
    deep.onclick = async () => {
      deep.disabled = true;
      deep.textContent = 'Bringing in older videos…';
      try {
        const r = await post('/media/sync', { deep: true });
        toast(`${r.added} added to the app${r.review ? `, ${r.review} to look at` : ''}${r.skipped ? `, ${r.skipped} left out` : ''}.`);
        refreshAttentionBadges(true);
        go('/media');
      } catch (err) { fail(err); deep.disabled = false; }
    };
  }
}
