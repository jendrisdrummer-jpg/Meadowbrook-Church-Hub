// The service worker's push handling, run against a stand-in browser environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
  const handlers = {};
  const shown = [];
  const fetches = [];
  const opened = [];
  const self = {
    location: { origin: 'https://hub.example' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    clients: { matchAll: async () => [], openWindow: async (url) => { opened.push(url); } },
    skipWaiting: () => {},
  };
  const fetch = async (url, opts) => { fetches.push({ url, ...opts }); return { ok: true }; };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, fetch, caches: {}, URL, JSON, location: self.location });
  const fire = async (type, event) => {
    let done;
    handlers[type]({ ...event, waitUntil: (p) => { done = p; } });
    await done;
  };
  return { fire, shown, fetches, opened };
}

test('a push shows a notification with its actions', async () => {
  const sw = load();
  const msg = { id: 7, title: 'You’re scheduled: Greeter', body: 'Sun at 9:00', url: '/#/my', tag: 'assignment-3', actions: [{ action: 'accept', title: 'Accept' }], data: { assignment_ids: [3] } };
  await sw.fire('push', { data: { json: () => msg } });
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, msg.title);
  assert.equal(sw.shown[0].actions.length, 1);
  assert.deepEqual(sw.shown[0].data.assignment_ids, [3]);
});

test('Accept on a notification accepts without opening the app; Decline opens it', async () => {
  const sw = load();
  const notification = (data) => ({ data, tag: 't', close: () => {} });
  await sw.fire('notificationclick', { action: 'accept', notification: notification({ id: 7, url: '/#/my', assignment_ids: [3] }) });
  const patchCall = sw.fetches.find((f) => f.method === 'PATCH');
  assert.equal(patchCall.url, '/api/assignments/3');
  assert.equal(patchCall.headers['x-mb'], '1');
  assert.equal(JSON.parse(patchCall.body).status, 'accepted');
  assert.ok(sw.fetches.some((f) => f.url === '/api/notifications/read'));
  assert.equal(sw.shown[0].title, 'Thanks for serving!');
  assert.equal(sw.opened.length, 0);

  await sw.fire('notificationclick', { action: 'decline', notification: notification({ url: '/#/my', assignment_ids: [3] }) });
  assert.equal(sw.opened.at(-1), 'https://hub.example/#/my?decline=3');
  await sw.fire('notificationclick', { action: '', notification: notification({ url: '/#/services/9' }) });
  assert.equal(sw.opened.at(-1), 'https://hub.example/#/services/9');
});
