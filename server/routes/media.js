// Media: the library of past services the app's Watch tab shows. Videos come in on their own
// from the church's YouTube channel (see ../media.js); staff give each one the app's own title,
// trim, speaker, series, scripture and topics. Watch is public, like the rest of the app.
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { setSetting } from '../db.js';
import { bad, notFound, int, str, audit } from '../http.js';
import { isAppImage } from '../../public/js/app-widgets.js';
import {
  mediaSettings, mediaStatus, liveNow, muxStreaming, syncMedia, resolveChannel, fetchVideo, describeVideo, insertMedia, fromService, hasApiKey, TITLE_FORMATS,
} from '../media.js';
import { muxTick, muxConfigured, muxSettings, ensureLiveStream, resetStreamKey, setYouTubeForward, showLive, makeClip, thumb, RTMP_SERVER } from '../mux.js';

const topicsOf = (m) => { try { return JSON.parse(m.topics || '[]'); } catch { return []; } };

// What the app gets for one video: our title, picture and trim (never YouTube's title).
// Mux: the trimmed copy once it's ready (it plays whole); until then the full recording between
// the trim points.
function playback(m) {
  if (m.source !== 'mux') return { source: 'youtube', start: m.start_sec, end: m.end_sec };
  const clip = m.clip_status === 'ready' && m.clip_playback_id && m.clip_start === m.start_sec && (m.clip_end ?? null) === (m.end_sec ?? null);
  if (clip || m.raw_deleted) return { source: 'mux', playback_id: m.clip_playback_id || m.playback_id, start: 0, end: null };
  return { source: 'mux', playback_id: m.playback_id, start: m.start_sec, end: m.end_sec };
}

const publicItem = (m) => ({
  id: m.id,
  video_id: m.source === 'mux' ? null : m.video_id,
  ...playback(m),
  title: m.title,
  description: m.description,
  picture: m.image || (m.source === 'mux' && m.playback_id && !m.raw_deleted ? thumb(m.playback_id, (m.start_sec || 0) + 90) : m.thumbnail),
  length: m.duration != null || m.end_sec != null ? Math.max(0, (m.end_sec ?? m.duration) - m.start_sec) : null,
  day: m.day,
  speaker: m.speaker,
  series: m.series,
  scripture: m.scripture,
  topics: topicsOf(m),
  campus: m.campus_short || m.campus_name || '',
});

const LIST = `SELECT m.*, c.short_name campus_short, c.name campus_name FROM media m LEFT JOIN campuses c ON c.id = m.campus_id`;

// "1:02:03", "62:03" or "3723" → seconds.
function seconds(v, field) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const parts = String(v).trim().split(':').map((x) => x.trim());
  if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) throw bad(`${field}: use minutes and seconds, like 12:30 or 1:05:00.`);
  return Math.round(parts.reduce((t, x) => t * 60 + Number(x), 0));
}

export default function mediaRoutes(db) {
  const r = Router();

  // ---------------------------------------------------------------- the app (public)
  r.get('/watch', (_req, res) => {
    const items = db.prepare(`${LIST} WHERE m.status = 'published' ORDER BY m.day DESC, m.recorded_at DESC LIMIT 600`).all().map(publicItem);
    const live = liveNow(db);
    res.json({ live: live && live.public !== false ? { source: live.source || 'youtube', video_id: live.video_id || null, playback_id: live.playback_id || null, title: live.title } : null, items });
  });

  r.get('/watch/:id', (req, res) => {
    const m = db.prepare(`${LIST} WHERE m.id = ? AND m.status = 'published'`).get(int(req.params.id));
    if (!m) throw notFound('That video');
    const more = m.series
      ? db.prepare(`${LIST} WHERE m.status = 'published' AND m.series = ? AND m.id != ? ORDER BY m.day DESC LIMIT 12`).all(m.series, m.id).map(publicItem)
      : [];
    res.json({ ...publicItem(m), more });
  });

  // ---------------------------------------------------------------- the hub (staff)
  r.get('/media', requireRole('staff'), (req, res) => {
    const status = ['published', 'hidden', 'skipped'].includes(req.query.status) ? req.query.status : 'published';
    const items = db.prepare(`${LIST} WHERE m.status = ? ORDER BY m.day DESC, m.recorded_at DESC LIMIT 1000`).all(status)
      .map((m) => ({ ...publicItem(m), status: m.status, skip_reason: m.skip_reason, yt_title: m.yt_title, duration: m.duration, was_live: Boolean(m.was_live), edited: Boolean(m.edited_at), clip_status: m.clip_status }));
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM media GROUP BY status').all().map((x) => [x.status, x.n]));
    const all = db.prepare("SELECT speaker, series, topics FROM media WHERE status != 'skipped'").all();
    const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({
      items, counts,
      speakers: uniq(all.map((m) => m.speaker)),
      series: uniq(all.map((m) => m.series)),
      topics: uniq(all.flatMap(topicsOf)),
      settings: mediaSettings(db),
      status: mediaStatus(db),
    });
  });

  const muxInfo = () => {
    const m = muxSettings(db);
    return { configured: muxConfigured(), live_stream_id: m.live_stream_id || null, server: RTMP_SERVER, stream_key: m.stream_key || '', youtube_forward: Boolean(m.simulcast_id) };
  };
  r.get('/media/setup', requireRole('staff'), (_req, res) => {
    res.json({ settings: mediaSettings(db), status: mediaStatus(db), formats: TITLE_FORMATS, api_key: hasApiKey(), mux: muxInfo() });
  });

  // Mux: make the stream key (once), reset it, and optionally forward the stream to YouTube.
  const muxCall = async (res, fn) => {
    try { await fn(); } catch (e) { throw bad(e.message); }
    res.json(muxInfo());
  };
  r.post('/media/mux/stream', requireRole('staff'), (req, res) => muxCall(res, async () => { await ensureLiveStream(db); audit(db, req, 'media.mux.stream'); }));
  r.post('/media/mux/reset-key', requireRole('admin'), (req, res) => muxCall(res, async () => { await resetStreamKey(db); audit(db, req, 'media.mux.reset_key'); }));
  r.put('/media/mux/youtube', requireRole('staff'), (req, res) => muxCall(res, async () => {
    const key = str(req.body?.key, 200);
    const url = str(req.body?.url, 300);
    if (url && !/^rtmps?:\/\//.test(url)) throw new Error('The server address starts with rtmp:// or rtmps://');
    await setYouTubeForward(db, { url, key });
    audit(db, req, 'media.mux.youtube', { on: Boolean(key) });
  }));
  // A stream outside service times (a rehearsal) waits here until someone shows it.
  r.post('/media/live/show', requireRole('staff'), (req, res) => {
    const live = showLive(db);
    if (!live) throw bad('Nothing is live right now.');
    audit(db, req, 'media.live.show');
    res.json({ live });
  });

  r.put('/media/setup', requireRole('staff'), async (req, res) => {
    const b = req.body || {};
    const cfg = mediaSettings(db);
    const input = str(b.channel, 300);
    if (input !== cfg.channel_input || (input && !cfg.channel_id)) {
      if (input) {
        let ch;
        try { ch = await resolveChannel(input); } catch (e) { throw bad(e.message); }
        Object.assign(cfg, { channel_id: ch.id, channel_title: ch.title, channel_input: input });
      } else Object.assign(cfg, { channel_id: '', channel_title: '', channel_input: '' });
    }
    if (TITLE_FORMATS[b.title_format]) cfg.title_format = b.title_format;
    if (b.min_minutes !== undefined) cfg.min_minutes = Math.min(180, Math.max(1, Math.round(Number(b.min_minutes) || 20)));
    if (typeof b.notify_new === 'boolean') cfg.notify_new = b.notify_new;
    if (typeof b.notify_live === 'boolean') cfg.notify_live = b.notify_live;
    if (b.keep_full_days !== undefined) cfg.keep_full_days = Math.min(3650, Math.max(0, Math.round(Number(b.keep_full_days) || 0)));
    setSetting(db, 'media', cfg);
    audit(db, req, 'media.setup', { channel: cfg.channel_id });
    res.json({ settings: cfg, status: mediaStatus(db) });
  });

  // Look now. deep: go back through the whole channel (with the API key).
  r.post('/media/sync', requireRole('staff'), async (req, res) => {
    const streaming = muxStreaming(db);
    if (!mediaSettings(db).channel_id && !streaming) throw bad('Add your YouTube channel or set up streaming first.');
    if (req.body?.deep && !hasApiKey()) throw bad('Bringing in older videos needs a YouTube API key (see the steps under Setup).');
    const before = db.prepare("SELECT COUNT(*) n FROM media WHERE status = 'published'").get().n;
    if (streaming && !req.body?.deep) {
      try { await muxTick(db); } catch (e) { throw bad(`Couldn’t reach Mux: ${e.message}`); }
    }
    let r = { added: 0, skipped: 0 };
    try {
      r = await syncMedia(db, { deep: Boolean(req.body?.deep) });
    } catch (e) { throw bad(`Couldn’t reach YouTube: ${e.message}`); }
    res.json({ ...r, added: Math.max(r.added, db.prepare("SELECT COUNT(*) n FROM media WHERE status = 'published'").get().n - before) });
  });

  // Add one video by its address (a special, or something the sync skipped).
  r.post('/media', requireRole('staff'), async (req, res) => {
    let v;
    try { v = await fetchVideo(req.body?.url); } catch (e) { throw bad(e.message); }
    const existing = db.prepare('SELECT id, status FROM media WHERE video_id = ?').get(v.video_id);
    if (existing) {
      if (existing.status !== 'published') db.prepare("UPDATE media SET status = 'published', skip_reason = '' WHERE id = ?").run(existing.id);
      return res.json({ id: existing.id, existed: true });
    }
    if (v.state !== 'none') throw bad('That video is live or hasn’t started yet. It comes in on its own once it’s over.');
    const id = insertMedia(db, describeVideo(db, mediaSettings(db), v));
    audit(db, req, 'media.add', { id, video: v.video_id });
    res.status(201).json({ id });
  });

  r.get('/media/:id', requireRole('staff'), (req, res) => {
    const m = db.prepare(`${LIST} WHERE m.id = ?`).get(int(req.params.id));
    if (!m) throw notFound('That video');
    const service = m.service_id ? db.prepare('SELECT s.id, s.title, s.series, s.starts_at, c.short_name campus FROM services s JOIN campuses c ON c.id = s.campus_id WHERE s.id = ?').get(m.service_id) : null;
    // Services that day, to link it to another one.
    const services = db.prepare('SELECT s.id, s.title, s.starts_at, c.short_name campus FROM services s JOIN campuses c ON c.id = s.campus_id WHERE substr(s.starts_at, 1, 10) = ? ORDER BY s.starts_at').all(m.day);
    res.json({ ...publicItem(m), status: m.status, skip_reason: m.skip_reason, yt_title: m.yt_title, duration: m.duration, image: m.image, thumbnail: m.thumbnail,
      raw_playback_id: m.raw_deleted ? null : m.playback_id, raw_deleted: Boolean(m.raw_deleted), clip_status: m.clip_status, mux_thumb: m.source === 'mux' && m.playback_id && !m.raw_deleted ? thumb(m.playback_id, (m.start_sec || 0) + 90) : null,
      campus_id: m.campus_id, service_id: m.service_id, service, services, recorded_at: m.recorded_at, was_live: Boolean(m.was_live) });
  });

  // What the order of service says for a service (to fill in the details again).
  r.get('/media/from-service/:id', requireRole('staff'), (req, res) => {
    const s = fromService(db, int(req.params.id));
    if (!s) throw notFound('That service');
    res.json(s);
  });

  r.patch('/media/:id', requireRole('staff'), async (req, res) => {
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(int(req.params.id));
    if (!m) throw notFound('That video');
    const b = req.body || {};
    const set = {};
    if (b.title !== undefined) { set.title = str(b.title, 200); if (!set.title) throw bad('Give it a title.'); }
    for (const [k, max] of [['description', 4000], ['speaker', 120], ['series', 120], ['scripture', 200]]) if (b[k] !== undefined) set[k] = str(b[k], max);
    if (b.topics !== undefined) {
      const list = (Array.isArray(b.topics) ? b.topics : String(b.topics).split(',')).map((t) => str(t, 40)).filter(Boolean);
      set.topics = JSON.stringify([...new Set(list)].slice(0, 12));
    }
    if (b.day !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw bad('Pick a date.'); set.day = b.day; }
    if (b.campus_id !== undefined) set.campus_id = b.campus_id ? int(b.campus_id) : null;
    if (b.service_id !== undefined) {
      set.service_id = b.service_id ? int(b.service_id) : null;
      if (set.service_id && !db.prepare('SELECT 1 FROM services WHERE id = ?').get(set.service_id)) throw notFound('That service');
    }
    if (b.image !== undefined) {
      if (b.image && !isAppImage(b.image)) throw bad('Upload the picture here.');
      set.image = b.image || '';
    }
    const start = b.start !== undefined ? seconds(b.start, 'Start') ?? 0 : m.start_sec;
    const end = b.end !== undefined ? seconds(b.end, 'End') : m.end_sec;
    if (end != null && end <= start) throw bad('The end has to come after the start.');
    if (m.duration && start >= m.duration) throw bad('The start is past the end of the video.');
    const trimChanged = (b.start !== undefined && start !== m.start_sec) || (b.end !== undefined && (end ?? null) !== (m.end_sec ?? null));
    if (trimChanged && m.raw_deleted) throw bad('The full recording has been removed to save storage, so this one can’t be trimmed again.');
    if (b.start !== undefined) set.start_sec = start;
    if (b.end !== undefined) set.end_sec = end != null && m.duration && end >= m.duration ? null : end;
    if (b.status !== undefined) {
      if (!['published', 'hidden'].includes(b.status)) throw bad('Publish or hide it.');
      set.status = b.status;
      set.skip_reason = '';
    }
    const keys = Object.keys(set);
    if (keys.length) {
      db.prepare(`UPDATE media SET ${keys.map((k) => `${k} = ?`).join(', ')}, edited_by = ?, edited_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => set[k]), req.user.id, m.id);
      audit(db, req, 'media.edit', { id: m.id, fields: keys });
    }
    // Streamed through Mux: a new trim makes a new trimmed copy.
    if (trimChanged && m.source === 'mux') {
      try { await makeClip(db, m.id); } catch (e) { return res.json({ ok: true, clip_error: e.message }); }
    }
    res.json({ ok: true });
  });

  return r;
}
