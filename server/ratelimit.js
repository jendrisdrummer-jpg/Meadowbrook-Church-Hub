// Shared in-memory rate limits for public and sign-in routes.
//
// - IPv6 addresses count per /64: one home or Wi-Fi network usually has a whole /64, so counting
//   single addresses would let one connection try billions of times.
// - Public routes also count per IPv6 /48, more loosely, so someone with a /48 (65,536 /64s)
//   can't simply spread out.
// - IPv4 counts per address, since a church's Wi-Fi shares one.
// - Stale entries are swept and, if flooded, the oldest go first. The table is never wiped all at
//   once, so a flood of addresses can't reset everyone's limits.

// IPv6 addresses are bucketed by /64, v4-mapped ones as IPv4.
export function ipBucket(ip = '') {
  const g = v6Groups(ip);
  if (!g) return v4(ip);
  return `v6:${g.slice(0, 4).join(':')}`;
}

// The wider IPv6 /48 bucket, or null for IPv4.
export function ipWide(ip = '') {
  const g = v6Groups(ip);
  return g ? `v6w:${g.slice(0, 3).join(':')}` : null;
}

function v4(ip) {
  ip = String(ip).replace(/%.*$/, '');
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

// The eight groups of an IPv6 address, normalised (no leading zeros), or null if it isn't IPv6.
function v6Groups(ip) {
  ip = String(ip).replace(/%.*$/, '');
  if (!ip.includes(':') || /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) return null;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 8).map((x) => (parseInt(x || '0', 16) || 0).toString(16));
}

export function createLimiter({ cap = 10000 } = {}) {
  const entries = new Map(); // key -> { hits: [t], windowMs }
  let swept = 0;
  const sweep = (now) => {
    if (entries.size <= cap && now - swept < 60e3) return;
    swept = now;
    for (const [k, e] of entries) if (!e.hits.some((t) => now - t < e.windowMs)) entries.delete(k);
    // Still flooded: drop the least recently used down to 90%, so the next requests don't sweep again.
    for (const k of entries.keys()) { if (entries.size <= cap * 0.9) break; entries.delete(k); }
  };
  return {
    // Records a hit and says whether it's allowed (false once `max` hits are in the window).
    hit(key, max, windowMs) {
      const now = Date.now();
      sweep(now);
      const e = entries.get(key) || { hits: [], windowMs };
      e.hits = e.hits.filter((t) => now - t < windowMs);
      e.windowMs = windowMs;
      entries.delete(key); // re-insert: the map stays in least-recently-used order for eviction
      if (e.hits.length >= max) { entries.set(key, e); return false; }
      e.hits.push(now);
      entries.set(key, e);
      return true;
    },
    get size() { return entries.size; },
  };
}

// Per client: the address (or IPv6 /64), and for IPv6 also its /48 at `wide` times the limit.
export function ipAllowed(limiter, prefix, ip, max, windowMs, { wide = 4 } = {}) {
  if (!limiter.hit(`${prefix}:${ipBucket(ip)}`, max, windowMs)) return false;
  const w = ipWide(ip);
  return !w || limiter.hit(`${prefix}:${w}`, max * wide, windowMs);
}
