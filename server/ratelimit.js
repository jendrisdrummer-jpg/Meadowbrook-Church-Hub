// Shared in-memory rate limits for public and sign-in routes.
//
// - IPv6 addresses count per /64: one home or Wi-Fi network usually has a whole /64, so counting
//   single addresses would let one connection try billions of times.
// - Public routes also count per IPv6 /48, more loosely, so someone with a /48 (65,536 /64s)
//   can't simply spread out.
// - IPv4 counts per address, since a church's Wi-Fi shares one.
// - Stale entries are swept and, if flooded, the oldest go first. The table is never wiped all at
//   once, so a flood of addresses can't reset everyone's limits.

import net from 'node:net';

// IPv6 addresses are bucketed by /64, v4-mapped ones as IPv4. Anything that isn't a valid IP
// (a malformed header, say) gets its own bucket from the raw text, capped at 64 characters, so it
// can't share a bucket with a real address such as ::1.
export function ipBucket(ip = '') {
  const s = String(ip ?? '').replace(/%.*$/, '');
  if (net.isIPv4(s)) return s;
  const g = net.isIPv6(s) ? v6Groups(s) : null;
  if (!g) return `raw:${String(ip ?? '').slice(0, 64)}`;
  if (isMapped(g)) return mappedV4(g);
  return `v6:${g.slice(0, 4).join(':')}`;
}

// The wider IPv6 /48 bucket, or null for anything that isn't IPv6 (IPv4, v4-mapped, invalid).
export function ipWide(ip = '') {
  const s = String(ip ?? '').replace(/%.*$/, '');
  const g = net.isIPv6(s) ? v6Groups(s) : null;
  return g && !isMapped(g) ? `v6w:${g.slice(0, 3).join(':')}` : null;
}

const isMapped = (g) => g.slice(0, 5).every((x) => x === '0') && g[5] === 'ffff';
const mappedV4 = (g) => [g[6], g[7]].flatMap((x) => { const n = parseInt(x, 16); return [n >> 8, n & 255]; }).join('.');

// The eight groups of a valid IPv6 address, normalised (no leading zeros).
function v6Groups(ip) {
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two groups.
  ip = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_m, a, b, c, d) => `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`);
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 8).map((x) => (parseInt(x || '0', 16) || 0).toString(16));
}

export function createLimiter({ cap = 10000 } = {}) {
  const entries = new Map(); // key -> { hits: [t], windowMs, max }
  let swept = 0;
  const live = (e, now) => e.hits.filter((t) => now - t < e.windowMs);
  const sweep = (now) => {
    if (entries.size <= cap && now - swept < 60e3) return;
    swept = now;
    for (const [k, e] of entries) if (!live(e, now).length) entries.delete(k);
    // Still flooded: drop the least recently used down to 90%, so the next requests don't sweep
    // again. Entries sitting at their limit (a locked-out key) go last, only if nothing else is left.
    const atLimit = (e) => live(e, now).length >= e.max;
    for (const pass of [false, true]) {
      for (const [k, e] of entries) {
        if (entries.size <= cap * 0.9) return;
        if (pass || !atLimit(e)) entries.delete(k);
      }
    }
  };
  const stamp = (key, max, windowMs) => {
    const now = Date.now();
    sweep(now);
    const e = entries.get(key) || { hits: [], windowMs, max };
    e.hits = e.hits.filter((t) => now - t < windowMs);
    e.windowMs = windowMs;
    e.max = max;
    entries.delete(key); // re-insert: the map stays in least-recently-used order for eviction
    return { e, now };
  };
  return {
    // Records a hit and says whether it's allowed (false once `max` hits are in the window).
    hit(key, max, windowMs) {
      const { e, now } = stamp(key, max, windowMs);
      if (e.hits.length >= max) { entries.set(key, e); return false; }
      e.hits.push(now);
      entries.set(key, e);
      return true;
    },
    // Says whether a hit would be allowed, without recording anything or creating a key.
    allowed(key, max, windowMs) {
      const e = entries.get(key);
      if (!e) return max > 0;
      const now = Date.now();
      return e.hits.filter((t) => now - t < windowMs).length < max;
    },
    // Records a hit without checking (pair with allowed()).
    record(key, max, windowMs) {
      const { e, now } = stamp(key, max, windowMs);
      e.hits.push(now);
      entries.set(key, e);
    },
    get size() { return entries.size; },
  };
}

// Per client: the address (or IPv6 /64), and for IPv6 also its /48 at `wide` times the limit.
// Checks both first and records both only if both pass, so a refused client creates no new keys
// and one bucket's refusal doesn't burn the other's allowance.
export function ipAllowed(limiter, prefix, ip, max, windowMs, { wide = 4 } = {}) {
  const k = `${prefix}:${ipBucket(ip)}`;
  const w = ipWide(ip);
  const wk = w && `${prefix}:${w}`;
  if (!limiter.allowed(k, max, windowMs)) return false;
  if (wk && !limiter.allowed(wk, max * wide, windowMs)) return false;
  limiter.record(k, max, windowMs);
  if (wk) limiter.record(wk, max * wide, windowMs);
  return true;
}
