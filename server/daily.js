// Daily (daily.co) video calls: the few REST calls we need. The API key comes from
// MB_DAILY_API_KEY (Render → Environment); MB_DAILY_API_URL is only for tests.
const base = () => (process.env.MB_DAILY_API_URL || 'https://api.daily.co/v1').replace(/\/+$/, '');
export const dailyConfigured = () => Boolean((process.env.MB_DAILY_API_KEY || '').trim());

async function call(method, path, body) {
  const res = await fetch(base() + path, {
    method,
    headers: { authorization: `Bearer ${process.env.MB_DAILY_API_KEY.trim()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15e3),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    const err = new Error(`Video service error (${res.status}): ${data.info || data.error || 'unknown'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// A private room (only people we give a token can join) that closes itself at `exp`.
export const createRoom = (name, exp, maxParticipants) => call('POST', '/rooms', {
  name,
  privacy: 'private',
  properties: { exp, eject_at_room_exp: true, max_participants: maxParticipants, enable_prejoin_ui: true, enable_screenshare: true, enable_chat: true },
});
export const deleteRoom = (name) => call('DELETE', `/rooms/${encodeURIComponent(name)}`);
export const presence = (name) => call('GET', `/rooms/${encodeURIComponent(name)}/presence`);
export const meetingToken = (props) => call('POST', '/meeting-tokens', { properties: props }).then((d) => d.token);

// Participant-minutes used since `since` (unix seconds), from Daily's own records of every
// meeting, counting people still in a call up to now.
export async function minutesSince(since) {
  let total = 0;
  let after = '';
  for (let page = 0; page < 50; page++) {
    const d = await call('GET', `/meetings?timeframe_start=${since}&limit=100${after ? `&starting_after=${after}` : ''}`);
    const list = d.data || [];
    const now = Date.now() / 1000;
    for (const m of list) {
      for (const p of m.participants || []) {
        const secs = p.duration ?? (m.ongoing && p.join_time ? now - p.join_time : 0);
        total += Math.max(0, secs) / 60;
      }
    }
    if (list.length < 100) break;
    after = list.at(-1).id;
  }
  return Math.ceil(total);
}
