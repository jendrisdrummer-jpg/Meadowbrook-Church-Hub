import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingForHour } from '../public/js/greeting.js';

test('greeting follows the hour on the device clock', () => {
  const expected = { 0: 'Good evening', 4: 'Good evening', 5: 'Good morning', 11: 'Good morning', 12: 'Good afternoon', 16: 'Good afternoon', 17: 'Good evening', 23: 'Good evening' };
  for (const [hour, text] of Object.entries(expected)) assert.equal(greetingForHour(Number(hour)), text, `hour ${hour}`);
});
