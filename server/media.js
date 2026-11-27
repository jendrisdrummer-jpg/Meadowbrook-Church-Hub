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
import { getSetting, setSetting } from './db.js';
import { localNow } from './http.js';
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

// keep_full_days belongs to Mux (dormant: the church doesn't use it), so it has no screen any more.
export const DEFAULTS = { channel_id: '', channel_title: '', channel_input: '', playlist_id: '', playlist_input: '', playlist_title: '', skip_words: '', title_format: 'plain', min_minutes: 20, notify_new: false, notify_live: true, keep_full_days: 30 };
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
  if (hasApiKey()) return { ids: new Set(await playlistVideoIds(cfg.playlist_id, 40)), complete: true };
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

async function doSync(db, { deep = false } = {}) {
  const cfg = mediaSettings(db);
  // Streaming through Mux: recordings come from there, and YouTube only for older videos.
  if (!cfg.channel_id || (muxStreaming(db) && !deep)) return { added: 0, skipped: 0, review: 0 };
  const first = !db.prepare('SELECT 1 FROM media LIMIT 1').get();
  const knownIds = new Set(db.prepare('SELECT video_id FROM media').all().map((r) => r.video_id));
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
  const live = videos.find((v) => v.state === 'live');
  const liveId = liveNow(db)?.video_id;
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
  // Live now: set it. It's only over when the live check says so, or when that video itself now
  // reads as finished.
  if (live) setLive(db, cfg, live);
  else if (liveId && videos.some((v) => v.video_id === liveId && v.state === 'none' && !v.unread)) setLive(db, cfg, null);
  setStatus(db, { last_sync: utc(Date.now()), last_error: '', deep_done: deep || status(db).deep_done || false });
  // Only brand-new messages (not a first import or a look back) get a notice.
  const recent = fresh.filter((m) => Date.now() - new Date(`${m.recorded_at.replace(' ', 'T')}Z`) < 3 * 86400e3);
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
