// The media library's link to YouTube: finds the church's channel, picks up new videos every hour,
// fills in date, campus, speaker, series and title from the matching service, and notices when
// the church is live.
//
// Every video comes into the library on its own. Each one lands in one of three places: In the app
// (published), Not in the app (skipped: a Short, too short, or a skipped title word; or hidden by
// staff) or Needs a look (status 'review': its length couldn't be read, or it may be a copy of a
// video already in the app). Staff can move any of them.
//
// With a playlist set (Media → Setup → "Only bring in videos from this playlist") only that
// playlist is read. Otherwise it's the channel's uploads.
//
// With YOUTUBE_API_KEY (a free key from Google Cloud) the hub sees every video, with its exact
// length and whether it's live. Without one it reads the public feed (the latest 15 videos) and
// each new video's page.
import { getSetting, setSetting, tx } from './db.js';
import { localNow, audit } from './http.js';
import { notify, pushGuests } from './notify.js';

const API = () => (process.env.MB_YOUTUBE_API || 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
const SITE = () => (process.env.MB_YOUTUBE_SITE || 'https://www.youtube.com').replace(/\/+$/, '');
const apiKey = () => (process.env.YOUTUBE_API_KEY || '').trim();
export const hasApiKey = () => Boolean(apiKey());

export const TITLE_FORMATS = {
  plain: 'Use the whole YouTube title',
  series_title: 'Series | Title',
  title_speaker: 'Title | Speaker',
  title_series: 'Title | Series',
};

// keep_mux_months: how long services stay in Mux before moving to YouTube only (0 = off, else 6, 12 or 24).
export const KEEP_MUX_CHOICES = [6, 12, 24];
export const DEFAULTS = { channel_id: '', channel_title: '', channel_input: '', playlist_id: '', playlist_input: '', playlist_title: '', skip_words: '', title_format: 'plain', min_minutes: 20, notify_new: false, notify_live: true, keep_mux_months: 0 };
export const mediaSettings = (db) => ({ ...DEFAULTS, ...getSetting(db, 'media', {}) });
const status = (db) => getSetting(db, 'media_status', {});
const setStatus = (db, changes) => setSetting(db, 'media_status', { ...status(db), ...changes });
export const liveNow = (db) => getSetting(db, 'media_live', null);
// Mux is set up and has a stream key: it's where live and recordings come from.
export const muxStreaming = (db) => Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET && getSetting(db, 'mux', {}).live_stream_id);

export const utc = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
export const churchTz = (db) => db.prepare('SELECT timezone FROM campuses ORDER BY sort, id LIMIT 1').get()?.timezone || 'UTC';

// ---------------------------------------------------------------- talking to YouTube
async function getText(url, { json = false } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20e3),
    // Without these, YouTube can answer with a cookie-consent page instead of the video page.
    headers: { 'accept-language': 'en-US,en;q=0.8', cookie: 'CONSENT=YES+1; SOCS=CAI', 'user-agent': 'Mozilla/5.0 (compatible; ChurchHub/1.0)' },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* not JSON */ }
    const e = new Error(res.status === 403 && /key|quota|API/i.test(detail) ? `YouTube refused the API key: ${detail}` : res.status === 404 ? 'YouTube couldn’t find that channel or video.' : `YouTube answered ${res.status}${detail ? `: ${detail}` : ''}.`);
    e.status = res.status;
    throw e;
  }
  return json ? res.json() : res.text();
}
const api = (path, params) => getText(`${API()}/${path}?${new URLSearchParams({ ...params, key: apiKey() })}`, { json: true });

const decode = (s = '') => s.replace(/&(amp|lt|gt|quot|apos|#39|#x27|#(\d+)|#x([\da-f]+));/gi, (m, name, dec, hex) => {
  if (dec) return String.fromCodePoint(Number(dec));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" }[name.toLowerCase()] || m;
});

// "PT1H2M3S" → 3723
export function isoSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
  return m ? (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0) : null;
}

// What someone types for the channel: a link, @handle or channel id → { id, title }.
export async function resolveChannel(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Enter your YouTube channel’s address or @handle.');
  let id = (/(UC[\w-]{22})/.exec(s) || [])[1];
  const handle = (/(?:^|\/)(@[\w.-]+)/.exec(s) || [])[1] || (/^[\w.-]+$/.test(s) && !id ? `@${s}` : null);
  if (!id && !handle) throw new Error('That doesn’t look like a YouTube channel. Paste its address, like youtube.com/@yourchurch.');
  if (hasApiKey()) {
    const r = await api('channels', { part: 'snippet', ...(id ? { id } : { forHandle: handle }) });
    const c = r.items?.[0];
    if (!c) throw new Error('YouTube couldn’t find that channel.');
    return { id: c.id, title: c.snippet?.title || '' };
  }
  if (!id) {
    const page = await getText(`${SITE()}/${handle}`);
    id = (/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]{22})"/.exec(page) || /"(?:channelId|externalId)":"(UC[\w-]{22})"/.exec(page) || [])[1];
    if (!id) throw new Error('Couldn’t read that channel’s page. Paste the address with /channel/UC… in it instead (YouTube → your channel → Share → Copy channel ID).');
  }
  const feed = await readFeed(id);
  return { id, title: feed.title };
}

// What someone pastes for the playlist: a link with list=… in it, or the id itself (PL…).
export function parsePlaylistId(input) {
  const s = String(input || '').trim();
  const id = (/[?&]list=([\w-]+)/.exec(s) || /^([\w-]{12,})$/.exec(s) || [])[1];
  if (!id || !/^(PL|OL|FL|UU)[\w-]{10,}$/.test(id)) throw new Error('That doesn’t look like a YouTube playlist. Open the playlist on YouTube and paste its address (it has list=PL… in it).');
  return id;
}

// Checks a playlist can be read (public or unlisted) and finds its name: { id, title }.
export async function resolvePlaylist(input) {
  const id = parsePlaylistId(input);
  try {
    if (hasApiKey()) {
      const r = await api('playlists', { part: 'snippet', id });
      if (!r.items?.[0]) throw new Error('missing');
      return { id, title: r.items[0].snippet?.title || '' };
    }
    return { id, title: (await readFeed({ playlist: id })).title };
  } catch (e) {
    if (e.status === 403 && /key|quota|API/i.test(e.message)) throw e;
    throw new Error('YouTube couldn’t find that playlist. Check that it’s public or unlisted, not private.');
  }
}

// The public feed (its latest 15 videos) of the channel (an id), or of a playlist ({ playlist }).
async function readFeed(source) {
  const channelId = typeof source === 'string' ? source : null;
  const xml = await getText(`${SITE()}/feeds/videos.xml?${channelId ? `channel_id=${channelId}` : `playlist_id=${source.playlist}`}`);
  const tag = (s, name) => decode((new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(s) || [])[1]?.trim() || '');
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    video_id: tag(e, 'yt:videoId'),
    title: tag(e, 'title'),
    description: tag(e, 'media:description'),
    thumbnail: decode((/<media:thumbnail url="([^"]+)"/.exec(e) || [])[1] || ''),
    published: tag(e, 'published'),
    short: /href="[^"]*\/shorts\//.test(e),
  })).filter((v) => /^[\w-]{11}$/.test(v.video_id));
  return { title: tag(xml.split('<entry>')[0], 'title'), entries };
}

// A video's page, for its length and whether it's live (when there's no API key).
async function readWatchPage(videoId) {
  const page = await getText(`${SITE()}/watch?v=${videoId}`);
  const num = (re) => { const m = re.exec(page); return m ? Number(m[1]) : null; };
  const flag = (name) => new RegExp(`"${name}":true`).test(page);
  const start = (/"startTimestamp":"([^"]+)"/.exec(page) || [])[1];
  return {
    duration: num(/"lengthSeconds":"(\d+)"/),
    state: flag('isUpcoming') ? 'upcoming' : flag('isLiveNow') || (flag('isLive') && !/"endTimestamp"/.test(page)) ? 'live' : 'none',
    was_live: flag('isLiveContent'),
    started: start || null,
  };
}

const bestThumb = (t = {}) => (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || '';

// Full details for videos by id, with the API: [{ video_id, title, description, thumbnail, published, started, duration, state, was_live, short }]
async function videoDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await api('videos', { part: 'snippet,contentDetails,liveStreamingDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    for (const v of r.items || []) {
      const live = v.liveStreamingDetails || {};
      const duration = isoSeconds(v.contentDetails?.duration);
      out.push({
        video_id: v.id,
        title: v.snippet?.title || '',
        description: v.snippet?.description || '',
        thumbnail: bestThumb(v.snippet?.thumbnails),
        published: v.snippet?.publishedAt,
        started: live.actualStartTime || null,
        duration,
        state: v.snippet?.liveBroadcastContent === 'live' ? 'live' : v.snippet?.liveBroadcastContent === 'upcoming' ? 'upcoming' : 'none',
        was_live: Boolean(v.liveStreamingDetails),
        short: false,
      });
    }
  }
  return out;
}

// A playlist's video ids, a page (50) at a time. The channel's uploads are the playlist UU… + its id.
async function playlistVideoIds(playlistId, pages) {
  const ids = [];
  let pageToken = '';
  for (let n = 0; n < pages; n++) {
    const r = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(r.items || []).map((x) => x.contentDetails?.videoId).filter(Boolean));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  ids.more = Boolean(pageToken); // stopped at the page limit with more still to read
  return ids;
}

// Newest first, as much as we can see: [{ video_id, title, …, state, duration (may be null) }]
// With a playlist set, only its videos (each marked in_playlist: it's where the church puts its messages).
async function latestVideos(db, cfg, { deep = false, knownIds = new Set() } = {}) {
  const inPlaylist = Boolean(cfg.playlist_id);
  if (hasApiKey()) {
    const ids = await playlistVideoIds(inPlaylist ? cfg.playlist_id : `UU${cfg.channel_id.slice(2)}`, deep ? 40 : 1);
    const want = ids.filter((id) => !knownIds.has(id));
    return (await videoDetails(want)).map((v) => ({ ...v, in_playlist: inPlaylist }));
  }
  const feed = await readFeed(inPlaylist ? { playlist: cfg.playlist_id } : cfg.channel_id);
  const out = [];
  for (const e of feed.entries.filter((x) => !knownIds.has(x.video_id))) {
    if (e.short) { out.push({ ...e, duration: null, state: 'none', was_live: false, started: null, in_playlist: inPlaylist }); continue; }
    let page = { duration: null, state: 'none', was_live: false, started: null, unread: true };
    try { page = await readWatchPage(e.video_id); } catch { /* the page couldn't be read: it goes to Needs a look */ }
    out.push({ ...e, ...page, in_playlist: inPlaylist });
  }
  return out;
}

// Every video in the messages playlist: { ids: Set, complete }. Through the Data API that is the
// whole playlist; the public feed shows only 15, so a full feed may be missing some (complete: false).
export async function playlistMembers(cfg) {
  if (hasApiKey()) {
    const ids = await playlistVideoIds(cfg.playlist_id, 40);
    return { ids: new Set(ids), complete: !ids.more };
  }
  const { entries } = await readFeed({ playlist: cfg.playlist_id });
  return { ids: new Set(entries.map((e) => e.video_id)), complete: entries.length < 15 };
}

// One video by its address, for "Add a video".
export async function fetchVideo(urlOrId) {
  const s = String(urlOrId || '').trim();
  const id = (/(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})/.exec(s) || /^([\w-]{11})$/.exec(s) || [])[1];
  if (!id) throw new Error('Paste a YouTube video’s address.');
  if (hasApiKey()) {
    const [v] = await videoDetails([id]);
    if (!v) throw new Error('YouTube couldn’t find that video. Is it public or unlisted?');
    return v;
  }
  const page = await readWatchPage(id);
  const html = await getText(`${SITE()}/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { json: true }).catch(() => ({}));
  return { video_id: id, title: html.title || 'Video', description: '', thumbnail: html.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, published: page.started || new Date().toISOString(), short: false, ...page };
}

// Which of these YouTube videos are still there and playable (public or unlisted, processed):
// Map of id -> { duration }. Anything that stops YouTube being asked (no key, quota, network,
// a reply that isn't a video list) throws, so callers never take "no answer" for "it's gone".
export async function youtubeCopies(ids) {
  if (!hasApiKey()) throw new Error('The YouTube API key isn’t set, so the hub can’t confirm the YouTube copies.');
  const found = new Map();
  const want = [...new Set(ids)];
  for (let i = 0; i < want.length; i += 50) {
    const r = await api('videos', { part: 'snippet,contentDetails,status', id: want.slice(i, i + 50).join(','), maxResults: 50 });
    if (!Array.isArray(r?.items)) throw new Error('YouTube’s answer wasn’t a list of videos.');
    for (const v of r.items) {
      const there = v.status?.uploadStatus === 'processed' && ['public', 'unlisted'].includes(v.status?.privacyStatus) && (v.snippet?.liveBroadcastContent || 'none') === 'none';
      if (there) found.set(v.id, { duration: isoSeconds(v.contentDetails?.duration) });
    }
  }
  return found;
}

// ---------------------------------------------------------------- filling in the details
const GENERIC = /^(the )?(message|sermon|preaching|the word|word|teaching|preacher)$/i;
const person = (r) => (r?.first_name ? `${r.nickname || r.first_name} ${r.last_name}`.trim() : '');

// The service a video was streamed from. It needs a service on the video's day, and then either a
// start time within 4 hours of it (a stream starts a little before the service, an upload comes
// later the same day) or the video being in the church's messages playlist. Anything less certain
// is left blank rather than guessed: a wrong speaker is worse than none.
export function matchService(db, whenUtc, { inPlaylist = false } = {}) {
  const local = localNow(churchTz(db), new Date(whenUtc));
  const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const rows = db.prepare('SELECT id, campus_id, title, series, starts_at FROM services WHERE substr(starts_at, 1, 10) = ?').all(local.date);
  if (!rows.length) return { day: local.date, service: null };
  const best = rows.map((s) => ({ s, gap: Math.abs(mins(s.starts_at.slice(11, 16)) - mins(local.time)) })).sort((a, b) => a.gap - b.gap)[0];
  return { day: local.date, service: best.gap <= 4 * 60 || inPlaylist ? best.s : null };
}

// What the service's order of service says: the message's title and who preached.
export function fromService(db, serviceId) {
  const s = db.prepare('SELECT id, campus_id, title, series, starts_at FROM services WHERE id = ?').get(serviceId);
  if (!s) return null;
  const item = db.prepare(`SELECT i.title, i.info, p.first_name, p.nickname, p.last_name FROM plan_items i LEFT JOIN people p ON p.id = i.person_id
    WHERE i.service_id = ? AND i.kind != 'header' AND (i.category = 'Message' OR lower(i.title) LIKE '%sermon%' OR lower(i.title) LIKE '%message%' OR lower(i.title) LIKE '%preach%')
    ORDER BY i.category = 'Message' DESC, i.sort LIMIT 1`).get(s.id);
  const itemTitle = item?.title && !GENERIC.test(item.title.trim()) ? item.title.trim().replace(/^(message|sermon)\s*[:\-–—]\s*/i, '') : '';
  return {
    service_id: s.id,
    campus_id: s.campus_id,
    day: s.starts_at.slice(0, 10),
    title: itemTitle || s.title || '',
    speaker: person(item) || (item?.info || '').trim(),
    series: s.series || '',
  };
}

// A series name as the library already spells it ("unshakable" → "Unshakable"), so a stray
// capital never makes a second series.
export function sameSeries(db, name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return db.prepare("SELECT series FROM media WHERE series != '' AND lower(series) = lower(?) GROUP BY series ORDER BY COUNT(*) DESC, series LIMIT 1").get(s)?.series || s;
}

// "Series | Title" style YouTube titles, split as the church set in Media → Setup.
export function splitTitle(title, format) {
  const parts = String(title || '').split(/\s+[|]\s+/).map((x) => x.trim()).filter(Boolean);
  if (format === 'plain' || parts.length < 2) return { title: title || '' };
  const [a, b] = parts;
  if (format === 'series_title') return { series: a, title: b };
  if (format === 'title_speaker') return { title: a, speaker: b };
  if (format === 'title_series') return { title: a, series: b };
  return { title };
}

// A new video's row: the schedule fills in what it can, then the YouTube title.
function describe(db, cfg, v) {
  const when = v.started || v.published || new Date().toISOString();
  const { day, service } = matchService(db, when, { inPlaylist: Boolean(v.in_playlist) });
  const svc = service ? fromService(db, service.id) : null;
  const parsed = splitTitle(v.title, cfg.title_format);
  return {
    video_id: v.video_id,
    title: (svc?.title || parsed.title || v.title || 'Service').slice(0, 200),
    yt_title: v.title || '',
    description: '',
    thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
    duration: v.duration,
    recorded_at: utc(when),
    day,
    service_id: svc?.service_id ?? null,
    campus_id: svc?.campus_id ?? null,
    speaker: svc?.speaker || parsed.speaker || '',
    series: sameSeries(db, svc?.series || parsed.series || ''),
    was_live: v.was_live ? 1 : 0,
  };
}

// The words in "Skip videos whose title contains…": comma list, any case.
export const skipWords = (cfg) => String(cfg.skip_words || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

// Where a new video goes: { status: 'published' | 'skipped' | 'review', skip: why }.
// Shorts, clips under the minimum and titles with a skip word stay out of the app (Not in the app,
// where staff can add one); a length that couldn't be read, or a likely copy of a video already in
// the app, waits in Needs a look. Nothing is published on a guess.
function placement(db, cfg, v, row) {
  if (v.short) return { status: 'skipped', skip: 'A YouTube Short' };
  const title = String(v.title || '').toLowerCase();
  const word = skipWords(cfg).find((w) => title.includes(w));
  if (word) return { status: 'skipped', skip: `Title has “${word}”` };
  if (v.duration == null) return { status: 'review', skip: 'Couldn’t check its length' };
  // With a messages playlist, the playlist is the choice: edited messages are often short, so the
  // length rule only applies when the whole channel is read.
  if (!cfg.playlist_id && v.duration < cfg.min_minutes * 60) return { status: 'skipped', skip: `Under ${cfg.min_minutes} minutes` };
  // Same day, nearly the same length as one already in the app: probably the same service twice.
  const twin = db.prepare("SELECT 1 FROM media WHERE status = 'published' AND day = ? AND duration IS NOT NULL AND abs(duration - ?) <= 180 LIMIT 1").get(row.day, v.duration);
  if (twin) return { status: 'review', skip: 'Possible duplicate' };
  return { status: 'published', skip: '' };
}

export function insertMedia(db, row, { status = 'published', skip = '' } = {}) {
  const info = db.prepare(`INSERT INTO media (source, video_id, mux_asset_id, playback_id, status, skip_reason, title, yt_title, description, thumbnail, duration, recorded_at, day, service_id, campus_id, speaker, series, was_live)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
    row.source || 'youtube', row.video_id, row.mux_asset_id ?? null, row.playback_id ?? null, status, skip, row.title, row.yt_title || '', row.description || '', row.thumbnail, row.duration ?? null, row.recorded_at, row.day,
    row.service_id, row.campus_id, row.speaker, row.series, row.was_live);
  return info.changes ? Number(info.lastInsertRowid) : null;
}

export { describe as describeVideo };

// ---------------------------------------------------------------- one item per service
// A service streamed to Mux and YouTube together has two recordings. They are one item: it keeps
// the Mux recording (which plays while it exists) and points at its YouTube copy (yt_video_id,
// which plays once the Mux recording is gone). The YouTube row it absorbed is kept as JSON so an
// admin can split them again.
export const LINK_WINDOW_MIN = 180;
const WINDOW_MS = LINK_WINDOW_MIN * 60e3;
// A YouTube id is 11 characters; "mux:…" and "upload:…" are ours. (A recording uploaded to Mux
// onto a YouTube video keeps that video's id as its own.)
export const youtubeIdOf = (m) => m.yt_video_id || (/^[\w-]{11}$/.test(m.video_id || '') ? m.video_id : null);
export const studioUrl = (id) => `https://studio.youtube.com/video/${id}/editor`;
const stamp = (utcText) => Date.parse(`${String(utcText).replace(' ', 'T')}Z`);
// The church's wall clock for an instant, as ms, to compare with a service's starts_at (also wall clock).
const wallMs = (db, ms) => { const l = localNow(churchTz(db), new Date(ms)); return Date.parse(`${l.date}T${l.time}:00Z`); };

// Could these be the same service? a: a Mux recording row, b: a YouTube row. Both stream start
// times within 3 hours of each other, and of the service's start when either knows its service.
function sameService(db, a, b) {
  if (!a.recorded_at || !b.recorded_at) return false;
  if (Math.abs(stamp(a.recorded_at) - stamp(b.recorded_at)) > WINDOW_MS) return false;
  if (a.service_id && b.service_id && a.service_id !== b.service_id) return false;
  if (a.campus_id && b.campus_id && a.campus_id !== b.campus_id) return false;
  const sid = a.service_id || b.service_id;
  const svc = sid ? db.prepare('SELECT starts_at FROM services WHERE id = ?').get(sid) : null;
  if (svc) {
    const start = Date.parse(`${svc.starts_at}:00Z`);
    if ([a, b].some((x) => Math.abs(wallMs(db, stamp(x.recorded_at)) - start) > WINDOW_MS)) return false;
  }
  return true;
}

// Streams only (a Mux recording of a live stream, a YouTube video that was live), never an older
// upload that happens to share a day. Clear matches only: a recording with one candidate that has
// no other candidate. Anything else is `ambiguous`: both stay, and an admin links by hand.
export function linkPlan(db) {
  const mux = db.prepare("SELECT * FROM media WHERE source = 'mux' AND mux_asset_id IS NOT NULL AND video_id LIKE 'mux:%' AND yt_video_id IS NULL AND linked_by != 'unlinked' AND was_live = 1").all();
  const yt = db.prepare("SELECT * FROM media WHERE source = 'youtube' AND was_live = 1").all();
  const pairs = [];
  let ambiguous = 0;
  for (const a of mux) {
    const cands = yt.filter((b) => sameService(db, a, b));
    if (!cands.length) continue;
    if (cands.length === 1 && mux.filter((x) => sameService(db, x, cands[0])).length === 1) pairs.push([a, cands[0]]);
    else ambiguous++;
  }
  return { pairs, ambiguous };
}

const STATUS_RANK = { hidden: 3, published: 2, review: 1, skipped: 0 };
const blank = (v) => v == null || v === '' || v === '[]';
const COLUMNS = (db) => db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);

// Make one item of a Mux recording row and a YouTube row. The Mux row stays (it plays); the
// YouTube row is folded into it. What staff typed wins; otherwise the Mux row's details, with
// blanks filled from the YouTube row. By hand or automatic, one audited step.
export function linkItems(db, muxId, ytRowId, { by = 'hand', req = {} } = {}) {
  return tx(db, () => {
    const a = db.prepare('SELECT * FROM media WHERE id = ?').get(muxId);
    const b = db.prepare('SELECT * FROM media WHERE id = ?').get(ytRowId);
    if (!a || !b || a.id === b.id) throw new Error('Pick two different videos.');
    if (a.source !== 'mux' || !a.mux_asset_id || youtubeIdOf(a)) throw new Error('One of them has to be a Mux recording that isn’t linked to a YouTube video yet.');
    if (b.source !== 'youtube') throw new Error('The other one has to be a video from YouTube.');
    const winner = !a.edited_at && b.edited_at ? b : a;
    const other = winner === a ? b : a;
    const set = {};
    for (const f of ['title', 'description', 'speaker', 'series', 'scripture', 'topics', 'image', 'campus_id', 'service_id']) set[f] = blank(winner[f]) ? other[f] : winner[f];
    if (!a.edited_at && !b.edited_at && !a.service_id && b.service_id) set.title = b.title; // the order of service names the message
    set.day = winner.day;
    if (!a.start_sec && a.end_sec == null) { set.start_sec = b.start_sec; set.end_sec = b.end_sec; } // marks made on either copy
    const top = (STATUS_RANK[a.status] ?? 0) >= (STATUS_RANK[b.status] ?? 0) ? a : b;
    set.status = top.status;
    set.skip_reason = top.status === 'published' ? '' : top.skip_reason;
    set.yt_video_id = b.video_id;
    set.yt_title = b.yt_title || a.yt_title;
    set.yt_snapshot = JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'id')));
    set.linked_by = by;
    const keys = Object.keys(set);
    db.prepare('DELETE FROM media WHERE id = ?').run(b.id);
    db.prepare(`UPDATE media SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), a.id);
    audit(db, req, 'media.link', { id: a.id, mux: a.mux_asset_id, youtube: b.video_id, by, absorbed: b.id });
    return { id: a.id, absorbed: b };
  });
}

// Undo a link: the item goes back to the Mux recording alone, and the YouTube video comes back as
// its own row (as it was) when it had one. The automatic matching leaves this recording alone after.
export function unlinkItem(db, id, { req = {} } = {}) {
  return tx(db, () => {
    const a = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
    if (!a?.yt_video_id) throw new Error('That item isn’t linked to a YouTube video.');
    const snap = a.yt_snapshot ? JSON.parse(a.yt_snapshot) : null;
    db.prepare("UPDATE media SET yt_video_id = NULL, yt_snapshot = NULL, linked_by = 'unlinked' WHERE id = ?").run(a.id);
    let restored = null;
    if (snap && !db.prepare('SELECT 1 FROM media WHERE video_id = ?').get(snap.video_id)) {
      const cols = COLUMNS(db);
      const keys = Object.keys(snap).filter((k) => k !== 'id' && cols.includes(k));
      restored = Number(db.prepare(`INSERT INTO media (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => snap[k])).lastInsertRowid);
    }
    audit(db, req, 'media.unlink', { id: a.id, youtube: a.yt_video_id, restored });
    return { id: a.id, restored };
  });
}

// Runs after every sync and every new recording: link what is clearly one service, leave the rest.
// Returns [{ id, absorbed }] for each link made.
export function autoLink(db) {
  const made = [];
  for (const [a, b] of linkPlan(db).pairs) {
    try { made.push(linkItems(db, a.id, b.id, { by: 'auto' })); } catch (e) { console.error('Linking failed:', e.message); }
  }
  return made;
}

// The messages playlist may not hold the Sunday stream itself, so a Mux recording with no YouTube
// row looks at the channel's latest uploads for the stream that went with it, by the same rules.
// Needs the API key and a playlist (without one, every upload is already a row to match). Sets
// yt_video_id with no row to absorb. `now` is injectable for tests.
export async function linkFromChannel(db, { now = Date.now() } = {}) {
  const cfg = mediaSettings(db);
  if (!hasApiKey() || !cfg.channel_id || !cfg.playlist_id) return 0;
  const since = utc(now - 21 * 86400e3);
  const open = db.prepare("SELECT * FROM media WHERE source = 'mux' AND mux_asset_id IS NOT NULL AND video_id LIKE 'mux:%' AND yt_video_id IS NULL AND linked_by != 'unlinked' AND was_live = 1 AND recorded_at >= ?").all(since);
  if (!open.length) return 0;
  const taken = new Set(db.prepare('SELECT video_id FROM media UNION SELECT yt_video_id FROM media WHERE yt_video_id IS NOT NULL').all().map((r) => r.video_id));
  const ids = (await playlistVideoIds(`UU${cfg.channel_id.slice(2)}`, 1)).filter((id) => !taken.has(id));
  const streams = (await videoDetails(ids)).filter((v) => v.state === 'none' && v.was_live && v.started)
    .map((v) => ({ video_id: v.video_id, title: v.title, recorded_at: utc(v.started), service_id: null, campus_id: null }));
  let linked = 0;
  for (const a of open) {
    const cands = streams.filter((c) => sameService(db, a, c));
    if (cands.length !== 1 || open.filter((x) => sameService(db, x, cands[0])).length !== 1) continue;
    db.prepare("UPDATE media SET yt_video_id = ?, yt_title = ?, linked_by = 'auto' WHERE id = ? AND yt_video_id IS NULL").run(cands[0].video_id, cands[0].title, a.id);
    audit(db, {}, 'media.link', { id: a.id, mux: a.mux_asset_id, youtube: cands[0].video_id, by: 'auto', from: 'channel' });
    linked++;
  }
  return linked;
}

// ---------------------------------------------------------------- notices
const everyone = (db) => db.prepare('SELECT id FROM users WHERE active = 1').all().map((u) => u.id);

export function announce(db, msg) {
  const church = getSetting(db, 'church_name', 'Church');
  const full = { kind: 'media', url: '/#/media', data: { from: church }, ...msg };
  notify(db, everyone(db), full);
  pushGuests(db, db.prepare('SELECT * FROM guest_push').all(), full);
}

// "We're live" goes out once per service: never again within 4 hours of the last one, however
// often the stream drops and comes back (or YouTube is briefly unsure whether it's live).
const LIVE_NOTICE_GAP = 4 * 3600e3;
export function announceLive(db, title) {
  if (!mediaSettings(db).notify_live) return false;
  const last = getSetting(db, 'media_live_notified', null);
  if (last && Date.now() - last.at < LIVE_NOTICE_GAP) return false;
  setSetting(db, 'media_live_notified', { at: Date.now(), title });
  announce(db, { title: `We’re live: ${title}`, body: 'Tap to watch now.', app_url: '/app/#/watch', tag: 'live' });
  return true;
}

// Live now (or not any more). Returns true when this changed.
function setLive(db, cfg, v) {
  const was = liveNow(db);
  if (v && was?.video_id === v.video_id) {
    if (was.misses) setSetting(db, 'media_live', { ...was, misses: 0 });
    return false;
  }
  if (!v && !was) return false;
  if (!v) { setSetting(db, 'media_live', null); return true; }
  const parsed = splitTitle(v.title, cfg.title_format);
  const title = (parsed.title || v.title || 'Live').slice(0, 200);
  setSetting(db, 'media_live', { source: 'youtube', video_id: v.video_id, title, since: utc(Date.now()) });
  announceLive(db, title);
  return true;
}

// ---------------------------------------------------------------- the sync
let running = null;

// Picks up new videos. deep: look back through the whole channel (needs the API key).
export function syncMedia(db, opts = {}) {
  running ||= doSync(db, opts).finally(() => { running = null; });
  return running;
}

async function doSync(db, { deep = false, now = Date.now() } = {}) {
  const cfg = mediaSettings(db);
  if (!cfg.channel_id) return { added: 0, skipped: 0, review: 0 };
  // Streaming through Mux too: recordings come from there and live comes from Mux. YouTube still
  // comes in (older videos, and the copy of each Sunday), but a copy of a service already here is
  // linked to it, never listed a second time.
  const mx = muxStreaming(db);
  const first = !db.prepare('SELECT 1 FROM media LIMIT 1').get();
  const knownIds = new Set(db.prepare('SELECT video_id FROM media UNION SELECT yt_video_id FROM media WHERE yt_video_id IS NOT NULL').all().map((r) => r.video_id));
  let videos;
  try {
    videos = await latestVideos(db, cfg, { deep, knownIds });
  } catch (e) {
    setStatus(db, { last_sync: utc(Date.now()), last_error: e.message });
    throw e;
  }
  let added = 0;
  let skipped = 0;
  let review = 0;
  const fresh = [];
  const live = mx ? null : videos.find((v) => v.state === 'live'); // with Mux, Mux says when we're live
  const liveId = mx ? null : liveNow(db)?.video_id;
  // Upcoming and live ones come in once they're over (a page that couldn't be read doesn't say
  // the stream on now is over).
  for (const v of videos.filter((x) => x.state === 'none' && !(x.unread && x.video_id === liveId)).reverse()) {
    const row = describe(db, cfg, v);
    const place = placement(db, cfg, v, row);
    const id = insertMedia(db, row, place);
    if (!id) continue;
    if (place.status === 'skipped') skipped++;
    else if (place.status === 'review') review++;
    else { added++; fresh.push({ id, ...row }); }
  }
  // Videos that came in before their length could be read (no API key then): read it now, and
  // take any that are too short out of the app. Only rows still missing a length are touched.
  if (hasApiKey()) {
    const unknown = db.prepare("SELECT id, video_id, status FROM media WHERE source = 'youtube' AND duration IS NULL AND status IN ('published', 'review') AND edited_at IS NULL LIMIT 200").all();
    if (unknown.length) {
      const known = new Map((await videoDetails(unknown.map((r) => r.video_id))).filter((v) => v.duration != null && v.state === 'none').map((v) => [v.video_id, v.duration]));
      for (const r of unknown) {
        const secs = known.get(r.video_id);
        if (secs == null) continue;
        // (A video staff chose by hand is left as they set it.)
        const tooShort = !cfg.playlist_id && secs < cfg.min_minutes * 60;
        const next = tooShort ? 'skipped' : r.status === 'review' ? 'published' : r.status;
        db.prepare('UPDATE media SET duration = ?, status = ?, skip_reason = ? WHERE id = ?').run(secs, next, tooShort ? `Under ${cfg.min_minutes} minutes` : '', r.id);
        if (tooShort) skipped++;
      }
    }
  }
  // A YouTube copy of a service already here joins it (before any notice goes out about it).
  const merged = new Set(autoLink(db).map((l) => l.absorbed.video_id));
  await linkFromChannel(db, { now }).catch((e) => console.error('Linking from the channel failed:', e.message));
  for (let i = fresh.length - 1; i >= 0; i--) if (merged.has(fresh[i].video_id)) { fresh.splice(i, 1); added--; }
  // Live now: set it. It's only over when the live check says so, or when that video itself now
  // reads as finished.
  if (live) setLive(db, cfg, live);
  else if (liveId && videos.some((v) => v.video_id === liveId && v.state === 'none' && !v.unread)) setLive(db, cfg, null);
  setStatus(db, { last_sync: utc(Date.now()), last_error: '', deep_done: deep || status(db).deep_done || false });
  // Only brand-new messages (not a first import or a look back) get a notice.
  const recent = fresh.filter((m) => now - new Date(`${m.recorded_at.replace(' ', 'T')}Z`) < 3 * 86400e3);
  if (cfg.notify_new && !first && !deep && recent.length) {
    const m = recent.at(-1);
    announce(db, { title: `New message: ${m.title}`, body: [m.speaker, m.series].filter(Boolean).join(' · ') || 'Watch it in the app.', app_url: `/app/#/watch/${m.id}`, tag: `media-${m.id}` });
  }
  return { added, skipped, review };
}

// Every few minutes around service times (from 30 minutes before to 2 hours after a service
// starts): are we live? Outside those times the hourly sync is enough.
export async function checkLive(db) {
  const cfg = mediaSettings(db);
  if (!cfg.channel_id || muxStreaming(db)) return null;
  const now = localNow(churchTz(db));
  const at = new Date(`${now.date}T${now.time}:00Z`).getTime();
  const near = db.prepare('SELECT starts_at FROM services WHERE substr(starts_at, 1, 10) BETWEEN ? AND ?')
    .all(new Date(at - 86400e3).toISOString().slice(0, 10), now.date)
    .some((s) => { const t = new Date(`${s.starts_at}:00Z`).getTime(); return at >= t - 30 * 60e3 && at <= t + 120 * 60e3; });
  const was = liveNow(db);
  if (!near && !was) return null;
  let live = null;
  if (hasApiKey()) {
    const feed = await readFeed(cfg.channel_id).catch(() => ({ entries: [] }));
    const ids = [...new Set([...feed.entries.slice(0, 5).map((e) => e.video_id), ...(was ? [was.video_id] : [])])];
    if (ids.length) live = (await videoDetails(ids)).find((v) => v.state === 'live') || null;
  } else {
    const page = await getText(`${SITE()}/channel/${cfg.channel_id}/live`).catch(() => null);
    if (page == null) return was; // couldn't ask: nothing changes
    const id = (/"videoDetails":\{"videoId":"([\w-]{11})"/.exec(page) || [])[1];
    if (id && /"isLiveNow":true/.test(page)) live = { video_id: id, title: decode((/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/.exec(page) || [])[1] || '').replace(/\\(.)/g, '$1') };
    // The channel page doesn't always say so: it's over after three checks in a row (6 minutes).
    if (!live && was && (was.misses || 0) < 2) {
      setSetting(db, 'media_live', { ...was, misses: (was.misses || 0) + 1 });
      return was;
    }
  }
  const changed = setLive(db, cfg, live);
  // Just ended: bring the recording in.
  if (changed && !live) await syncMedia(db).catch(() => {});
  return live;
}

// What the staff screens see. (Mux is dormant: the church streams on YouTube, so it isn't shown.)
export const mediaStatus = (db) => ({ ...status(db), live: liveNow(db), api_key: hasApiKey() });
// How many videos are waiting in Needs a look, for the menu badge.
export const reviewCount = (db) => db.prepare("SELECT COUNT(*) n FROM media WHERE status = 'review'").get().n;
