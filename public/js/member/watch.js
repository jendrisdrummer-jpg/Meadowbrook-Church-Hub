// The app's Watch tab: live now (when we are), the latest message, and the library with search
// and speaker, series and topic filters. Each video has its own page with the app's title,
// picture and trim; the player only loads when someone taps play.
import { get, html, mount, icon, fmtDate } from '../lib.js';
import { hms, lengthText, mountPlayer } from '../video.js';

const day = (d) => fmtDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
const meta = (m) => [day(m.day), m.speaker].filter(Boolean).join(' · ');

// A picture with our own play button; tapping it swaps in the player.
const poster = (m, { big = false } = {}) => html`<button class="wv-poster ${big ? 'big' : ''}" data-play="${m.id}" style="background-image:url('${m.picture}')" aria-label="Play ${m.title}">
  <span class="wv-playbtn">${icon('play')}</span>${m.length ? html`<span class="wv-len">${hms(m.length)}</span>` : ''}</button>`;

const card = (m, tab) => html`<a class="wv-card" href="#/${tab.id}/${m.id}">
  <span class="wv-thumb" style="background-image:url('${m.picture}')">${m.length ? html`<span class="wv-len">${hms(m.length)}</span>` : ''}</span>
  <span class="wv-text"><b>${m.title}</b><span class="muted small">${meta(m)}</span>${m.series ? html`<span class="wv-series">${m.series}</span>` : ''}</span></a>`;

export const livePicture = (live) => (live.playback_id ? `https://image.mux.com/${live.playback_id}/thumbnail.jpg?width=960` : `https://i.ytimg.com/vi/${live.video_id}/hqdefault_live.jpg`);

let player = null;
const stop = () => { player?.destroy(); player = null; };
window.addEventListener('hashchange', stop);

async function play(box, m, onEnd) {
  stop();
  box.classList.add('playing');
  player = await mountPlayer(box, { videoId: m.video_id, playbackId: m.playback_id, poster: m.picture, start: m.start, end: m.end, autoplay: true, onEnd });
}

// The library. filters: { q, speaker, series, topic } from the address (#/watch?topic=Faith).
export async function watchPage(el, tab, q, { app, setTitle, videoEmbed }) {
  setTitle(tab.label);
  const d = await get('/watch');
  const live = d.live;
  const items = d.items;
  // Before there's a library: the livestream link from the App Builder, as before.
  if (!items.length && !live) {
    const url = app.config.watch_url;
    const embed = videoEmbed(url);
    mount(el, url
      ? html`${embed ? html`<div class="m-video"><iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Livestream"></iframe></div>` : ''}
        <div class="card m-big-action" style="margin-top:14px">${icon('play')}<a class="btn primary" href="${url}" target="_blank" rel="noopener">Watch ${icon('external')}</a></div>`
      : html`<div class="m-empty">${icon('play')}<p>Past services will show here.</p></div>`);
    return;
  }
  const f = { q: q.get('q') || '', speaker: q.get('speaker') || '', series: q.get('series') || '', topic: q.get('topic') || '' };
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const speakers = uniq(items.map((m) => m.speaker));
  const series = uniq(items.map((m) => m.series));
  const topics = uniq(items.flatMap((m) => m.topics));
  const latest = items[0];

  const draw = () => {
    const needle = f.q.toLowerCase();
    const filtering = f.q || f.speaker || f.series || f.topic;
    const shown = items.filter((m) => (!f.speaker || m.speaker === f.speaker) && (!f.series || m.series === f.series) && (!f.topic || m.topics.includes(f.topic))
      && (!needle || [m.title, m.speaker, m.series, m.scripture, ...m.topics].join(' ').toLowerCase().includes(needle)));
    const list = filtering ? shown : shown.slice(live ? 0 : 1);
    mount(el.querySelector('[data-list]'), list.length ? html`<div class="wv-list">${list.map((m) => card(m, tab))}</div>`
      : html`<div class="m-empty">${icon('search')}<p>${filtering ? 'Nothing matches. Try another word or filter.' : ''}</p></div>`);
    el.querySelector('[data-featured]').hidden = Boolean(filtering);
    for (const [k, v] of Object.entries(f)) { const s = el.querySelector(`[data-f="${k}"]`); if (s && s.value !== v) s.value = v; }
    el.querySelector('[data-clear]').hidden = !filtering;
  };
  const pick = (name, label, list) => (list.length > 1 ? html`<select data-f="${name}" aria-label="${label}"><option value="">${label}</option>${list.map((x) => html`<option value="${x}">${x}</option>`)}</select>` : '');

  mount(el, html`<div data-featured>
      ${live ? html`<div class="wv-live"><div class="m-video wv-box" data-live-box>${poster({ id: 'live', picture: livePicture(live), title: live.title }, { big: true })}</div>
          <div class="wv-head"><span class="wv-badge">${icon('video')} Live</span><b>${live.title}</b></div></div>`
        : latest ? html`<div class="wv-feature"><div class="m-video wv-box" data-box="${latest.id}">${poster(latest, { big: true })}</div>
          <a class="wv-head" href="#/${tab.id}/${latest.id}"><span class="wv-kicker">Latest message</span><b>${latest.title}</b><span class="muted small">${meta(latest)}</span></a></div>` : ''}
    </div>
    <div class="wv-filters"><input type="search" data-f="q" placeholder="Search messages" value="${f.q}">
      <div class="wv-selects">${pick('speaker', 'Speaker', speakers)}${pick('series', 'Series', series)}${pick('topic', 'Topic', topics)}
        <button class="chip" data-clear hidden>${icon('x')} Clear</button></div></div>
    ${!f.q && !f.speaker && !f.series && !f.topic && series.length ? html`<div class="wv-series-row">${series.slice(0, 12).map((s) => {
      const first = items.find((m) => m.series === s);
      return html`<button class="wv-series-tile" data-series="${s}" style="background-image:url('${first.picture}')"><span>${s}</span></button>`;
    })}</div>` : ''}
    <h3 class="wv-h">${live ? 'Messages' : 'More messages'}</h3>
    <div data-list></div>`);

  const sync = () => {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    history.replaceState(null, '', `#/${tab.id}${p.size ? `?${p}` : ''}`);
    draw();
  };
  el.oninput = (e) => {
    const k = e.target.dataset?.f;
    if (!k) return;
    f[k] = e.target.value;
    sync();
  };
  el.onclick = (e) => {
    const p = e.target.closest('[data-play]');
    if (p) {
      e.preventDefault();
      if (p.dataset.play === 'live') return play(el.querySelector('[data-live-box]'), { video_id: live.video_id, playback_id: live.playback_id, picture: livePicture(live), start: 0, end: null });
      return play(p.parentElement, latest, () => { location.hash = `#/${tab.id}/${latest.id}?ended=1`; });
    }
    const s = e.target.closest('[data-series]');
    if (s) { f.series = s.dataset.series; sync(); el.querySelector('.wv-filters').scrollIntoView({ behavior: 'smooth' }); }
    if (e.target.closest('[data-clear]')) { Object.keys(f).forEach((k) => { f[k] = ''; }); sync(); }
  };
  draw();
}

// One message: the player, our title and details, topics to tap, and more from the series.
export async function videoPage(el, tab, id, q, { setTitle }) {
  const m = await get(`/watch/${id}`);
  setTitle(tab.label, html`<a class="btn small ghost" href="#/${tab.id}">Back</a>`);
  const ended = q.get('ended');
  mount(el, html`<div class="m-video wv-box" data-box>${poster(m, { big: true })}</div>
    <div class="wv-detail"><h2>${m.title}</h2>
      <p class="muted" style="margin:0">${[day(m.day), m.speaker, m.length ? lengthText(m.length) : ''].filter(Boolean).join(' · ')}</p>
      ${m.series ? html`<a class="wv-series" href="#/${tab.id}?series=${encodeURIComponent(m.series)}">${m.series}</a>` : ''}
      ${m.scripture ? html`<p class="wv-scripture">${icon('book')} ${m.scripture}</p>` : ''}
      ${m.topics.length ? html`<div class="m-chips">${m.topics.map((t) => html`<a class="chip" href="#/${tab.id}?topic=${encodeURIComponent(t)}">${t}</a>`)}</div>` : ''}
      ${m.description ? html`<p class="wv-notes">${m.description}</p>` : ''}
      ${navigator.share ? html`<button class="btn small" data-share>${icon('send')} Share</button>` : ''}
    </div>
    <div data-after></div>
    ${m.more.length ? html`<h3 class="wv-h">More from ${m.series}</h3><div class="wv-list">${m.more.map((x) => card(x, tab))}</div>` : ''}`);

  const after = () => {
    const next = m.more[0];
    mount(el.querySelector('[data-after]'), html`<div class="card wv-ended"><b>Thanks for watching.</b>
      ${next ? html`<a class="wv-next" href="#/${tab.id}/${next.id}"><span class="wv-thumb" style="background-image:url('${next.picture}')"></span><span><span class="muted small">Up next</span><br><b>${next.title}</b></span></a>` : ''}</div>`);
  };
  if (ended) after();
  el.onclick = async (e) => {
    if (e.target.closest('[data-play]')) { e.preventDefault(); return play(el.querySelector('[data-box]'), m, after); }
    if (e.target.closest('[data-share]')) {
      navigator.share({ title: m.title, url: `${location.origin}/app/#/watch/${m.id}` }).catch(() => {});
    }
  };
}
