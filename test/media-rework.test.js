// Media, YouTube-first: the messages playlist (read through the Data API, or the playlist's public
// feed), the title-word and minimum-length rules, "Needs a look" (a length that couldn't be read,
// a likely duplicate), no more over-matching to a service, staff-only guards, and the dormant
// Mux and podcast parts. YouTube is a stand-in server; every date is fixed, so nothing here
// depends on what day it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { matchService, insertMedia, parsePlaylistId } from '../server/media.js';

let server, base, db;
const cookies = {};
const CH = 'UCabcdefghijklmnopqrstuv';
const PL = 'PLmsgs0123456789abcdef';
const SUN = '2025-03-02'; // a fixed Sunday (US winter time: 16:30Z is 10:30 in Chicago)

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-mr-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago')");
  for (const [key, role] of [['admin', 'admin'], ['staff', 'staff'], ['vol', 'volunteer']]) {
    const id = db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').run(`${key}@mb.org`, role).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
  // A service that Sunday with a message in its order of service.
  const svc = Number(db.prepare("INSERT INTO services (campus_id, title, starts_at, series) VALUES (1, 'Sunday', ?, 'Unshakable')").run(`${SUN}T10:00`).lastInsertRowid);
  db.prepare("INSERT INTO plan_items (service_id, kind, category, title, info, sort) VALUES (?, 'item', 'Message', 'Standing Firm', 'Pastor Dallas', 1)").run(svc);
});
after(() => server.close());

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

// A stand-in YouTube. `videos` is { id: { title, secs, at, state, short } }; `playlist` and
// `channel` list the ids each source returns, newest first. `requests` records what was asked.
function youtube(t, { key = false } = {}) {
  const yt = { videos: {}, playlist: [], channel: [], requests: [], unreadable: new Set() };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    yt.requests.push(`${u.pathname}${u.search}`);
    const send = (body, type = 'text/html') => res.writeHead(200, { 'content-type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));
    const entry = (id) => `<entry><yt:videoId>${id}</yt:videoId><title>${yt.videos[id].title}</title><published>${yt.videos[id].at}</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/${id}/hq.jpg"/><media:description>d</media:description></media:group></entry>`;
    if (u.pathname === '/feeds/videos.xml') {
      const list = u.searchParams.get('playlist_id') ? (u.searchParams.get('playlist_id') === PL ? yt.playlist : null) : yt.channel;
      if (!list) return res.writeHead(404).end();
      return send(`<feed><title>${u.searchParams.get('playlist_id') ? 'Sunday Messages' : 'MB Church'}</title>${list.map(entry).join('')}</feed>`, 'application/xml');
    }
    if (u.pathname === '/watch') {
      const v = yt.videos[u.searchParams.get('v')];
      if (!v) return res.writeHead(404).end();
      if (yt.unreadable.has(u.searchParams.get('v'))) return send('<html>no details here</html>');
      return send(`"lengthSeconds":"${v.secs}"${v.state === 'upcoming' ? ',"isUpcoming":true' : ''}${v.state === 'live' ? ',"isLiveNow":true,"isLive":true' : ''}`);
    }
    if (u.pathname === '/api/channels') return send({ items: [{ id: CH, snippet: { title: 'MB Church' } }] }, 'application/json');
    if (u.pathname === '/api/playlists') return send({ items: u.searchParams.get('id') === PL ? [{ id: PL, snippet: { title: 'Sunday Messages' } }] : [] }, 'application/json');
    if (u.pathname === '/api/playlistItems') {
      const id = u.searchParams.get('playlistId');
      const list = id === PL ? yt.playlist : id === `UU${CH.slice(2)}` ? yt.channel : [];
      return send({ items: list.map((videoId) => ({ contentDetails: { videoId } })) }, 'application/json');
    }
    if (u.pathname === '/api/videos') {
      return send({ items: u.searchParams.get('id').split(',').filter((id) => yt.videos[id]).map((id) => {
        const v = yt.videos[id];
        return { id, snippet: { title: v.title, publishedAt: v.at, liveBroadcastContent: v.state || 'none' }, contentDetails: { duration: `PT${Math.floor(v.secs / 3600)}H${Math.floor(v.secs / 60) % 60}M${v.secs % 60}S` } };
      }) }, 'application/json');
    }
    res.writeHead(404).end();
  }).listen(0);
  const saved = { ...process.env };
  t.after(() => { srv.close(); for (const k of ['MB_YOUTUBE_SITE', 'MB_YOUTUBE_API', 'YOUTUBE_API_KEY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  return new Promise((resolve) => srv.once('listening', () => {
    process.env.MB_YOUTUBE_SITE = `http://127.0.0.1:${srv.address().port}`;
    process.env.MB_YOUTUBE_API = `http://127.0.0.1:${srv.address().port}/api`;
    if (key) process.env.YOUTUBE_API_KEY = 'yt-key'; else delete process.env.YOUTUBE_API_KEY;
    resolve(yt);
  }));
}

const reset = () => {
  db.exec("DELETE FROM media; DELETE FROM settings WHERE key IN ('media', 'media_status', 'media_live', 'media_live_notified')");
};
const rowOf = (id) => { const r = db.prepare('SELECT status, skip_reason, title, speaker, series, duration FROM media WHERE video_id = ?').get(id); return r && { ...r }; };

test('playlist mode with the Data API reads only the playlist; title words and the minimum length keep videos out', async (t) => {
  reset();
  const yt = await youtube(t, { key: true });
  yt.videos = {
    msgAAAAAAAA: { title: 'Standing Firm', secs: 3600, at: `${SUN}T16:30:00Z` },
    shortBBBBBB: { title: 'Quick clip', secs: 300, at: `${SUN}T17:00:00Z` },
    kidsCCCCCCC: { title: 'Kids Club: Week 2', secs: 2700, at: `${SUN}T17:30:00Z` },
    liveDDDDDDD: { title: 'Live now', secs: 0, at: `${SUN}T18:00:00Z`, state: 'live' },
    soonEEEEEEE: { title: 'Next week', secs: 0, at: `${SUN}T18:30:00Z`, state: 'upcoming' },
    chanFFFFFFF: { title: 'Midweek chat', secs: 3000, at: '2025-03-09T16:30:00Z' },
  };
  yt.playlist = ['msgAAAAAAAA', 'shortBBBBBB', 'kidsCCCCCCC', 'liveDDDDDDD', 'soonEEEEEEE'];
  yt.channel = [...yt.playlist, 'chanFFFFFFF'];

  // The playlist link is checked, and a skip list is tidied (any case, no repeats).
  assert.equal((await api('vol', 'PUT', '/media/setup', { playlist: PL })).status, 403);
  assert.equal((await api('admin', 'PUT', '/media/setup', { channel: CH })).status, 200);
  const bad = await api('admin', 'PUT', '/media/setup', { playlist: 'my favourite videos' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /playlist/);
  assert.equal((await api('admin', 'PUT', '/media/setup', { playlist: 'https://www.youtube.com/playlist?list=PLdoesnotexist0123456' })).status, 400); // YouTube has none
  const set = await api('admin', 'PUT', '/media/setup', { playlist: `https://www.youtube.com/playlist?list=${PL}&si=abc`, skip_words: ' Kids , VBS,kids ' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.data.settings.playlist_id, set.data.settings.playlist_title, set.data.settings.skip_words], [PL, 'Sunday Messages', 'kids, vbs']);

  // Saving other things doesn't touch the channel or the playlist.
  assert.equal((await api('admin', 'PUT', '/media/setup', { notify_live: false })).data.settings.channel_id, CH);

  yt.requests.length = 0;
  const first = await api('admin', 'POST', '/media/sync', {});
  assert.deepEqual(first.data, { added: 2, skipped: 1, review: 0 });
  const lists = yt.requests.filter((r) => r.startsWith('/api/playlistItems'));
  assert.ok(lists.length && lists.every((r) => r.includes(`playlistId=${PL}`)), 'only the messages playlist is read');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media WHERE video_id = 'chanFFFFFFF'").get().n, 0);

  // Published from the schedule; skipped ones say why; live and upcoming wait until they're over.
  assert.deepEqual(rowOf('msgAAAAAAAA'), { status: 'published', skip_reason: '', title: 'Standing Firm', speaker: 'Pastor Dallas', series: 'Unshakable', duration: 3600 });
  assert.equal(rowOf('shortBBBBBB').status, 'published', 'with a playlist, a short edited message still comes in');
  assert.equal(rowOf('kidsCCCCCCC').status, 'skipped');
  assert.equal(rowOf('kidsCCCCCCC').skip_reason, 'Title has “kids”');
  assert.equal(rowOf('liveDDDDDDD'), undefined);
  assert.equal(rowOf('soonEEEEEEE'), undefined);

  // Staff see them under "Not in the app" with the reason; a skipped one can be added by hand.
  const all = (await api('staff', 'GET', '/media')).data;
  assert.deepEqual(all.counts, { published: 2, skipped: 1 });
  assert.deepEqual(all.items.filter((m) => m.status === 'skipped').map((m) => m.reason).sort(), ['Title has “kids”']);
  const kids = all.items.find((m) => m.yt_title === 'Kids Club: Week 2');
  assert.equal((await api('staff', 'PATCH', `/media/${kids.id}`, { status: 'published' })).status, 200);
  assert.equal((await api(null, 'GET', '/watch')).data.items.length, 3);

  // "Bring in older videos" reads only the playlist too.
  yt.requests.length = 0;
  assert.equal((await api('admin', 'POST', '/media/sync', { deep: true })).status, 200);
  const deepLists = yt.requests.filter((r) => r.startsWith('/api/playlistItems'));
  assert.ok(deepLists.length && deepLists.every((r) => r.includes(`playlistId=${PL}`)));

  // One-time clean-up: videos in the app that aren't in the playlist can be hidden (never deleted).
  const stray = insertMedia(db, { video_id: 'strayLivestr', title: 'Join us for Sunday Service Online', thumbnail: '', recorded_at: `${SUN} 16:00:00`, day: SUN, service_id: null, campus_id: null, speaker: '', series: '', was_live: 1, duration: 7000 });
  insertMedia(db, { source: 'mux', video_id: 'mux:keep', mux_asset_id: 'keep', playback_id: 'keep-pb', title: 'Old Mux', thumbnail: '', recorded_at: `${SUN} 16:00:00`, day: SUN, service_id: null, campus_id: null, speaker: '', series: '', was_live: 0 });
  assert.equal((await api('vol', 'GET', '/media/playlist-extras')).status, 403);
  assert.equal((await api('vol', 'POST', '/media/playlist-extras/hide', {})).status, 403);
  assert.equal((await api('staff', 'GET', '/media/playlist-extras')).data.count, 1);
  const noHeader = await fetch(`${base}/api/media/playlist-extras/hide`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.staff }, body: '{}' });
  assert.equal(noHeader.status, 403);
  assert.deepEqual((await api('staff', 'POST', '/media/playlist-extras/hide', {})).data, { hidden: 1 });
  const hidden = (await api('staff', 'GET', '/media')).data.items.find((m) => m.id === stray);
  assert.deepEqual([hidden.status, hidden.reason], ['hidden', 'Not in the messages playlist']);
  assert.match(db.prepare("SELECT detail FROM audit_log WHERE action = 'media.hide_not_in_playlist'").get().detail, new RegExp(`"ids":\\[${stray}\\]`), 'the audit names what was hidden');
  assert.equal(rowOf('msgAAAAAAAA').status, 'published'); // in the playlist: untouched
  assert.equal(db.prepare("SELECT status FROM media WHERE video_id = 'mux:keep'").get().status, 'published');
  assert.equal((await api('staff', 'GET', '/media/playlist-extras')).data.count, 0);
  // Reversible.
  assert.equal((await api('staff', 'PATCH', `/media/${stray}`, { status: 'published' })).status, 200);
  assert.equal((await api('staff', 'GET', '/media')).data.items.find((m) => m.id === stray).reason, '');
  db.prepare('DELETE FROM media WHERE id = ?').run(stray);

  // Back to the whole channel: its uploads are read, and the video outside the playlist comes in.
  assert.equal((await api('admin', 'PUT', '/media/setup', { playlist: '' })).data.settings.playlist_id, '');
  yt.requests.length = 0;
  assert.deepEqual((await api('admin', 'POST', '/media/sync', {})).data, { added: 1, skipped: 0, review: 0 });
  assert.ok(yt.requests.some((r) => r.includes(`playlistId=UU${CH.slice(2)}`)));
  // Without a playlist the length rule applies again.
  yt.videos.tinyGGGGGGG = { title: 'Quick hello', secs: 600, at: '2025-03-12T16:30:00Z' };
  yt.channel = ['tinyGGGGGGG', ...yt.channel];
  assert.deepEqual((await api('admin', 'POST', '/media/sync', {})).data, { added: 0, skipped: 1, review: 0 });
  assert.equal(rowOf('tinyGGGGGGG').skip_reason, 'Under 20 minutes');
  // A short video that came in before its length could be read is taken out once the key can read it.
  yt.videos.oldkidsHHHH = { title: 'Kids song', secs: 180, at: '2025-03-01T16:30:00Z' };
  insertMedia(db, { video_id: 'oldkidsHHHH', title: 'Kids song', thumbnail: '', recorded_at: '2025-03-01 16:30:00', day: '2025-03-01', service_id: null, campus_id: null, speaker: '', series: '', was_live: 0, duration: null });
  assert.equal(rowOf('oldkidsHHHH').status, 'published');
  assert.equal((await api('admin', 'POST', '/media/sync', {})).status, 200);
  assert.deepEqual([rowOf('oldkidsHHHH').status, rowOf('oldkidsHHHH').skip_reason, rowOf('oldkidsHHHH').duration], ['skipped', 'Under 20 minutes', 180]);
  // …but one staff chose to show by hand is left as they set it.
  yt.videos.handpickIII = { title: 'Short but wanted', secs: 240, at: '2025-03-02T16:30:00Z' };
  insertMedia(db, { video_id: 'handpickIII', title: 'Short but wanted', thumbnail: '', recorded_at: '2025-03-02 16:30:00', day: '2025-03-02', service_id: null, campus_id: null, speaker: '', series: '', was_live: 0, duration: null });
  db.prepare("UPDATE media SET edited_at = datetime('now') WHERE video_id = 'handpickIII'").run();
  await api('admin', 'POST', '/media/sync', {});
  assert.equal(rowOf('handpickIII').status, 'published');
  assert.equal(rowOf('chanFFFFFFF').status, 'published');
  // Without a speaker from the schedule that Sunday, nothing is guessed.
  assert.equal(rowOf('chanFFFFFFF').speaker, '');
});

test('playlist mode through the public playlist feed: unknown length and likely duplicates wait in Needs a look', async (t) => {
  reset();
  const yt = await youtube(t);
  yt.videos = {
    origAAAAAAA: { title: 'Standing Firm', secs: 3600, at: `${SUN}T16:30:00Z` },
    dupeBBBBBBB: { title: 'Standing Firm (copy)', secs: 3700, at: `${SUN}T19:00:00Z` }, // same day, within 3 minutes of the first
    blindCCCCCC: { title: 'Mystery length', secs: 3000, at: '2025-03-16T16:30:00Z' },
    otherDDDDDD: { title: 'Another Sunday', secs: 1800, at: '2025-03-23T16:30:00Z' },
    farEEEEEEEE: { title: 'Same day, much longer', secs: 4500, at: `${SUN}T20:00:00Z` }, // 15 minutes longer: not a copy
  };
  yt.playlist = ['farEEEEEEEE', 'dupeBBBBBBB', 'otherDDDDDD', 'blindCCCCCC', 'origAAAAAAA'];
  yt.channel = ['channelOnly'];
  yt.videos.channelOnly = { title: 'Not a message', secs: 3600, at: '2025-03-30T16:30:00Z' };
  yt.unreadable.add('blindCCCCCC');

  assert.equal((await api('admin', 'PUT', '/media/setup', { channel: CH, playlist: PL })).data.settings.playlist_title, 'Sunday Messages');
  yt.requests.length = 0;
  const r = await api('admin', 'POST', '/media/sync', {});
  assert.deepEqual(r.data, { added: 3, skipped: 0, review: 2 });
  assert.ok(yt.requests.some((x) => x.startsWith('/feeds/videos.xml?playlist_id=')));
  assert.ok(!yt.requests.some((x) => x.startsWith('/feeds/videos.xml?channel_id=')), 'the channel feed is not read in playlist mode');

  assert.equal(rowOf('origAAAAAAA').status, 'published');
  assert.deepEqual([rowOf('dupeBBBBBBB').status, rowOf('dupeBBBBBBB').skip_reason], ['review', 'Possible duplicate']);
  assert.deepEqual([rowOf('blindCCCCCC').status, rowOf('blindCCCCCC').skip_reason], ['review', 'Couldn’t check its length']);
  assert.equal(rowOf('farEEEEEEEE').status, 'published');
  assert.equal(rowOf('otherDDDDDD').status, 'published');
  assert.equal(rowOf('channelOnly'), undefined);

  // Neither is in the app; the menu badge counts them for staff only.
  const watch = (await api(null, 'GET', '/watch')).data.items.map((m) => m.title);
  assert.ok(!watch.includes('Standing Firm (copy)') && !watch.includes('Mystery length'));
  assert.equal((await api('staff', 'GET', '/attention')).data.media_review, 2);
  assert.equal((await api('vol', 'GET', '/attention')).data.media_review, 0);
  const look = (await api('staff', 'GET', '/media?status=review')).data;
  assert.deepEqual(look.items.map((m) => m.reason).sort(), ['Couldn’t check its length', 'Possible duplicate']);
  assert.equal(look.counts.review, 2);

  // Staff decide: show one, hide the other.
  const [dupe, blind] = ['dupeBBBBBBB', 'blindCCCCCC'].map((v) => look.items.find((m) => m.video_id === v));
  assert.equal((await api('staff', 'PATCH', `/media/${blind.id}`, { status: 'published' })).status, 200);
  assert.equal((await api('staff', 'PATCH', `/media/${dupe.id}`, { status: 'hidden' })).status, 200);
  assert.equal((await api('staff', 'GET', '/attention')).data.media_review, 0);
  assert.equal((await api('staff', 'GET', '/media')).data.items.find((m) => m.id === dupe.id).reason, 'Hidden by staff');
  // Checking again doesn't bring them back.
  assert.deepEqual((await api('admin', 'POST', '/media/sync', {})).data, { added: 0, skipped: 0, review: 0 });
});

test('a service is matched only when it is that day and near the time (or the video is in the playlist)', () => {
  const at = (hhmmZ) => `${SUN}T${hhmmZ}:00Z`;
  assert.equal(matchService(db, at('16:30')).service.title, 'Sunday'); // 10:30 for a 10:00 service
  assert.equal(matchService(db, at('19:45')).service.title, 'Sunday'); // 13:45: within 4 hours
  // The only service that day, but the video is from the evening: no longer matched by default…
  assert.equal(matchService(db, at('00:30').replace(SUN, '2025-03-03')).service, null); // 18:30 local Sunday
  // …unless it is in the messages playlist.
  assert.equal(matchService(db, '2025-03-03T00:30:00Z', { inPlaylist: true }).service.title, 'Sunday');
  // A day with no service is never matched, playlist or not.
  assert.equal(matchService(db, '2025-03-09T16:30:00Z', { inPlaylist: true }).service, null);
  assert.equal(matchService(db, '2025-03-09T16:30:00Z').day, '2025-03-09');
});

test('playlist links and ids are checked', () => {
  assert.equal(parsePlaylistId(`https://youtube.com/playlist?list=${PL}`), PL);
  assert.equal(parsePlaylistId(`https://www.youtube.com/watch?v=abcdefghijk&list=${PL}&index=2`), PL);
  assert.equal(parsePlaylistId(PL), PL);
  for (const no of ['', 'hello', 'https://www.youtube.com/@church', 'https://youtu.be/abcdefghijk', 'list=', 'LL', 'https://www.youtube.com/playlist?list=WL']) assert.throws(() => parsePlaylistId(no), /playlist/, no);
});

test('staff only, the app header, series spelling, and Mux and the podcast stay out of the way', async (t) => {
  reset();
  const saved = { ...process.env };
  t.after(() => { for (const k of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  delete process.env.MUX_TOKEN_ID;
  delete process.env.MUX_TOKEN_SECRET;

  // Guards: staff only on everything, and non-GET calls need x-mb.
  for (const [method, url, body] of [['GET', '/media'], ['GET', '/media/setup'], ['PUT', '/media/setup', { min_minutes: 30 }], ['POST', '/media/sync', {}], ['POST', '/media', { url: 'https://youtu.be/abcdefghijk' }], ['GET', '/media/podcast']]) {
    assert.equal((await api('vol', method, url, body)).status, 403, `${method} ${url}`);
    assert.equal((await api(null, method, url, body)).status, 401, `${method} ${url}`);
  }
  for (const [method, url] of [['PUT', '/media/setup'], ['POST', '/media/sync'], ['POST', '/media']]) {
    const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', cookie: cookies.admin }, body: '{}' });
    assert.equal(res.status, 403, `${method} ${url} without x-mb`);
  }

  // What the staff screens get has no Mux and no "own player only".
  const setup = (await api('staff', 'GET', '/media/setup')).data;
  assert.equal(setup.mux, undefined);
  assert.equal(setup.status.mux, undefined);
  assert.ok(!('own_player_only' in setup.settings) && !('keep_full_days' in setup.settings));
  assert.equal(setup.api_key, false);
  const put = await api('staff', 'PUT', '/media/setup', { own_player_only: true, keep_full_days: 7, min_minutes: 25 });
  assert.equal(put.data.settings.min_minutes, 25);
  assert.ok(!('own_player_only' in put.data.settings));

  // An old Mux recording still plays, and YouTube videos are not hidden by the old switch.
  const row = (video_id, extra = {}) => ({ video_id, title: video_id, thumbnail: '', recorded_at: `${SUN} 16:00:00`, day: SUN, service_id: null, campus_id: null, speaker: '', series: '', was_live: 0, ...extra });
  insertMedia(db, row('mux:old1', { source: 'mux', mux_asset_id: 'old1', playback_id: 'old1-pb', title: 'Old Mux service', series: 'Unshakable' }));
  insertMedia(db, row('ytYTYTYTYTY', { title: 'On YouTube' }));
  const items = (await api(null, 'GET', '/watch')).data.items;
  const mux = items.find((m) => m.title === 'Old Mux service');
  assert.deepEqual([mux.source, mux.playback_id, mux.video_id], ['mux', 'old1-pb', null]);
  assert.ok(items.some((m) => m.title === 'On YouTube'));
  assert.equal((await api(null, 'GET', `/watch/${mux.id}`)).data.source, 'mux');

  // A series is spelled the way the library already has it.
  const yt = db.prepare("SELECT id FROM media WHERE video_id = 'ytYTYTYTYTY'").get();
  assert.equal((await api('staff', 'PATCH', `/media/${yt.id}`, { series: ' unshakable ' })).status, 200);
  assert.equal((await api('staff', 'GET', `/media/${yt.id}`)).data.series, 'Unshakable');
  assert.equal((await api('staff', 'PATCH', `/media/${yt.id}`, { series: 'Brand New' })).status, 200);
  assert.equal((await api('staff', 'GET', `/media/${yt.id}`)).data.series, 'Brand New');
  assert.deepEqual((await api('staff', 'GET', '/media')).data.series, ['Brand New', 'Unshakable']);

  // The podcast is on hold: no feed, and it can't be turned on without Mux's audio.
  assert.equal((await fetch(`${base}/podcast.xml`)).status, 404);
  const pod = await api('admin', 'PUT', '/media/podcast', { enabled: true, email: 'media@mb.org' });
  assert.equal(pod.status, 400);
  assert.match(pod.data.error, /isn’t set up/);
  assert.equal((await fetch(`${base}/podcast.xml`)).status, 404);
});
