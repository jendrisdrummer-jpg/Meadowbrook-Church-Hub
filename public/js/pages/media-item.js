// One video in the library: the app's own title, trim, picture and tags. YouTube's copy and title
// stay as they are.
import { api, get, patch, html, mount, icon, toast, fail, fmtDate, fmtTime, options, chips, shrinkImage } from '../lib.js';
import { setTitle, go, state } from '../app.js';
import { hms, parseHms, mountPlayer } from '../video.js';

export default async function mediaItem(el, id) {
  const [m, lib] = await Promise.all([get(`/media/${id}`), get('/media?status=published')]);
  setTitle(m.title, html`<a class="btn ghost" href="#/media${m.status === 'published' ? '' : `/${m.status}`}">${icon('back')} Media</a>
    ${m.status === 'published' ? html`<button class="btn" data-status="hidden">Hide from the app</button>` : html`<button class="btn" data-status="published">${icon('check')} Publish</button>`}
    <button class="btn primary" data-save>Save</button>`);
  let topics = [...m.topics];
  let image = m.image;
  let player = null;

  const statusNote = m.status === 'skipped' ? html`<div class="alert">Skipped: ${m.skip_reason}. It isn’t in the app. Choose <b>Publish</b> to add it.</div>`
    : m.status === 'hidden' ? html`<div class="alert">Hidden: it isn’t in the app. Choose <b>Publish</b> to show it again.</div>` : '';
  mount(el, html`${statusNote}<div class="md-edit">
    <div class="stack">
      <div class="card md-player-card"><div class="m-video md-player" data-player></div>
        <div class="md-trim">
          <div class="md-trim-row"><label class="field">Starts at<input type="text" name="start" value="${m.start ? hms(m.start) : ''}" placeholder="0:00" inputmode="numeric"></label>
            <button type="button" class="btn small" data-mark="start">${icon('clock')} Set to now</button>
            <button type="button" class="btn small ghost" data-jump="start">${icon('play')} Play from here</button></div>
          <div class="md-trim-row"><label class="field">Ends at<input type="text" name="end" value="${m.end ? hms(m.end) : ''}" placeholder="${m.duration ? hms(m.duration) : 'The end'}" inputmode="numeric"></label>
            <button type="button" class="btn small" data-mark="end">${icon('clock')} Set to now</button>
            <button type="button" class="btn small ghost" data-jump="end">${icon('play')} Play the last 10 s</button></div>
          <p class="muted small" data-plays style="margin:0"></p>
          <p class="muted small" style="margin:0">Skip the pre-service and announcements: play to where it should start, pause, and click <b>Set to now</b>. The app plays only this part. The video on YouTube doesn’t change.</p>
        </div></div>
      <div class="card stack"><h2 style="margin:0">Picture</h2>
        <div class="md-pic md-pic-big" data-pic style="background-image:url('${m.image || m.thumbnail}')"></div>
        <div class="row"><label class="btn small">${icon('upload')} Use my own picture<input type="file" accept="image/*" data-upload hidden></label>
          <button type="button" class="btn small ghost" data-yt-pic ${m.image ? '' : 'hidden'}>Use the picture from the video</button></div>
        <span class="muted small">Shown on the library card and before it plays. A 16:9 picture works best, like a sermon series graphic.</span></div>
    </div>
    <form class="card stack" data-form>
      <label class="field">Title in the app<input type="text" name="title" value="${m.title}" maxlength="200" required>
        <span class="muted small">On YouTube: ${m.yt_title || '—'} <a href="https://www.youtube.com/watch?v=${m.video_id}" target="_blank" rel="noopener">${icon('external', 'ic small-ic')}</a></span></label>
      <div class="form">
        <label class="field">Speaker<input type="text" name="speaker" value="${m.speaker}" list="md-speakers" maxlength="120"></label>
        <label class="field">Series<input type="text" name="series" value="${m.series}" list="md-series" maxlength="120"></label>
        <label class="field">Scripture<input type="text" name="scripture" value="${m.scripture}" maxlength="200" placeholder="Acts 2:38"></label>
        <label class="field">Date<input type="date" name="day" value="${m.day}"></label>
      </div>
      <div class="field"><span>Topics</span><div data-topics></div><span class="muted small">People can tap a topic in the app to see every message on it.</span></div>
      <label class="field">Service<select name="service_id">${options(m.services.map((s) => ({ value: s.id, label: `${fmtTime(s.starts_at)} · ${s.campus}${s.title ? ` · ${s.title}` : ''}` })), m.service_id ?? '', { blank: m.services.length ? 'Not linked' : 'No services that day' })}</select>
        <span class="row small" style="gap:8px"><button type="button" class="btn small ghost" data-refill ${m.service_id ? '' : 'disabled'}>${icon('wand')} Fill in from the order of service</button></span></label>
      <label class="field">Campus<select name="campus_id">${options(state.campuses.map((c) => ({ value: c.id, label: c.name })), m.campus_id ?? '', { blank: 'All campuses' })}</select></label>
      <label class="field">Notes under the video<textarea name="description" rows="4" maxlength="4000" placeholder="Sermon notes, a link to the series, next steps…">${m.description}</textarea></label>
      <datalist id="md-speakers">${lib.speakers.map((x) => html`<option value="${x}">`)}</datalist>
      <datalist id="md-series">${lib.series.map((x) => html`<option value="${x}">`)}</datalist>
      <p class="muted small" style="margin:0">${m.was_live ? 'Streamed live' : 'Uploaded'} ${fmtDate(new Date(`${m.recorded_at.replace(' ', 'T')}Z`).toLocaleDateString('en-CA'), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${m.duration ? ` · ${hms(m.duration)} long` : ''}</p>
    </form></div>`);

  const f = el.querySelector('[data-form]');
  const startIn = el.querySelector('[name=start]');
  const endIn = el.querySelector('[name=end]');
  chips(el.querySelector('[data-topics]'), topics, (list) => { topics = list; }, { placeholder: 'Faith, Prayer, Family…' });

  const plays = () => {
    const s = parseHms(startIn.value) || 0;
    const e = parseHms(endIn.value) ?? m.duration;
    el.querySelector('[data-plays]').textContent = Number.isNaN(s) || Number.isNaN(e) ? 'Use minutes and seconds, like 12:30 or 1:05:00.'
      : e ? `The app plays ${hms(Math.max(0, e - s))}${m.duration ? ` of ${hms(m.duration)}` : ''}.` : '';
  };
  startIn.oninput = plays;
  endIn.oninput = plays;
  plays();
  mountPlayer(el.querySelector('[data-player]'), { videoId: m.video_id, start: m.start || 0 }).then((p) => { player = p; });

  let dirty = false;
  el.addEventListener('input', () => { dirty = true; });

  el.onclick = async (e) => {
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
    if (b.matches('[data-yt-pic]')) { image = ''; dirty = true; el.querySelector('[data-pic]').style.backgroundImage = `url('${m.thumbnail}')`; b.hidden = true; }
  };
  f.service_id.onchange = () => { el.querySelector('[data-refill]').disabled = !f.service_id.value; };
  el.querySelector('[data-upload]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast('Uploading…');
      image = (await api('POST', '/app/images', await shrinkImage(file, 1600))).url;
      dirty = true;
      el.querySelector('[data-pic]').style.backgroundImage = `url('${image}')`;
      el.querySelector('[data-yt-pic]').hidden = false;
    } catch (err) { fail(err); }
  };

  const body = () => ({
    title: f.title.value, speaker: f.speaker.value, series: f.series.value, scripture: f.scripture.value, day: f.day.value,
    service_id: f.service_id.value || null, campus_id: f.campus_id.value || null, description: f.description.value,
    topics, image, start: startIn.value.trim() || 0, end: endIn.value.trim() || null,
  });
  const actions = document.querySelector('[data-actions]');
  actions.querySelector('[data-save]').onclick = async () => {
    if (!f.reportValidity()) return;
    try { await patch(`/media/${m.id}`, body()); toast(m.status === 'published' ? 'Saved. The app shows it now.' : 'Saved.'); reload(); } catch (err) { fail(err); }
  };
  actions.querySelector('[data-status]').onclick = async (e) => {
    const status = e.currentTarget.dataset.status;
    try {
      await patch(`/media/${m.id}`, { ...(dirty ? body() : {}), status });
      toast(status === 'published' ? 'It’s in the app now.' : 'Hidden from the app.');
      if (status === 'published') reload();
      else go('/media');
    } catch (err) { fail(err); }
  };
  // Leaving the page (or drawing it again) stops the player.
  function off() { player?.destroy(); window.removeEventListener('hashchange', off); }
  function reload() { off(); mediaItem(el, id); }
  window.addEventListener('hashchange', off);
}
