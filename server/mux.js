// Streaming through Mux, the church's own video host: one stream key that never changes (put in
// vMix once), live in the app with our own player, each recording in the media library, the
// message cut out of it as a real clipped copy, and (if the church chooses) old services moved to
// their YouTube copy so Mux storage stays small. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET (Mux → Settings →
// Access Tokens, Mux Video read + write). The hub checks Mux every minute, so no webhook is needed.
import { getSetting, setSetting, tx } from './db.js';
import { localNow, audit } from './http.js';
import { notify } from './notify.js';
import { podcastAudio } from './podcast.js';
import { mediaSettings, liveNow, describeVideo, insertMedia, fromService, announce, announceLive, utc, churchTz, autoLink, youtubeIdOf, youtubeCopies, KEEP_MUX_CHOICES } from './media.js';

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

// Deleting from Mux is permanent. A 404 means it is already gone. Every deletion is audited
// (no signed-in person for the background jobs, so the log shows the hub itself). `why` says which
// rule asked for it.
async function removeAsset(db, { asset, mediaId, kind, why }, req = {}) {
  try { await mux('DELETE', `/video/v1/assets/${asset}`); } catch (e) { if (e.status !== 404) throw e; }
  audit(db, req, 'media.mux_asset_deleted', { media_id: mediaId, asset, kind, why });
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
  // The YouTube copy of this service may already be in the library: one item, not two. (If that
  // copy was in the app already, people were told about it then.)
  const merged = id ? autoLink(db).find((l) => l.id === id) : null;
  if (id && !why && cfg.notify_new && !(merged && merged.absorbed.status === 'published')) {
    announce(db, { title: `New message: ${row.title}`, body: [row.speaker, row.series].filter(Boolean).join(' · ') || 'Watch it in the app.', app_url: `/app/#/watch/${id}`, tag: `media-${id}` });
  }
  return id;
}

// A trimmed copy of a recording, made by Mux (a few minutes). Until it's ready the app plays the
// full recording between the same points.
export async function makeClip(db, mediaId, req = {}) {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!m || m.source !== 'mux' || !m.mux_asset_id) return;
  const want = { start: m.start_sec || 0, end: m.end_sec ?? null };
  if (m.clip_status && m.clip_status !== 'failed' && m.clip_start === want.start && (m.clip_end ?? null) === want.end) return;
  if (m.raw_deleted) throw new Error('The full recording has been removed, so this one can’t be trimmed again.');
  const old = m.clip_asset_id;
  if (!want.start && want.end == null) {
    db.prepare("UPDATE media SET clip_asset_id = NULL, clip_playback_id = NULL, clip_start = NULL, clip_end = NULL, clip_status = '', clip_ready_at = NULL WHERE id = ?").run(m.id);
  } else {
    // Mux clips a recording by making a new asset whose input is the source asset with start and end times.
    const { data } = await mux('POST', '/video/v1/assets', {
      input: [{ url: `mux://assets/${m.mux_asset_id}`, start_time: want.start, ...(want.end != null ? { end_time: want.end } : {}) }],
      playback_policy: ['public'],
      video_quality: 'basic',
    });
    db.prepare("UPDATE media SET clip_asset_id = ?, clip_playback_id = ?, clip_start = ?, clip_end = ?, clip_status = 'making', clip_ready_at = NULL WHERE id = ?")
      .run(data.id, data.playback_ids?.[0]?.id || null, want.start, want.end, m.id);
    audit(db, req, 'media.clip.start', { id: m.id, source: m.mux_asset_id, clip: data.id, start: want.start, end: want.end });
  }
  if (old) await removeAsset(db, { asset: old, mediaId: m.id, kind: 'clip', why: 'replaced by a new cut' }, req).catch(() => {});
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
  if (old) await removeAsset(db, { asset: old, mediaId: row.id, kind: 'full', why: 'replaced by an upload' }).catch(() => {});
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

// Is the clip really there and playable? Asked of Mux itself, right before the original goes.
async function clipPlayable(row) {
  try {
    const { data: c } = await mux('GET', `/video/v1/assets/${row.clip_asset_id}`);
    return c.status === 'ready' && Boolean(c.playback_ids?.length);
  } catch { return false; }
}

// Cut copies being made, full recordings that can go, and the podcast's audio files.
async function clipsAndCleanup(db) {
  await podcastAudio(db, mux).catch((e) => console.error('Podcast audio:', e.message));
  // Trimmed copies being made.
  for (const row of db.prepare("SELECT id, clip_asset_id FROM media WHERE clip_status = 'making'").all()) {
    try {
      const { data: c } = await mux('GET', `/video/v1/assets/${row.clip_asset_id}`);
      if (c.status === 'ready' && c.playback_ids?.length) {
        db.prepare("UPDATE media SET clip_status = 'ready', clip_playback_id = ?, clip_ready_at = datetime('now') WHERE id = ? AND clip_asset_id = ?").run(c.playback_ids[0].id, row.id, row.clip_asset_id);
        audit(db, {}, 'media.clip.ready', { id: row.id, clip: row.clip_asset_id });
      }
      if (c.status === 'errored') {
        // The full recording stays: nothing is deleted for a clip that didn't work.
        db.prepare("UPDATE media SET clip_status = 'failed' WHERE id = ? AND clip_asset_id = ?").run(row.id, row.clip_asset_id);
        audit(db, {}, 'media.clip.failed', { id: row.id, clip: row.clip_asset_id });
      }
    } catch (e) {
      if (e.status === 404) db.prepare("UPDATE media SET clip_status = 'failed' WHERE id = ?").run(row.id);
    }
  }

  // Once the cut copy is ready and playable (the item already plays it), the full recording goes
  // to save storage. Never before: a clip that is still being made or failed leaves it alone.
  // The cut has to be of the marks as they are now.
  const done = db.prepare(`SELECT id, mux_asset_id, clip_asset_id FROM media WHERE source = 'mux' AND clip_status = 'ready' AND clip_playback_id IS NOT NULL AND clip_asset_id IS NOT NULL
    AND raw_deleted = 0 AND clip_start = start_sec AND clip_end IS end_sec AND mux_asset_id != clip_asset_id`).all();
  for (const row of done) {
    if (!(await clipPlayable(row))) continue;
    try {
      await removeAsset(db, { asset: row.mux_asset_id, mediaId: row.id, kind: 'full', why: 'the cut copy is ready' });
    } catch { continue; }
    db.prepare('UPDATE media SET raw_deleted = 1 WHERE id = ?').run(row.id);
  }
}

// ---------------------------------------------------------------- keep services in Mux for N months
// Once a day. Mux storage costs money and YouTube keeps the copy free, so (when the church turns it on in
// Media → Setup) a service older than 6, 12 or 24 months moves to its YouTube copy and its Mux
// assets are deleted. THE DELETE IS PERMANENT; the YouTube copy is what remains. A service moves
// only when it is linked to a YouTube video that the YouTube API confirms is still there; if
// YouTube can't be asked (no key, error, quota) nothing at all is deleted that run. Safe to run
// twice: a moved item is no longer a Mux item, and a Mux deletion that failed is retried from
// `pending`. `now` is injectable for tests.
const archiveState = (db) => getSetting(db, 'media_archive', {});
const saveArchive = (db, changes) => setSetting(db, 'media_archive', { ...archiveState(db), ...changes });
export const archiveStatus = (db) => { const { last_run, moved, kept = [], error = '', pending = [] } = archiveState(db); return { last_run: last_run || null, moved: moved || 0, kept, error, pending: pending.length }; };

let archiving = null;
export function archiveOldMux(db, opts = {}) {
  archiving ||= runArchive(db, opts).finally(() => { archiving = null; });
  return archiving;
}

const WEEK = 7 * 86400e3;
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

async function runArchive(db, { now = Date.now() } = {}) {
  const months = mediaSettings(db).keep_mux_months;
  if (!KEEP_MUX_CHOICES.includes(months)) return { ran: false, why: 'off' };
  if (!muxConfigured()) return { ran: false, why: 'mux' };
  const today = new Date(`${localNow(churchTz(db), new Date(now)).date}T12:00:00Z`);
  today.setUTCMonth(today.getUTCMonth() - months);
  const cutoff = today.toISOString().slice(0, 10); // older than this day
  const out = { ran: true, moved: 0, kept: [], failed: 0, error: '' };
  const st = archiveState(db);

  // Finish what an earlier run started: items already on YouTube whose Mux assets are still there.
  let pending = st.pending || [];
  const still = [];
  for (const a of pending) {
    try { await removeAsset(db, { asset: a.asset, mediaId: a.media_id, kind: a.kind, why: `kept ${months} months, retried` }); } catch { still.push(a); }
  }
  pending = still;

  const rows = db.prepare(`SELECT * FROM media WHERE source = 'mux' AND mux_asset_id IS NOT NULL AND day < ? AND upload_status = '' AND clip_status != 'making'
    ORDER BY day LIMIT 200`).all(cutoff);
  const keep = (m, reason) => { if (m.status !== 'skipped') out.kept.push({ id: m.id, title: m.title, day: m.day, reason }); };
  const withCopy = [];
  for (const m of rows) { if (youtubeIdOf(m)) withCopy.push(m); else keep(m, 'No YouTube copy is linked'); }

  let found = new Map();
  if (withCopy.length) {
    try { found = await youtubeCopies(withCopy.map(youtubeIdOf)); } catch (e) {
      // Can't confirm anything: delete nothing this run, and say so.
      out.error = e.message;
      saveArchive(db, { last_run: utc(now), moved: 0, kept: out.kept, error: e.message, pending });
      return out;
    }
  }
  for (const m of withCopy) {
    const yid = youtubeIdOf(m);
    const copy = found.get(yid);
    if (!copy) { keep(m, 'The YouTube copy is gone or not playable'); continue; }
    if (copy.duration != null && m.end_sec != null && copy.duration < m.end_sec) { keep(m, 'The YouTube copy is shorter than the message'); continue; }
    if (db.prepare('SELECT 1 FROM media WHERE video_id = ? AND id != ?').get(yid, m.id)) { keep(m, 'The YouTube video is already listed on its own'); continue; }
    // Hand the item to YouTube first, and remember the assets to delete in the same step: a
    // crash between the two leaves an item that plays YouTube and assets to clear, never an
    // item pointing at assets that are gone.
    const assets = [...new Set([m.raw_deleted ? null : m.mux_asset_id, m.clip_asset_id].filter(Boolean))].map((asset) => ({ asset, media_id: m.id, kind: asset === m.clip_asset_id ? 'clip' : 'full' }));
    tx(db, () => {
      db.prepare(`UPDATE media SET source = 'youtube', video_id = ?, yt_video_id = NULL, yt_snapshot = NULL, linked_by = '', mux_asset_id = NULL, playback_id = NULL, thumbnail = ?,
        clip_asset_id = NULL, clip_playback_id = NULL, clip_start = NULL, clip_end = NULL, clip_status = '', clip_ready_at = NULL, raw_deleted = 0,
        audio_asset_id = NULL, audio_playback_id = NULL, audio_status = '', audio_size = NULL WHERE id = ?`).run(yid, ytThumb(yid), m.id);
      pending = [...pending, ...assets];
      saveArchive(db, { pending });
      audit(db, {}, 'media.mux_archive', { id: m.id, title: m.title, day: m.day, youtube: yid, assets: assets.map((a) => a.asset), months });
    });
    out.moved++;
    const left = [];
    for (const a of pending.filter((x) => x.media_id === m.id)) {
      try { await removeAsset(db, { asset: a.asset, mediaId: m.id, kind: a.kind, why: `kept ${months} months` }); } catch { left.push(a); out.failed++; }
    }
    pending = [...pending.filter((x) => x.media_id !== m.id), ...left];
    saveArchive(db, { pending });
  }

  // A short note for admins about once a week (not every day), and always when something needs them.
  const since = (st.since_moved || 0) + out.moved;
  const due = !st.notice_at || now - st.notice_at >= WEEK;
  const worth = since || out.kept.length || pending.length;
  let notice_at = st.notice_at || null;
  let since_moved = since;
  if (due && worth) {
    const admins = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin' AND campus_ids IS NULL").all().map((u) => u.id);
    const n = out.kept.length;
    const bits = [
      since ? `${since} ${since === 1 ? 'service' : 'services'} moved to YouTube and cleared from Mux.` : '',
      n ? `${n} ${n === 1 ? 'service' : 'services'} couldn’t move to YouTube: ${out.kept.slice(0, 3).map((k) => k.title).join(', ')}${n > 3 ? ` and ${n - 3} more` : ''}. They’re still in Mux.` : '',
      pending.length ? `${pending.length} Mux ${pending.length === 1 ? 'file' : 'files'} will be tried again tomorrow.` : '',
    ].filter(Boolean);
    notify(db, admins, { kind: 'media', title: 'Mux storage summary', body: bits.join(' '), url: '/#/media/setup' });
    notice_at = now;
    since_moved = 0;
  }
  saveArchive(db, { last_run: utc(now), moved: out.moved, kept: out.kept, error: '', pending, notice_at, since_moved });
  return out;
}
