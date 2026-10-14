// Streaming through Mux, the church's own video host: one stream key that never changes (put in
// vMix once), live in the app with our own player, each recording in the media library, and
// trims made as real trimmed copies. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET (Mux → Settings →
// Access Tokens, Mux Video read + write). The hub checks Mux every minute, so no webhook is needed.
import { getSetting, setSetting } from './db.js';
import { localNow } from './http.js';
import { podcastAudio } from './podcast.js';
import { mediaSettings, liveNow, describeVideo, insertMedia, fromService, announce, announceLive, utc, churchTz } from './media.js';

const API = () => (process.env.MB_MUX_API || 'https://api.mux.com').replace(/\/+$/, '');
export const muxConfigured = () => Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
export const RTMP_SERVER = 'rtmps://global-live.mux.com:443/app';
export const muxSettings = (db) => getSetting(db, 'mux', {});
const saveMux = (db, changes) => setSetting(db, 'mux', { ...muxSettings(db), ...changes });

export const thumb = (playbackId, time = 0, width = 960) => `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${Math.max(0, Math.round(time))}&width=${width}`;

async function mux(method, path, body) {
  if (!muxConfigured()) throw new Error('Mux isn’t set up yet: add MUX_TOKEN_ID and MUX_TOKEN_SECRET in Render.');
  const res = await fetch(`${API()}${path}`, {
    method,
    signal: AbortSignal.timeout(20e3),
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString('base64')}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.messages?.join(' ') || data.error?.type || `Mux answered ${res.status}.`;
    const e = new Error(res.status === 401 ? 'Mux didn’t accept the access token. Check MUX_TOKEN_ID and MUX_TOKEN_SECRET in Render.' : msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------- the stream key
// Made once; the key stays the same until someone resets it.
export async function ensureLiveStream(db) {
  const m = muxSettings(db);
  if (m.live_stream_id) return m;
  const { data } = await mux('POST', '/video/v1/live-streams', {
    playback_policy: ['public'],
    new_asset_settings: { playback_policy: ['public'] },
    reconnect_window: 60,
    latency_mode: 'standard',
  });
  saveMux(db, { live_stream_id: data.id, stream_key: data.stream_key, playback_id: data.playback_ids?.[0]?.id || '' });
  return muxSettings(db);
}

export async function resetStreamKey(db) {
  const m = muxSettings(db);
  if (!m.live_stream_id) throw new Error('Make a stream key first.');
  const { data } = await mux('POST', `/video/v1/live-streams/${m.live_stream_id}/reset-stream-key`);
  saveMux(db, { stream_key: data.stream_key });
  return muxSettings(db);
}

// Also send the stream on to YouTube (Mux forwards it). url: YouTube's server address.
export async function setYouTubeForward(db, { url, key }) {
  const m = muxSettings(db);
  if (!m.live_stream_id) throw new Error('Make a stream key first.');
  if (m.simulcast_id) await mux('DELETE', `/video/v1/live-streams/${m.live_stream_id}/simulcast-targets/${m.simulcast_id}`).catch((e) => { if (e.status !== 404) throw e; });
  if (!key) { saveMux(db, { simulcast_id: null }); return muxSettings(db); }
  const { data } = await mux('POST', `/video/v1/live-streams/${m.live_stream_id}/simulcast-targets`, { url: url || 'rtmp://a.rtmp.youtube.com/live2', stream_key: key, passthrough: 'YouTube' });
  saveMux(db, { simulcast_id: data.id });
  return muxSettings(db);
}

// ---------------------------------------------------------------- live
// The service on now: from 30 minutes before it starts until it should be over (at least 3 hours).
export function serviceAround(db, at = Date.now()) {
  const local = localNow(churchTz(db), new Date(at));
  const now = Date.parse(`${local.date}T${local.time}:00Z`);
  const yesterday = new Date(now - 86400e3).toISOString().slice(0, 10);
  return db.prepare('SELECT id, title, starts_at, duration_min FROM services WHERE substr(starts_at, 1, 10) BETWEEN ? AND ? ORDER BY starts_at').all(yesterday, local.date)
    .find((s) => {
      const t = Date.parse(`${s.starts_at}:00Z`);
      return now >= t - 30 * 60e3 && now <= t + Math.max(180, s.duration_min + 60) * 60e3;
    }) || null;
}

// "Sunday Service · Oct 12", when the order of service doesn't name the message.
function defaultTitle(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} Service · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

// We're live. During a service it shows in the app straight away; at other times (a rehearsal)
// it waits in the hub until someone chooses to show it.
function startLive(db, ls) {
  const svc = serviceAround(db);
  const info = svc ? fromService(db, svc.id) : null;
  const title = info?.title || defaultTitle(localNow(churchTz(db)).date);
  const live = { source: 'mux', playback_id: ls.playback_ids?.[0]?.id || muxSettings(db).playback_id, title, since: utc(Date.now()), public: Boolean(svc), service_id: svc?.id ?? null };
  setSetting(db, 'media_live', live);
  if (live.public) announceLive(db, title);
  return live;
}

// "Show it in the app" for a stream outside service times.
export function showLive(db) {
  const live = liveNow(db);
  if (!live || live.public !== false) return live;
  setSetting(db, 'media_live', { ...live, public: true });
  announceLive(db, live.title);
  return liveNow(db);
}

// ---------------------------------------------------------------- recordings and trims
function importRecording(db, a) {
  const cfg = mediaSettings(db);
  const pid = a.playback_ids?.find((p) => p.policy === 'public')?.id || a.playback_ids?.[0]?.id;
  if (!pid) return null;
  const started = new Date(Number(a.created_at) * 1000 || Date.now()).toISOString();
  const duration = a.duration != null ? Math.round(a.duration) : null;
  const row = describeVideo(db, cfg, { video_id: `mux:${a.id}`, title: '', started, duration, thumbnail: thumb(pid, 300), was_live: true });
  if (!row.service_id) row.title = row.title === 'Service' ? defaultTitle(row.day) : row.title;
  else if (row.title === 'Service') row.title = defaultTitle(row.day);
  Object.assign(row, { source: 'mux', mux_asset_id: a.id, playback_id: pid });
  const why = duration != null && duration < cfg.min_minutes * 60 ? `Under ${cfg.min_minutes} minutes`
    : !row.service_id ? 'Streamed outside service times' : '';
  const id = insertMedia(db, row, why ? { status: 'skipped', skip: why } : {});
  if (id && !why && cfg.notify_new) {
    announce(db, { title: `New message: ${row.title}`, body: [row.speaker, row.series].filter(Boolean).join(' · ') || 'Watch it in the app.', app_url: `/app/#/watch/${id}`, tag: `media-${id}` });
  }
  return id;
}

// A trimmed copy of a recording, made by Mux (a few minutes). Until it's ready the app plays the
// full recording between the same points.
export async function makeClip(db, mediaId) {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!m || m.source !== 'mux' || !m.mux_asset_id) return;
  const want = { start: m.start_sec || 0, end: m.end_sec ?? null };
  if (m.clip_status && m.clip_status !== 'failed' && m.clip_start === want.start && (m.clip_end ?? null) === want.end) return;
  if (m.raw_deleted) throw new Error('The full recording has been removed, so this one can’t be trimmed again.');
  const old = m.clip_asset_id;
  if (!want.start && want.end == null) {
    db.prepare("UPDATE media SET clip_asset_id = NULL, clip_playback_id = NULL, clip_start = NULL, clip_end = NULL, clip_status = '', clip_ready_at = NULL WHERE id = ?").run(m.id);
  } else {
    const { data } = await mux('POST', '/video/v1/assets', {
      input: [{ url: `mux://assets/${m.mux_asset_id}`, start_time: want.start, ...(want.end != null ? { end_time: want.end } : {}) }],
      playback_policy: ['public'],
      video_quality: 'basic',
    });
    db.prepare("UPDATE media SET clip_asset_id = ?, clip_playback_id = ?, clip_start = ?, clip_end = ?, clip_status = 'making', clip_ready_at = NULL WHERE id = ?")
      .run(data.id, data.playback_ids?.[0]?.id || null, want.start, want.end, m.id);
  }
  if (old) await mux('DELETE', `/video/v1/assets/${old}`).catch(() => {});
}

// ---------------------------------------------------------------- uploads from the hub
// A place for the browser to send a video file straight to Mux (it never goes through our
// server). origin: the hub's address, which Mux lets upload.
export async function startUpload(db, mediaId, origin) {
  const { data } = await mux('POST', '/video/v1/uploads', {
    cors_origin: origin || '*',
    new_asset_settings: { playback_policy: ['public'], video_quality: 'basic' },
  });
  db.prepare("UPDATE media SET upload_id = ?, upload_status = 'uploading', upload_at = datetime('now') WHERE id = ?").run(data.id, mediaId);
  return data.url;
}

// The file is in Mux and ready: the video now plays in our own player. Its trim (made on the
// YouTube copy, the same video) carries over.
async function finishUpload(db, row, a) {
  const pid = a.playback_ids?.find((p) => p.policy === 'public')?.id || a.playback_ids?.[0]?.id;
  if (!pid) return;
  const old = row.mux_asset_id && row.mux_asset_id !== a.id ? row.mux_asset_id : null;
  db.prepare(`UPDATE media SET source = 'mux', mux_asset_id = ?, playback_id = ?, duration = COALESCE(?, duration), upload_status = '', upload_id = NULL,
      clip_asset_id = NULL, clip_playback_id = NULL, clip_start = NULL, clip_end = NULL, clip_status = '', clip_ready_at = NULL, raw_deleted = 0
    WHERE id = ?`).run(a.id, pid, a.duration != null ? Math.round(a.duration) : null, row.id);
  if (old) await mux('DELETE', `/video/v1/assets/${old}`).catch(() => {});
  if (row.start_sec || row.end_sec != null) await makeClip(db, row.id).catch(() => {});
}

async function checkUploads(db) {
  const rows = db.prepare("SELECT * FROM media WHERE upload_status IN ('uploading', 'processing') AND upload_id IS NOT NULL").all();
  for (const row of rows) {
    try {
      const { data: up } = await mux('GET', `/video/v1/uploads/${row.upload_id}`);
      if (['errored', 'cancelled', 'timed_out'].includes(up.status)) {
        db.prepare("UPDATE media SET upload_status = 'failed' WHERE id = ?").run(row.id);
        continue;
      }
      if (!up.asset_id) continue;
      const { data: a } = await mux('GET', `/video/v1/assets/${up.asset_id}`);
      if (a.status === 'ready') await finishUpload(db, row, a);
      else if (a.status === 'errored') db.prepare("UPDATE media SET upload_status = 'failed' WHERE id = ?").run(row.id);
      else if (row.upload_status !== 'processing') db.prepare("UPDATE media SET upload_status = 'processing' WHERE id = ?").run(row.id);
    } catch (e) {
      if (e.status === 404) db.prepare("UPDATE media SET upload_status = 'failed' WHERE id = ?").run(row.id);
    }
  }
}

// ---------------------------------------------------------------- every minute
let ticking = null;
export function muxTick(db) {
  ticking ||= tick(db).finally(() => { ticking = null; });
  return ticking;
}

async function tick(db) {
  if (!muxConfigured()) return null;
  await checkUploads(db);
  const m = muxSettings(db);
  if (!m.live_stream_id) { await clipsAndCleanup(db); return { active: false }; }
  const { data: ls } = await mux('GET', `/video/v1/live-streams/${m.live_stream_id}`);
  const active = ls.status === 'active';
  const live = liveNow(db);
  if (active && live?.source !== 'mux') startLive(db, ls);
  if (!active && live?.source === 'mux') setSetting(db, 'media_live', null);

  // Finished recordings (the one being streamed now waits until it's over).
  const { data: assets = [] } = await mux('GET', `/video/v1/assets?live_stream_id=${m.live_stream_id}&limit=10`);
  const known = db.prepare('SELECT 1 FROM media WHERE mux_asset_id = ?');
  for (const a of assets) {
    if (a.status !== 'ready' || (active && a.id === ls.active_asset_id) || a.is_live || known.get(a.id)) continue;
    importRecording(db, a);
  }

  await clipsAndCleanup(db);
  return { active };
}

// Trimmed copies being made, full recordings that can go, and the podcast's audio files.
async function clipsAndCleanup(db) {
  await podcastAudio(db, mux).catch((e) => console.error('Podcast audio:', e.message));
  // Trimmed copies being made.
  for (const row of db.prepare("SELECT id, clip_asset_id FROM media WHERE clip_status = 'making'").all()) {
    try {
      const { data: c } = await mux('GET', `/video/v1/assets/${row.clip_asset_id}`);
      if (c.status === 'ready') db.prepare("UPDATE media SET clip_status = 'ready', clip_playback_id = COALESCE(?, clip_playback_id), clip_ready_at = datetime('now') WHERE id = ? AND clip_asset_id = ?").run(c.playback_ids?.[0]?.id || null, row.id, row.clip_asset_id);
      if (c.status === 'errored') db.prepare("UPDATE media SET clip_status = 'failed' WHERE id = ? AND clip_asset_id = ?").run(row.id, row.clip_asset_id);
    } catch (e) {
      if (e.status === 404) db.prepare("UPDATE media SET clip_status = 'failed' WHERE id = ?").run(row.id);
    }
  }

  // Once a trimmed copy has been ready for a while, the full recording goes (saves storage).
  const days = mediaSettings(db).keep_full_days ?? 30;
  if (days > 0) {
    const old = db.prepare(`SELECT id, mux_asset_id FROM media WHERE source = 'mux' AND clip_status = 'ready' AND raw_deleted = 0 AND clip_ready_at <= datetime('now', ?)`).all(`-${days} days`);
    for (const row of old) {
      try {
        await mux('DELETE', `/video/v1/assets/${row.mux_asset_id}`);
      } catch (e) { if (e.status !== 404) continue; }
      db.prepare('UPDATE media SET raw_deleted = 1 WHERE id = ?').run(row.id);
    }
  }
}
