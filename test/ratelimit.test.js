// Shared rate limits: IPv6 counted per /64 and /48, and a flood of addresses can't reset limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipBucket, ipWide, createLimiter, ipAllowed } from '../server/ratelimit.js';

test('IPv6 addresses share a bucket per /64, and a wider one per /48', () => {
  assert.equal(ipBucket('2001:db8:1:2::1'), ipBucket('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff'));
  assert.notEqual(ipBucket('2001:db8:1:2::1'), ipBucket('2001:db8:1:3::1'));
  assert.equal(ipWide('2001:db8:1:2::1'), ipWide('2001:db8:1:ffff::9'));
  assert.notEqual(ipWide('2001:db8:1::1'), ipWide('2001:db8:2::1'));
  assert.equal(ipBucket('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(ipBucket('203.0.113.5'), '203.0.113.5');
  assert.equal(ipWide('203.0.113.5'), null);
  assert.equal(ipWide('::ffff:203.0.113.5'), null);
  assert.equal(ipBucket('fe80::1%eth0'), ipBucket('fe80::2'));
});

test('one connection can’t dodge a limit by changing addresses inside its /64 or /48', () => {
  const l = createLimiter();
  // Same /64: five tries, then refused, whatever the last 64 bits are.
  for (let i = 0; i < 5; i++) assert.ok(ipAllowed(l, 'card', `2001:db8:a:1::${i + 1}`, 5, 60e3));
  assert.equal(ipAllowed(l, 'card', '2001:db8:a:1::abcd', 5, 60e3), false);
  // Spread over many /64s in one /48: the /48 tier (4×) stops it.
  let ok = 0;
  for (let i = 2; i < 40; i++) if (ipAllowed(l, 'card', `2001:db8:a:${i.toString(16)}::1`, 5, 60e3)) ok++;
  assert.equal(ok, 15, 'the /48 allowed 20 in total (5 already used)');
  // Someone else's network is unaffected; IPv4 counts per address.
  assert.ok(ipAllowed(l, 'card', '2001:db8:b:1::1', 5, 60e3));
  assert.ok(ipAllowed(l, 'card', '203.0.113.9', 5, 60e3));
});

test('a flood of new addresses doesn’t reset a busy client’s limit', () => {
  const l = createLimiter({ cap: 100 });
  for (let i = 0; i < 3; i++) assert.ok(l.hit('busy', 3, 60e3));
  for (let i = 0; i < 500; i++) { l.hit(`flood${i}`, 3, 60e3); if (i % 20 === 0) l.hit('busy', 3, 60e3); }
  assert.equal(l.hit('busy', 3, 60e3), false, 'still limited');
  assert.ok(l.size <= 100, 'memory stays bounded');
});
