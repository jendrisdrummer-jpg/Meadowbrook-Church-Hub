import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../server/db.js';
import { userForEmail } from '../server/auth.js';
import { roomFor, ageMonths, securityCode } from '../public/js/checkin-rules.js';
import { parseDate } from '../server/routes/people.js';
import { parseCsv } from '../server/csv.js';

test('a stranger cannot claim a new install; the church domain can', () => {
  const db = openDb(':memory:');
  setSetting(db, 'workspace_domain', 'meadowbrook.church');
  assert.equal(userForEmail(db, 'someone@gmail.com'), null);
  assert.equal(userForEmail(db, 'pastor@meadowbrook.church').role, 'admin');
  assert.equal(userForEmail(db, 'helper@meadowbrook.church').role, 'volunteer');
  assert.equal(userForEmail(db, 'other@gmail.com'), null);
});

test('rooms by grade first, then age', () => {
  const rooms = [
    { id: 1, min_age_months: 0, max_age_months: 23 },
    { id: 2, min_age_months: 24, max_age_months: 71 },
    { id: 3, min_grade: 0, max_grade: 2, min_age_months: 72, max_age_months: 95 },
  ];
  assert.equal(ageMonths('2024-03-15', '2026-03-14'), 23);
  assert.equal(roomFor({ birthdate: '2024-03-15' }, rooms, '2026-03-14').id, 1);
  assert.equal(roomFor({ birthdate: '2024-03-15' }, rooms, '2026-03-15').id, 2);
  assert.equal(roomFor({ birthdate: '2021-01-01', grade: 0 }, rooms, '2026-10-01').id, 3);
  assert.equal(roomFor({ birthdate: null }, rooms, '2026-10-01'), null);
  assert.match(securityCode(), /^[346789ABCDEFGHJKMNPQRTUVWXY]{4}$/);
});

test('import helpers', () => {
  assert.equal(parseDate('3/9/2014'), '2014-03-09');
  assert.equal(parseDate('2014-3-9'), '2014-03-09');
  assert.equal(parseDate('13/45/2014'), null);
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
});
