// Customise Home: how a saved layout is applied to the cards a person can see. No server, no dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, isStandard, DEFAULT_ORDER } from '../public/js/home-layout.js';
import { HOME_CARDS } from '../server/routes/me.js';

const ids = (cards) => cards.map((c) => c.id);

test('the front end and the server know the same cards', () => {
  assert.deepEqual(DEFAULT_ORDER, HOME_CARDS);
});

test('no saved layout is the standard Home', () => {
  const a = arrange(DEFAULT_ORDER, null);
  assert.deepEqual(ids(a), DEFAULT_ORDER);
  assert.ok(isStandard(a, DEFAULT_ORDER));
});

test('order and hidden are applied; ids the role can’t see are ignored', () => {
  const leaderCards = ['attention', 'services', 'serving', 'away'];
  const a = arrange(leaderCards, { order: ['totals', 'away', 'attendance', 'attention'], hidden: ['attendance', 'serving'] });
  assert.deepEqual(ids(a), ['away', 'attention', 'services', 'serving']);
  assert.deepEqual(a.filter((c) => c.hidden).map((c) => c.id), ['serving']);
  assert.ok(!isStandard(a, leaderCards));
});

test('a card missing from the saved order lands in its default place', () => {
  assert.deepEqual(ids(arrange(DEFAULT_ORDER, { order: ['away', 'services', 'attention'], hidden: [] })), ['away', 'totals', 'services', 'serving', 'attendance', 'attention']);
  // Its default neighbour was moved: it follows that neighbour.
  assert.deepEqual(ids(arrange(DEFAULT_ORDER, { order: ['services', 'attention', 'serving', 'attendance', 'totals'], hidden: [] })), ['services', 'attention', 'serving', 'attendance', 'away', 'totals']);
  // With nothing before it in the saved order, a new first card goes to the top.
  assert.equal(ids(arrange(DEFAULT_ORDER, { order: ['services', 'serving'], hidden: [] }))[0], 'attention');
});

test('hidden names only what it lists: new cards stay visible', () => {
  const a = arrange(DEFAULT_ORDER, { order: ['attention'], hidden: ['away'] });
  assert.deepEqual(a.filter((c) => c.hidden).map((c) => c.id), ['away']);
});

test('duplicates in a saved order are shown once', () => {
  assert.deepEqual(ids(arrange(['attention', 'services'], { order: ['services', 'services', 'attention'], hidden: [] })), ['services', 'attention']);
});
