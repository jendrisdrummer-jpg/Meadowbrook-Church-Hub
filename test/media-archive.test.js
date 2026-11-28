// Streaming to Mux and YouTube together: one item per service (matched by stream start time, never
// guessed), "message starts here / ends here" (a Mux clip, or YouTube start and end), and keeping
// services in Mux for N months before they move to their YouTube copy. Mux and YouTube are
// stand-in servers (no real keys), the archive job takes an injected clock, and every date is fixed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { openDb, setSetting, getSetting } from '../server/db.js';
import { createApp } from '../server/index.js';
import { startSession } from '../server/auth.js';
import { insertMedia, linkPlan, autoLink, linkItems, unlinkItem, youtubeIdOf, studioUrl } from '../server/media.js';
import { muxTick, archiveOldMux } from '../server/mux.js';
import { hmsFull } from '../public/js/video.js';

let server, base, db;
const cookies = {};
const CH = 'UCabcdefghijklmnopqrstuv';
const SUN = '2025-03-02'; // US winter time: 16:00Z is 10:00 in Chicago
let svc1; let svcA; let svcB;
const saved = { ...process.env };

before(async () => {
  db = openDb(':memory:');
  server = createApp({ db, uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mb-ma-')) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("INSERT INTO campuses (id, name, short_name, timezone) VALUES (1, 'Meadowbrook North', 'North', 'America/Chicago'), (2, 'Meadowbrook South', 'South', 'America/Chicago')");
  for (const [key, role, campuses] of [['admin', 'admin', null], ['north', 'admin', '[1]'], ['staff', 'staff', null], ['south', 'staff', '[2]'], ['vol', 'volunteer', null]]) {
    const id = db.prepare('INSERT INTO users (email, role, campus_ids) VALUES (?, ?, ?)').run(`${key}@mb.org`, role, campuses).lastInsertRowid;
    startSession(db, { secure: false }, { setHeader: (_k, v) => { cookies[key] = v.split(';')[0]; } }, id);
  }
  const svc = (title, at) => Number(db.prepare("INSERT INTO services (campus_id, title, starts_at, series) VALUES (1, ?, ?, 'Unshakable')").run(title, at).lastInsertRowid);
  svc1 = svc('Sunday', `${SUN}T10:00`);
  svcA = svc('Early', `${SUN}T09:00`);
  svcB = svc('Late', `${SUN}T11:00`);
  db.prepare("INSERT INTO plan_items (service_id, kind, category, title, info, sort) VALUES (?, 'item', 'Message', 'Standing Firm', 'Pastor Dallas', 1)").run(svc1);
});
after(() => {
  server.close();
  for (const k of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MB_MUX_API', 'MB_YOUTUBE_API', 'MB_YOUTUBE_SITE', 'YOUTUBE_API_KEY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function api(role, method, url, body) {
  const res = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', 'x-mb': '1', ...(role ? { cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

const reset = () => {
  db.exec("DELETE FROM media; DELETE FROM audit_log; DELETE FROM notifications; DELETE FROM settings WHERE key IN ('media', 'media_status', 'media_live', 'media_live_notified', 'media_archive')");
  setSetting(db, 'mux', { live_stream_id: 'ls1', playback_id: 'live-pb', stream_key: 'k' });
};

// ---------------------------------------------------------------- stand-ins
// Mux: records clips asked for and assets deleted. state.clips[id] is the clip's status;
// state.noPlayback has ids that are "ready" but have no playback id yet; state.failDelete ids answer 500.
function muxStandIn(t) {
  const state = { assets: [], clips: {}, deleted: [], made: [], noPlayback: new Set(), failDelete: new Set(), gone: new Set(), calls: [] };
  let n = 0;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      const send = (code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      state.calls.push(`${req.method} ${u.pathname}`);
      if (req.method === 'GET' && u.pathname === '/video/v1/live-streams/ls1') return send(200, { data: { id: 'ls1', status: 'idle', playback_ids: [{ id: 'live-pb', policy: 'public' }] } });
      if (req.method === 'GET' && u.pathname === '/video/v1/assets') return send(200, { data: state.assets });
      if (req.method === 'POST' && u.pathname === '/video/v1/assets') {
        const id = `clip${++n}`;
        state.made.push(body);
        state.clips[id] = 'preparing';
        return send(201, { data: { id, status: 'preparing', playback_ids: [{ id: `${id}-pb`, policy: 'public' }] } });
      }
      const one = /^\/video\/v1\/assets\/(\w+)$/.exec(u.pathname);
      if (one && req.method === 'GET') return state.clips[one[1]] ? send(200, { data: { id: one[1], status: state.clips[one[1]], playback_ids: state.noPlayback.has(one[1]) ? [] : [{ id: `${one[1]}-pb` }] } }) : send(404, {});
      if (one && req.method === 'DELETE') {
        if (state.failDelete.has(one[1])) return send(500, { error: { messages: ['Mux is having a bad day'] } });
        if (state.gone.has(one[1])) return send(404, {});
        state.deleted.push(one[1]);
        return res.writeHead(204).end();
      }
      send(404, { error: { messages: ['nope'] } });
    });
  }).listen(0);
  t.after(() => srv.close());
  return new Promise((resolve) => srv.once('listening', () => {
    process.env.MUX_TOKEN_ID = 'tok';
    process.env.MUX_TOKEN_SECRET = 'sec';
    process.env.MB_MUX_API = `http://127.0.0.1:${srv.address().port}`;
    resolve(state);
  }));
}

// YouTube (Data API): videos is { id: { title, secs, at, live, privacy, upload } }.
function youtubeStandIn(t) {
  const yt = { videos: {}, channel: [], playlist: [], fail: 0, asked: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (u.pathname === '/api/playlistItems') {
      const id = u.searchParams.get('playlistId');
      return send(200, { items: (id === `UU${CH.slice(2)}` ? yt.channel : yt.playlist).map((videoId) => ({ contentDetails: { videoId } })) });
    }
    if (u.pathname === '/api/videos') {
      yt.asked++;
      if (yt.fail) return send(yt.fail, { error: { message: 'quota' } });
      return send(200, { items: u.searchParams.get('id').split(',').filter((id) => yt.videos[id]).map((id) => {
        const v = yt.videos[id];
        return {
          id,
          snippet: { title: v.title, publishedAt: v.at, liveBroadcastContent: 'none' },
          contentDetails: { duration: `PT${Math.floor(v.secs / 3600)}H${Math.floor(v.secs / 60) % 60}M${v.secs % 60}S` },
          status: { uploadStatus: v.upload || 'processed', privacyStatus: v.privacy || 'public' },
          ...(v.live ? { liveStreamingDetails: { actualStartTime: v.at } } : {}),
        };
      }) });
    }
    send(404, {});
  }).listen(0);
  t.after(() => srv.close());
  return new Promise((resolve) => srv.once('listening', () => {
    process.env.MB_YOUTUBE_API = `http://127.0.0.1:${srv.address().port}/api`;
    process.env.MB_YOUTUBE_SITE = `http://127.0.0.1:${srv.address().port}`;
    process.env.YOUTUBE_API_KEY = 'yt-key';
    resolve(yt);
  }));
}

// ---------------------------------------------------------------- rows
let seq = 0;
const yid = (n) => `yt${String(n).padStart(9, '0')}`; // 11 characters, like a YouTube id
// A Mux recording of a stream (id of the item back).
function muxItem(o = {}) {
  const asset = o.asset || `asset${++seq}`;
  const id = insertMedia(db, {
    source: 'mux', video_id: `mux:${asset}`, mux_asset_id: asset, playback_id: `${asset}-pb`, title: o.title || 'Standing Firm',
    thumbnail: `https://image.mux.com/${asset}-pb/thumbnail.jpg`, duration: o.duration ?? 4800, recorded_at: o.at || `${SUN} 16:05:00`, day: o.day || SUN,
    service_id: o.service ?? null, campus_id: o.campus ?? null, speaker: o.speaker || '', series: '', was_live: o.live === false ? 0 : 1,
  });
  if (o.yt) db.prepare('UPDATE media SET yt_video_id = ?, linked_by = ? WHERE id = ?').run(o.yt, 'auto', id);
  if (o.marks) db.prepare('UPDATE media SET start_sec = ?, end_sec = ? WHERE id = ?').run(o.marks[0], o.marks[1], id);
  if (o.status) db.prepare('UPDATE media SET status = ?, skip_reason = ? WHERE id = ?').run(o.status, o.reason || '', id);
  return id;
}
// A YouTube video row.
function ytItem(o = {}) {
  const vid = o.video || yid(++seq);
  const id = insertMedia(db, {
    video_id: vid, title: o.title || 'Standing Firm', yt_title: 'Sunday Service', thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, duration: o.duration ?? 4800,
    recorded_at: o.at || `${SUN} 16:10:00`, day: o.day || SUN, service_id: o.service ?? null, campus_id: o.campus ?? null, speaker: '', series: '', was_live: o.live === false ? 0 : 1,
  });
  return { id, video: vid };
}
const row = (id) => db.prepare('SELECT * FROM media WHERE id = ?').get(id);
const count = () => db.prepare('SELECT COUNT(*) n FROM media').get().n;

// ---------------------------------------------------------------- 1. one listing per service
test('matching: stream start times within 3 hours (and of the service) link; anything unclear stays separate', () => {
  reset();
  // Same stream, minutes apart, same service: linked into the one item that keeps the Mux recording.
  const m = muxItem({ service: svc1 });
  const y = ytItem({ service: svc1 });
  const made = autoLink(db);
  assert.equal(made.length, 1);
  assert.equal(count(), 1);
  const item = row(m);
  assert.deepEqual([item.source, item.yt_video_id, item.linked_by, youtubeIdOf(item)], ['mux', y.video, 'auto', y.video]);
  assert.equal(JSON.parse(item.yt_snapshot).video_id, y.video, 'the absorbed YouTube row is kept for Unlink');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.link'").get().n, 1);
  assert.equal(autoLink(db).length, 0, 'running it again changes nothing');

  // The window is 3 hours: 2h50m apart links, 3h10m apart does not.
  reset();
  muxItem({ at: `${SUN} 16:00:00` });
  ytItem({ at: `${SUN} 18:50:00` });
  assert.equal(autoLink(db).length, 1);
  reset();
  muxItem({ at: `${SUN} 16:00:00` });
  ytItem({ at: `${SUN} 19:10:00` });
  assert.equal(linkPlan(db).pairs.length, 0);
  assert.equal(autoLink(db).length, 0);
  assert.equal(count(), 2);

  // Close to each other but more than 3 hours from the service's own start (10:00 → both at 14:00 local).
  reset();
  muxItem({ at: `${SUN} 20:00:00`, service: svc1 });
  ytItem({ at: `${SUN} 20:05:00`, service: svc1 });
  assert.equal(autoLink(db).length, 0);
  // …but with no service to measure from, the two times alone decide.
  reset();
  muxItem({ at: `${SUN} 20:00:00` });
  ytItem({ at: `${SUN} 20:05:00` });
  assert.equal(autoLink(db).length, 1);

  // Different services or campuses never link, and an older upload (not a stream) is never matched.
  reset();
  muxItem({ service: svcA, at: `${SUN} 15:05:00` });
  ytItem({ service: svcB, at: `${SUN} 15:10:00` });
  assert.equal(autoLink(db).length, 0);
  reset();
  muxItem({ campus: 1 });
  ytItem({ campus: 2 });
  assert.equal(autoLink(db).length, 0);
  reset();
  muxItem();
  ytItem({ live: false });
  assert.equal(autoLink(db).length, 0);
  reset();
  muxItem({ live: false });
  ytItem();
  assert.equal(autoLink(db).length, 0);
});

test('matching: an ambiguous match is left alone; services tell two recordings apart; a hand-made split sticks', () => {
  // Two recordings and one YouTube video close together: don't guess.
  reset();
  muxItem({ at: `${SUN} 16:00:00` });
  muxItem({ at: `${SUN} 17:00:00` });
  ytItem({ at: `${SUN} 16:30:00` });
  const plan = linkPlan(db);
  assert.deepEqual([plan.pairs.length, plan.ambiguous], [0, 2]);
  assert.equal(autoLink(db).length, 0);
  assert.equal(count(), 3, 'all three stay, for an admin to link by hand');

  // One recording, two YouTube videos: also left alone.
  reset();
  muxItem();
  ytItem({ at: `${SUN} 16:00:00` });
  ytItem({ at: `${SUN} 17:00:00` });
  assert.equal(autoLink(db).length, 0);

  // Early and late services with a recording and a copy each: their services pair them up.
  reset();
  const a = muxItem({ service: svcA, at: `${SUN} 15:00:00`, title: 'Early' });
  const b = muxItem({ service: svcB, at: `${SUN} 17:00:00`, title: 'Late' });
  const ya = ytItem({ service: svcA, at: `${SUN} 15:05:00` });
  const yb = ytItem({ service: svcB, at: `${SUN} 17:05:00` });
  assert.equal(autoLink(db).length, 2);
  assert.equal(row(a).yt_video_id, ya.video);
  assert.equal(row(b).yt_video_id, yb.video);

  // An admin unlinks: the YouTube video comes back as its own row, and the hub doesn't link that recording again.
  const r = unlinkItem(db, a);
  assert.ok(r.restored);
  assert.equal(row(r.restored).video_id, ya.video);
  assert.equal(row(a).yt_video_id, null);
  assert.equal(autoLink(db).length, 0);
  assert.equal(count(), 3);
  // …and can link them again by hand, whatever the times.
  assert.equal(linkItems(db, a, r.restored, { by: 'hand' }).id, a);
  assert.equal(row(a).linked_by, 'hand');
  assert.equal(count(), 2);
});

test('merging keeps what staff typed, fills blanks, and takes the stricter status', () => {
  reset();
  const m = muxItem({ title: 'Sunday Service · Mar 2' });
  const y = ytItem({ title: 'Standing Firm' });
  db.prepare("UPDATE media SET speaker = 'Pastor Dallas', series = 'Unshakable', edited_at = datetime('now'), start_sec = 600, end_sec = 4200, status = 'hidden', skip_reason = 'Hidden by staff' WHERE id = ?").run(y.id);
  linkItems(db, m, y.id, { by: 'hand' });
  const item = row(m);
  assert.deepEqual([item.title, item.speaker, item.series, item.start_sec, item.end_sec, item.status], ['Standing Firm', 'Pastor Dallas', 'Unshakable', 600, 4200, 'hidden']);
  assert.equal(item.source, 'mux');
  // Two YouTube videos, or a link that isn't a Mux recording and a YouTube video, are refused.
  const y2 = ytItem({});
  assert.throws(() => linkItems(db, y2.id, y2.id), /different/);
  assert.throws(() => linkItems(db, y2.id, m), /Mux recording/);
  assert.throws(() => linkItems(db, m, y2.id), /Mux recording that isn’t linked/);
});

test('with both on, a Sunday streamed to Mux and YouTube is listed once, in either order, and YouTube-only videos still come in', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { channel_id: CH, channel_title: 'MB Church', channel_input: CH, min_minutes: 20, notify_new: false });
  const other = '2025-02-23';
  yt.videos = {
    [yid(901)]: { title: 'Sunday Service', secs: 5400, at: `${SUN}T16:02:00Z`, live: true },
    [yid(902)]: { title: 'Throwback', secs: 3000, at: `${other}T16:00:00Z` }, // an older upload, not a stream
  };
  yt.channel = [yid(901), yid(902)];

  // Order 1: the Mux recording is in; then the YouTube sync finds the same stream and links it.
  const m = muxItem({ asset: 'recA', service: svc1, at: `${SUN} 16:01:00`, title: 'Standing Firm' });
  assert.equal((await api('staff', 'POST', '/media/sync', {})).status, 200);
  let list = (await api('staff', 'GET', '/media')).data.items;
  assert.equal(list.filter((x) => x.day === SUN).length, 1, 'one item for the service');
  assert.equal(list.filter((x) => x.day === other).length, 1, 'the older upload is its own item');
  const item = list.find((x) => x.id === m);
  assert.deepEqual([item.source, item.linked, item.title], ['mux', true, 'Standing Firm']);
  assert.equal((await api(null, 'GET', '/watch')).data.items.filter((x) => x.day === SUN).length, 1);
  await api('staff', 'POST', '/media/sync', {});
  assert.equal(count(), 2, 'a second sync adds nothing');
  // Adding the YouTube address by hand finds the same item.
  const again = await api('staff', 'POST', '/media', { url: `https://youtu.be/${yid(901)}` });
  assert.deepEqual([again.data.existed, again.data.id], [true, m]);

  // Order 2: the YouTube row came first; the Mux recording that arrives later joins it.
  reset();
  setSetting(db, 'media', { channel_id: CH, channel_title: 'MB Church', channel_input: CH, min_minutes: 20, notify_new: false });
  muxItem({ asset: 'old1', day: '2025-01-05', at: '2025-01-05 16:00:00', live: false });
  assert.equal((await api('staff', 'POST', '/media/sync', {})).status, 200);
  const ytRow = db.prepare('SELECT id FROM media WHERE video_id = ?').get(yid(901));
  assert.ok(ytRow, 'the YouTube stream is in the library on its own for now');
  mx.assets = [{ id: 'recB', status: 'ready', duration: 5400, created_at: String(Date.parse(`${SUN}T16:01:00Z`) / 1000), playback_ids: [{ id: 'recB-pb', policy: 'public' }] }];
  await muxTick(db);
  const days = db.prepare('SELECT id, source, yt_video_id FROM media WHERE day = ?').all(SUN);
  assert.equal(days.length, 1, 'still one item');
  assert.deepEqual([days[0].source, days[0].yt_video_id], ['mux', yid(901)]);
});

test('the Sunday stream outside the messages playlist is found in the channel’s uploads', async (t) => {
  reset();
  await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { channel_id: CH, playlist_id: 'PLmsgs0123456789abcdef', playlist_input: 'x', min_minutes: 20 });
  yt.videos = {
    [yid(910)]: { title: 'Sunday Service (live)', secs: 5400, at: `${SUN}T16:03:00Z`, live: true },
    [yid(911)]: { title: 'Throwback', secs: 5400, at: '2025-02-23T16:03:00Z', live: true }, // too far away
  };
  yt.channel = [yid(910), yid(911)];
  yt.playlist = [];
  const m = muxItem({ asset: 'recC', at: `${SUN} 16:00:00` });
  const { syncMedia } = await import('../server/media.js');
  await syncMedia(db, { now: Date.parse(`${SUN}T20:00:00Z`) });
  assert.equal(row(m).yt_video_id, yid(910), 'linked with no row to absorb');
  assert.equal(count(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.link'").get().n, 1);
});

test('by hand: staff link and unlink from the item; volunteers and the public cannot; a campus-limited account stays in its campus', async () => {
  reset();
  const m = muxItem({ campus: 1 });
  const y = ytItem({ at: `${SUN} 21:30:00`, campus: 1 }); // too far apart to link on its own
  assert.equal(autoLink(db).length, 0);

  const panel = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.deepEqual(panel.link_candidates.map((c) => [c.id, c.kind]), [[y.id, 'YouTube video']]);
  assert.equal((await api('vol', 'POST', `/media/${m}/link`, { with: y.id })).status, 403);
  assert.equal((await api(null, 'POST', `/media/${m}/link`, { with: y.id })).status, 401);
  assert.equal((await api('south', 'POST', `/media/${m}/link`, { with: y.id })).status, 404, 'campus 2 staff can’t touch a campus 1 item');
  assert.equal((await api('staff', 'POST', `/media/${m}/link`, { with: y.id + 999 })).status, 404);
  assert.equal((await api('staff', 'POST', `/media/${y.id}/link`, { with: y.id })).status, 400);

  // From the YouTube item's side too: the one item that remains is the Mux recording.
  const linked = await api('staff', 'POST', `/media/${y.id}/link`, { with: m });
  assert.deepEqual([linked.status, linked.data.id], [200, m]);
  const after = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.deepEqual([after.linked, after.linked_by, after.yt_id, after.studio_url, after.link_candidates], [true, 'hand', y.video, studioUrl(y.video), []]);
  assert.equal((await api('staff', 'GET', `/media/${y.id}`)).status, 404, 'the separate YouTube item is gone');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.link' AND user_id IS NOT NULL").get().n, 1);

  assert.equal((await api('vol', 'POST', `/media/${m}/unlink`, {})).status, 403);
  const un = await api('staff', 'POST', `/media/${m}/unlink`, {});
  assert.equal(un.status, 200);
  assert.equal(count(), 2);
  assert.equal((await api('staff', 'POST', `/media/${m}/unlink`, {})).status, 400, 'nothing left to unlink');
});

// ---------------------------------------------------------------- 2. message starts here / ends here
test('marks: saved in seconds, played from YouTube with start and end, shown for YouTube Studio; Mux makes a clip and only then drops the original', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const vid = yid(700);
  const m = muxItem({ asset: 'recM', yt: vid, service: svc1, duration: 5400 });
  assert.equal((await api('vol', 'PATCH', `/media/${m}`, { start: '0:42:10', end: '1:18:30' })).status, 403);
  assert.equal((await api('admin', 'PATCH', `/media/${m}`, { start: '0:42:10', end: '1:18:30' })).status, 200);
  let item = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.deepEqual([item.mark_start, item.mark_end], [2530, 4710]);
  assert.equal(item.studio_url, `https://studio.youtube.com/video/${vid}/editor`);
  assert.deepEqual([hmsFull(item.mark_start), hmsFull(item.mark_end)], ['0:42:10', '1:18:30']);
  assert.equal(hmsFull(0), '0:00:00');
  assert.equal(hmsFull(3723), '1:02:03');

  // Mux was asked for a clip of the recording between the marks.
  assert.deepEqual(mx.made, [{ input: [{ url: 'mux://assets/recM', start_time: 2530, end_time: 4710 }], playback_policy: ['public'], video_quality: 'basic' }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.clip.start' AND user_id IS NOT NULL").get().n, 1);
  // Until it's ready the app plays the full recording between the marks, and nothing is deleted.
  let watch = (await api(null, 'GET', `/watch/${m}`)).data;
  assert.deepEqual([watch.source, watch.playback_id, watch.start, watch.end], ['mux', 'recM-pb', 2530, 4710]);
  await muxTick(db);
  assert.deepEqual(mx.deleted, []);

  // "Ready" without a playback id is not playable: the original stays.
  mx.clips.clip1 = 'ready';
  mx.noPlayback.add('clip1');
  await muxTick(db);
  assert.deepEqual(mx.deleted, []);
  assert.equal(row(m).raw_deleted, 0);
  // Playable: the item switches to the clip, then the full recording is deleted, audited.
  mx.noPlayback.clear();
  await muxTick(db);
  assert.deepEqual(mx.deleted, ['recM']);
  watch = (await api(null, 'GET', `/watch/${m}`)).data;
  assert.deepEqual([watch.source, watch.playback_id, watch.start, watch.end], ['mux', 'clip1-pb', 0, null]);
  assert.match(watch.picture, /^https:\/\/image\.mux\.com\/clip1-pb\//, 'the picture comes from the clip: the full recording’s is gone');
  const logged = db.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'media.%' ORDER BY id").all().map((a) => [a.action, JSON.parse(a.detail)]);
  assert.deepEqual(logged.map((l) => l[0]), ['media.edit', 'media.clip.start', 'media.clip.ready', 'media.mux_asset_deleted']);
  assert.deepEqual([logged[3][1].asset, logged[3][1].kind, logged[3][1].why], ['recM', 'full', 'the cut copy is ready']);
  await muxTick(db);
  assert.deepEqual(mx.deleted, ['recM'], 'only once');
  // The full recording is gone, so the marks are locked; other edits still save.
  const locked = await api('admin', 'PATCH', `/media/${m}`, { start: '0:40:00' });
  assert.equal(locked.status, 400);
  assert.match(locked.data.error, /can’t change again/);
  assert.equal((await api('admin', 'PATCH', `/media/${m}`, { title: 'Standing Firm, part 1' })).status, 200);
  item = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.deepEqual([item.raw_deleted, item.mark_start, item.mark_end], [true, 2530, 4710]);
});

test('marks: a clip that fails keeps the original, shows it, and can be tried again', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const m = muxItem({ asset: 'recF', duration: 5400 });
  await api('staff', 'PATCH', `/media/${m}`, { start: '10:00', end: '1:10:00' });
  mx.clips.clip1 = 'errored';
  await muxTick(db);
  assert.deepEqual(mx.deleted, [], 'a failed clip never costs the original');
  assert.equal(row(m).clip_status, 'failed');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.clip.failed'").get().n, 1);
  let item = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.equal(item.clip_error, true);
  let watch = (await api(null, 'GET', `/watch/${m}`)).data;
  assert.deepEqual([watch.playback_id, watch.start, watch.end], ['recF-pb', 600, 4200], 'still plays the full recording between the marks');
  // Try again.
  assert.equal((await api('vol', 'POST', `/media/${m}/clip`, {})).status, 403);
  assert.equal((await api('staff', 'POST', `/media/${m}/clip`, {})).status, 200);
  assert.equal(mx.made.length, 2);
  mx.clips.clip2 = 'ready';
  await muxTick(db);
  assert.ok(mx.deleted.includes('recF') && mx.deleted.includes('clip1'), 'the failed clip is cleared, and the original goes only after the new clip is ready');
  item = (await api('staff', 'GET', `/media/${m}`)).data;
  assert.equal(item.clip_error, false);
  // A Mux outage while deleting the original leaves it flagged as not yet deleted, to try again.
  reset();
  const k = muxItem({ asset: 'recK', duration: 5400 });
  await api('staff', 'PATCH', `/media/${k}`, { start: '5:00' });
  mx.clips.clip3 = 'ready';
  mx.failDelete.add('recK');
  await muxTick(db);
  assert.equal(row(k).raw_deleted, 0);
  mx.failDelete.clear();
  await muxTick(db);
  assert.equal(row(k).raw_deleted, 1);
});

test('YouTube items play with start and end, and the marks validate', async () => {
  reset();
  const y = ytItem({ video: yid(800), duration: 5400 });
  assert.equal((await api('staff', 'PATCH', `/media/${y.id}`, { start: '0:42:10', end: '1:18:30' })).status, 200);
  const w = (await api(null, 'GET', `/watch/${y.id}`)).data;
  assert.deepEqual([w.source, w.video_id, w.start, w.end, w.length], ['youtube', yid(800), 2530, 4710, 2180]);
  const hub = (await api('staff', 'GET', `/media/${y.id}`)).data;
  assert.equal(hub.studio_url, `https://studio.youtube.com/video/${yid(800)}/editor`);
  assert.equal((await api('staff', 'PATCH', `/media/${y.id}`, { start: '1:20:00', end: '1:00:00' })).status, 400);
  assert.equal((await api('staff', 'PATCH', `/media/${y.id}`, { start: 'soon' })).status, 400);
  // Without a YouTube copy (a Mux recording on its own) there is no Studio link.
  const m = muxItem();
  assert.equal((await api('staff', 'GET', `/media/${m}`)).data.studio_url, '');
});

// ---------------------------------------------------------------- 3. keep services in Mux for N months
const NOW = Date.parse('2026-06-01T15:00:00Z'); // 12 months back is 2025-06-01
const OLD = '2025-03-02';
const RECENT = '2025-09-07';
const notices = () => db.prepare("SELECT n.title, n.body, u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.title = 'Mux storage summary'").all();

// An old, linked service on Mux (a clip made and the full recording both still there).
function oldService(o = {}) {
  const vid = o.video || yid(++seq);
  const id = muxItem({ asset: o.asset || `rec${seq}`, yt: o.noYt ? null : vid, day: o.day || OLD, at: `${o.day || OLD} 16:00:00`, title: o.title || 'Standing Firm', marks: o.marks === null ? null : [2530, 4710], status: o.status });
  if (o.clip) db.prepare("UPDATE media SET clip_asset_id = ?, clip_playback_id = ?, clip_start = 2530, clip_end = 4710, clip_status = 'ready', clip_ready_at = datetime('now') WHERE id = ?").run(o.clip, `${o.clip}-pb`, id);
  return { id, video: vid };
}

test('retention setting: off by default, 6, 12 or 24 months, admin only', async () => {
  reset();
  assert.equal((await api('admin', 'GET', '/media/setup')).data.settings.keep_mux_months, 0);
  const s = await api('staff', 'GET', '/media/setup');
  assert.deepEqual([s.data.keep_choices, s.data.archive.kept], [[6, 12, 24], []]);
  assert.equal((await api('staff', 'PUT', '/media/setup', { keep_mux_months: 12 })).status, 403);
  assert.equal((await api('north', 'PUT', '/media/setup', { keep_mux_months: 12 })).status, 403, 'a campus-limited admin can’t change a church-wide setting');
  for (const bad of [3, 13, -1, 'soon']) assert.equal((await api('admin', 'PUT', '/media/setup', { keep_mux_months: bad })).status, 400);
  const ok = await api('admin', 'PUT', '/media/setup', { keep_mux_months: 12 });
  assert.equal(ok.data.settings.keep_mux_months, 12);
  assert.equal(db.prepare("SELECT detail FROM audit_log WHERE action = 'media.setup'").get().detail.includes('"keep_mux_months":12'), true);
  assert.equal((await api('admin', 'PUT', '/media/setup', { notify_live: false })).data.settings.keep_mux_months, 12, 'saving other things leaves it');
  assert.equal((await api('admin', 'PUT', '/media/setup', { keep_mux_months: 0 })).data.settings.keep_mux_months, 0);
});

test('retention happy path: an old service with a confirmed YouTube copy moves to YouTube and its Mux assets are deleted', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { keep_mux_months: 12 });
  const a = oldService({ video: yid(100), asset: 'recOld', clip: 'clipOld', title: 'Standing Firm' });
  const fresh = oldService({ video: yid(101), asset: 'recNew', day: RECENT });
  const edge = oldService({ video: yid(102), asset: 'recEdge', day: '2025-06-01' }); // exactly 12 months: not older
  yt.videos = { [yid(100)]: { title: 'Sunday', secs: 5400, at: `${OLD}T16:00:00Z` }, [yid(101)]: { title: 'Sunday', secs: 5400, at: `${RECENT}T16:00:00Z` }, [yid(102)]: { title: 'Sunday', secs: 5400, at: '2025-06-01T16:00:00Z' } };
  const before = row(a.id);

  const out = await archiveOldMux(db, { now: NOW });
  assert.deepEqual([out.ran, out.moved, out.kept.length], [true, 1, 0]);
  const item = row(a.id);
  assert.deepEqual([item.source, item.video_id, item.title, item.day, item.start_sec, item.end_sec, item.mux_asset_id, item.playback_id, item.clip_asset_id, item.yt_video_id],
    ['youtube', yid(100), before.title, before.day, 2530, 4710, null, null, null, null]);
  assert.equal(item.thumbnail, `https://i.ytimg.com/vi/${yid(100)}/hqdefault.jpg`, 'the picture no longer points at Mux');
  assert.deepEqual(mx.deleted.sort(), ['clipOld', 'recOld']);
  // The item plays YouTube with the same marks.
  const w = (await api(null, 'GET', `/watch/${a.id}`)).data;
  assert.deepEqual([w.source, w.video_id, w.playback_id ?? null, w.start, w.end, w.title], ['youtube', yid(100), null, 2530, 4710, 'Standing Firm']);
  assert.equal((await api(null, 'GET', '/watch')).data.items.length, 3);
  // Newer ones are untouched.
  for (const x of [fresh, edge]) assert.equal(row(x.id).source, 'mux');
  // Audited: the hand-over and each Mux deletion.
  const log = db.prepare("SELECT action, detail FROM audit_log WHERE action IN ('media.mux_archive', 'media.mux_asset_deleted') ORDER BY id").all();
  assert.deepEqual(log.map((l) => l.action), ['media.mux_archive', 'media.mux_asset_deleted', 'media.mux_asset_deleted']);
  assert.deepEqual(JSON.parse(log[0].detail).assets.sort(), ['clipOld', 'recOld']);
  assert.deepEqual(log.slice(1).map((l) => JSON.parse(l.detail).asset).sort(), ['clipOld', 'recOld']);

  // Safe to run twice: nothing more to do, nothing deleted again.
  const second = await archiveOldMux(db, { now: NOW + 3600e3 });
  assert.equal(second.moved, 0);
  assert.equal(mx.deleted.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.mux_archive'").get().n, 1);
  // A month later the edge one is old enough.
  assert.equal((await archiveOldMux(db, { now: NOW + 40 * 86400e3 })).moved, 1);
  assert.equal(row(edge.id).source, 'youtube');
  // Admins who cover every campus got the summary (the first run, then again once a week had passed); staff and campus-limited admins did not.
  assert.deepEqual(notices().map((n) => n.email), ['admin@mb.org', 'admin@mb.org']);
  assert.match(notices()[0].body, /1 service moved to YouTube and cleared from Mux/);
});

test('retention: with no YouTube copy the Mux asset stays, and the admin notice says so', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { keep_mux_months: 12 });
  const none = oldService({ noYt: true, asset: 'recNone', title: 'No copy A' });
  const none2 = oldService({ noYt: true, asset: 'recNone2', title: 'No copy B', day: '2025-03-09' });
  const rehearsal = oldService({ noYt: true, asset: 'recRehearsal', title: 'Rehearsal', status: 'skipped', day: '2025-03-16' });
  const gone = oldService({ video: yid(200), asset: 'recGone', title: 'Copy deleted', day: '2025-03-23' });
  const priv = oldService({ video: yid(201), asset: 'recPriv', title: 'Copy private', day: '2025-03-30' });
  const processing = oldService({ video: yid(202), asset: 'recProc', title: 'Copy still processing', day: '2025-04-06' });
  const short = oldService({ video: yid(203), asset: 'recShort', title: 'Copy cut short', day: '2025-04-13' }); // YouTube copy ends before the message does
  yt.videos = {
    [yid(201)]: { title: 'x', secs: 5400, at: `${OLD}T16:00:00Z`, privacy: 'private' },
    [yid(202)]: { title: 'x', secs: 5400, at: `${OLD}T16:00:00Z`, upload: 'uploaded' },
    [yid(203)]: { title: 'x', secs: 3000, at: `${OLD}T16:00:00Z` },
  };
  const out = await archiveOldMux(db, { now: NOW });
  assert.equal(out.moved, 0);
  assert.deepEqual(mx.deleted, [], 'nothing is deleted without a confirmed copy');
  for (const x of [none, none2, rehearsal, gone, priv, processing, short]) assert.equal(row(x.id).source, 'mux');
  assert.deepEqual(out.kept.map((k) => k.title).sort(), ['Copy cut short', 'Copy deleted', 'Copy private', 'Copy still processing', 'No copy A', 'No copy B']);
  assert.equal(out.kept.find((k) => k.title === 'No copy A').reason, 'No YouTube copy is linked');
  assert.ok(!out.kept.some((k) => k.title === 'Rehearsal'), 'skipped recordings are not nagged about');
  // The admin notice, and the same list on Setup.
  assert.match(notices().find((n) => n.email === 'admin@mb.org').body, /6 services couldn’t move to YouTube/);
  assert.equal(notices().length, 1);
  const setup = (await api('staff', 'GET', '/media/setup')).data.archive;
  assert.equal(setup.kept.length, 6);
  assert.equal(setup.error, '');

  // Daily runs don't repeat the notice: once a week.
  await archiveOldMux(db, { now: NOW + 86400e3 });
  assert.equal(notices().length, 1);
  await archiveOldMux(db, { now: NOW + 8 * 86400e3 });
  assert.equal(notices().length, 2);
  assert.deepEqual(mx.deleted, []);
});

test('retention: a YouTube API error, a missing key or an odd answer deletes nothing, not even for the services that are fine', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { keep_mux_months: 6 });
  const fine = oldService({ video: yid(300), asset: 'recFine' });
  yt.videos = { [yid(300)]: { title: 'Sunday', secs: 5400, at: `${OLD}T16:00:00Z` } };

  yt.fail = 500;
  let out = await archiveOldMux(db, { now: NOW });
  assert.equal(out.moved, 0);
  assert.match(out.error, /YouTube answered 500/);
  assert.deepEqual(mx.deleted, []);
  assert.equal(row(fine.id).source, 'mux');
  assert.match((await api('staff', 'GET', '/media/setup')).data.archive.error, /YouTube answered 500/);
  yt.fail = 403; // quota
  out = await archiveOldMux(db, { now: NOW });
  assert.equal(out.moved, 0);
  assert.deepEqual(mx.deleted, []);

  // No key: the hub can't confirm anything.
  yt.fail = 0;
  delete process.env.YOUTUBE_API_KEY;
  out = await archiveOldMux(db, { now: NOW });
  assert.match(out.error, /API key/);
  assert.deepEqual(mx.deleted, []);
  process.env.YOUTUBE_API_KEY = 'yt-key';

  // The same data with YouTube answering: now it moves (so the earlier refusals were about the answer, not the data).
  out = await archiveOldMux(db, { now: NOW });
  assert.deepEqual([out.moved, out.error], [1, '']);
  assert.deepEqual(mx.deleted, ['recFine']);
});

test('retention: off deletes nothing and never asks YouTube or Mux', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  const a = oldService({ video: yid(400), asset: 'recOff', clip: 'clipOff' });
  yt.videos = { [yid(400)]: { title: 'Sunday', secs: 5400, at: `${OLD}T16:00:00Z` } };
  // Never set, and set to 0.
  assert.deepEqual(await archiveOldMux(db, { now: NOW }), { ran: false, why: 'off' });
  setSetting(db, 'media', { keep_mux_months: 0 });
  assert.equal((await archiveOldMux(db, { now: NOW })).ran, false);
  assert.deepEqual([mx.deleted, mx.calls, yt.asked], [[], [], 0]);
  assert.equal(row(a.id).source, 'mux');
  // An unknown value in the stored setting counts as off, too.
  setSetting(db, 'media', { keep_mux_months: 7 });
  assert.equal((await archiveOldMux(db, { now: NOW })).ran, false);
  assert.deepEqual(mx.deleted, []);
  // Without Mux set up there is nothing to delete.
  setSetting(db, 'media', { keep_mux_months: 12 });
  delete process.env.MUX_TOKEN_ID;
  assert.deepEqual(await archiveOldMux(db, { now: NOW }), { ran: false, why: 'mux' });
});

test('retention: a Mux deletion that fails is retried next time, and the item already plays YouTube', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { keep_mux_months: 12 });
  const a = oldService({ video: yid(500), asset: 'recRetry', clip: 'clipRetry' });
  yt.videos = { [yid(500)]: { title: 'Sunday', secs: 5400, at: `${OLD}T16:00:00Z` } };
  mx.failDelete.add('recRetry');
  const out = await archiveOldMux(db, { now: NOW });
  assert.equal(out.moved, 1);
  assert.equal(row(a.id).source, 'youtube', 'never left pointing at assets that may be gone');
  assert.deepEqual(mx.deleted, ['clipRetry']);
  assert.equal((await api('staff', 'GET', '/media/setup')).data.archive.pending, 1);
  mx.failDelete.clear();
  mx.gone.add('recRetry'); // Mux says 404: already gone, which is fine
  await archiveOldMux(db, { now: NOW + 86400e3 });
  assert.equal((await api('staff', 'GET', '/media/setup')).data.archive.pending, 0);
  assert.equal(getSetting(db, 'media_archive').pending.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.mux_asset_deleted'").get().n, 2);
});

test('retention: nothing moves while a clip or upload is still being made', async (t) => {
  reset();
  const mx = await muxStandIn(t);
  const yt = await youtubeStandIn(t);
  setSetting(db, 'media', { keep_mux_months: 12 });
  const a = oldService({ video: yid(600), asset: 'recBusy' });
  db.prepare("UPDATE media SET clip_status = 'making', clip_asset_id = 'clipBusy' WHERE id = ?").run(a.id);
  yt.videos = { [yid(600)]: { title: 'Sunday', secs: 5400, at: `${OLD}T16:00:00Z` } };
  assert.equal((await archiveOldMux(db, { now: NOW })).moved, 0);
  assert.deepEqual(mx.deleted, []);
  db.prepare("UPDATE media SET clip_status = 'failed' WHERE id = ?").run(a.id);
  assert.equal((await archiveOldMux(db, { now: NOW })).moved, 1, 'a failed clip no longer holds it back (the full recording is deleted with the rest)');
  assert.ok(mx.deleted.includes('recBusy') && mx.deleted.includes('clipBusy'));
});

test('the migration: columns and index are in place', () => {
  const cols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  for (const c of ['yt_video_id', 'yt_snapshot', 'linked_by']) assert.ok(cols.includes(c), c);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'media_yt_video'").get());
});
