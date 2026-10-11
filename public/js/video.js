// Playing library videos, in the hub's editor and the app. Streamed through Mux (the church's own
// host), it's a plain video player of our own. From YouTube, the app shows its own picture,
// title and play button and loads YouTube's player only when someone taps play.

// 3723 → "1:02:03", 610 → "10:10"
export function hms(sec) {
  if (sec == null || Number.isNaN(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// "1:02:03" → 3723 (null when blank, NaN when it can't be read)
export function parseHms(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x.trim()))) return NaN;
  return Math.round(parts.reduce((acc, x) => acc * 60 + Number(x), 0));
}

// "1 hr 5 min" / "48 min"
export function lengthText(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.max(1, m)} min`;
}

let api;
// YouTube's player script, once. Resolves to window.YT, or null if it can't load (then a plain
// embedded player is used instead).
export function loadPlayerApi() {
  api ||= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const timer = setTimeout(() => resolve(null), 8000);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(timer); resolve(null); };
    document.head.append(s);
  });
  return api;
}

const embedUrl = (videoId, { start = 0, end = null, autoplay = false } = {}) => {
  const q = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1', iv_load_policy: '3', start: String(start || 0) });
  if (end) q.set('end', String(end));
  if (autoplay) q.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${videoId}?${q}`;
};

// Browsers other than Safari need hls.js to play HLS (Mux's format).
let hlsLib;
function loadHls() {
  hlsLib ||= new Promise((resolve) => {
    if (window.Hls) return resolve(window.Hls);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.19/dist/hls.min.js';
    s.onload = () => resolve(window.Hls || null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return hlsLib;
}

// Our own player for a Mux playback id: just the trimmed part, live or recorded.
async function mountHls(box, { playbackId, start = 0, end = null, autoplay = false, onEnd, poster = '' }) {
  const v = document.createElement('video');
  Object.assign(v, { controls: true, playsInline: true, autoplay, poster, preload: 'metadata' });
  v.setAttribute('playsinline', '');
  box.replaceChildren(v);
  const src = `https://stream.mux.com/${playbackId}.m3u8`;
  let hls = null;
  if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = src;
  else {
    const Hls = await loadHls();
    if (Hls?.isSupported()) { hls = new Hls({ startPosition: start || -1 }); hls.loadSource(src); hls.attachMedia(v); } else v.src = src;
  }
  let ended = false;
  v.addEventListener('loadedmetadata', () => { if (start && v.currentTime < start) v.currentTime = start; }, { once: true });
  v.addEventListener('timeupdate', () => {
    if (end && v.currentTime >= end && !ended) { ended = true; v.pause(); onEnd?.(); }
    if (end && v.currentTime < end - 1) ended = false;
  });
  v.addEventListener('ended', () => { if (!ended) { ended = true; onEnd?.(); } });
  if (autoplay) v.play().catch(() => {});
  return {
    seek(sec) { ended = false; v.currentTime = sec; v.play().catch(() => {}); },
    time: () => v.currentTime,
    pause() { v.pause(); },
    destroy() { hls?.destroy(); v.pause(); v.removeAttribute('src'); v.load(); box.replaceChildren(); },
  };
}

// A player in `box` that plays just the trimmed part. onEnd runs at the trim's end.
// Returns { seek(sec), time() → sec|null, pause(), destroy() }.
export async function mountPlayer(box, { videoId, playbackId, start = 0, end = null, autoplay = false, onEnd, poster } = {}) {
  if (playbackId) return mountHls(box, { playbackId, start, end, autoplay, onEnd, poster });
  const YT = await loadPlayerApi();
  if (!YT) {
    box.innerHTML = `<iframe src="${embedUrl(videoId, { start, end, autoplay })}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe>`;
    return { seek() {}, time: () => null, pause() {}, destroy() { box.innerHTML = ''; } };
  }
  const slot = document.createElement('div');
  box.replaceChildren(slot);
  let timer = null;
  let ended = false;
  const player = new YT.Player(slot, {
    videoId,
    host: 'https://www.youtube-nocookie.com',
    playerVars: { rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, start: start || 0, autoplay: autoplay ? 1 : 0 },
    events: {
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED && !ended) { ended = true; onEnd?.(); }
      },
    },
  });
  // YouTube's own "end" is ignored after seeking, so the trim's end is watched here.
  if (end) {
    timer = setInterval(() => {
      const t = player.getCurrentTime?.();
      if (t != null && t >= end && !ended) { ended = true; player.pauseVideo(); onEnd?.(); }
      if (t != null && t < end - 1) ended = false;
    }, 400);
  }
  return {
    seek(sec) { ended = false; player.seekTo?.(sec, true); player.playVideo?.(); },
    time: () => (player.getCurrentTime ? player.getCurrentTime() : null),
    pause() { player.pauseVideo?.(); },
    destroy() { clearInterval(timer); player.destroy?.(); },
  };
}
