// Protected history, serving records (child-safety V1, PR 3): the database refuses to delete past accepted
// assignments, past services that have records, positions people served in, and people with history, even
// through a cascade; every route that used to delete those now says no in plain words; merge keeps past
// serving on the archived duplicate. Dates are fixed (2020 is past, 2099 is future); the one "within 14 hours"
// check is relative to the database's own clock on purpose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, PAST, PAST2, FUTURE } from './helpers/history-app.js';
import { isHistoryError, MSG } from '../server/history.js';

let app, db, call, ids;
const P = {};
const count = (table, where = '1') => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get().n;
const refused = (sql, ...args) => {
  try { db.prepare(sql).run(...args); } catch (e) { return e; }
  return null;
};

before(async () => {
  app = await makeApp();
  ({ db, call, ids } = app);
  app.make('admin', 'admin');
  app.make('staff', 'staff');
  app.make('leader', 'leader');
  P.team = app.add.team('Band');
  P.guitar = app.add.position(P.team, 'Guitar');
  P.drums = app.add.position(P.team, 'Drums');
  P.unused = app.add.position(P.team, 'Unused');
  P.ann = app.add.person('Ann', 'Adams');
  P.bob = app.add.person('Bob', 'Brown');
  P.cat = app.add.person('Cat', 'Clark');
});
after(() => app.close());

test('the database: past accepted serving can’t be deleted; future, pending and declined can', () => {
  const past = app.add.service(PAST);
  const future = app.add.service(FUTURE);
  const a = app.add.assignment(past, P.guitar, P.ann, 'accepted');
  const f = app.add.assignment(future, P.guitar, P.ann, 'accepted');
  const pend = app.add.assignment(past, P.drums, P.ann, 'pending', false);
  const dec = app.add.assignment(past, P.unused, P.ann, 'declined');
  const e = refused('DELETE FROM assignments WHERE id = ?', a);
  assert.ok(e && isHistoryError(e), e?.message);
  assert.equal(e.message, MSG.assignment);
  assert.equal(count('assignments', `id = ${a}`), 1);
  for (const id of [f, pend, dec]) assert.equal(db.prepare('DELETE FROM assignments WHERE id = ?').run(id).changes, 1);
  db.prepare('DELETE FROM services WHERE id = ?').run(future);
  assert.equal(refused('DELETE FROM services WHERE id = ?', past)?.message, MSG.service);
  // Declining or un-accepting it first doesn't open a way round (it would be the same as deleting it).
  assert.equal(refused("UPDATE assignments SET status = 'declined' WHERE id = ?", a)?.message, MSG.restatus);
  assert.equal(count('assignments', `id = ${a} AND status = 'accepted'`), 1);

});

test('the database: a past service with records is kept, whatever the record is', () => {
  const kinds = {
    accepted: (s) => app.add.assignment(s, P.guitar, P.ann, 'accepted'),
    'asked, not answered': (s) => app.add.assignment(s, P.guitar, P.ann, 'pending', true),
    roll: (s) => db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(s, P.ann),
    headcount: (s) => db.prepare("INSERT INTO headcounts (service_id, area, count) VALUES (?, 'Main', 40)").run(s),
    'check-in': (s) => app.add.checkin(`ci-svc-${s}`, P.ann, { service: s }),
  };
  for (const [name, add] of Object.entries(kinds)) {
    const s = app.add.service(PAST2);
    add(s);
    assert.equal(refused('DELETE FROM services WHERE id = ?', s)?.message, MSG.service, name);
    assert.equal(count('services', `id = ${s}`), 1, name);
  }
  // Not past, or nothing recorded: deletable. A draft (never sent, not accepted) doesn't count as a record.
  const draft = app.add.service(PAST2);
  app.add.assignment(draft, P.guitar, P.bob, 'pending', false);
  assert.equal(db.prepare('DELETE FROM services WHERE id = ?').run(draft).changes, 1);
  assert.equal(count('assignments', `service_id = ${draft}`), 0, 'its draft went with it');
  const future = app.add.service(FUTURE);
  app.add.assignment(future, P.guitar, P.bob, 'accepted');
  assert.equal(db.prepare('DELETE FROM services WHERE id = ?').run(future).changes, 1);
});

test('the database: positions, people, teams and campuses with history are kept, through cascades, all or nothing', () => {
  const s = app.add.service(PAST);
  const camp = app.add.team('Camp team', 2);
  const campPos = app.add.position(camp, 'Door');
  const campService = app.add.service(PAST, 2);
  app.add.assignment(campService, campPos, P.cat, 'accepted');
  const before = ['assignments', 'positions', 'teams', 'people', 'campuses', 'services'].map((t) => count(t));
  assert.equal(refused('DELETE FROM positions WHERE id = ?', campPos)?.message, MSG.position);
  assert.equal(refused('DELETE FROM teams WHERE id = ?', camp)?.message, MSG.position, 'a team through its positions');
  assert.equal(refused('DELETE FROM people WHERE id = ?', P.cat)?.message, MSG.person);
  const c = refused('DELETE FROM campuses WHERE id = 2');
  assert.ok(c && isHistoryError(c), 'a campus through its services and positions');
  assert.deepEqual(['assignments', 'positions', 'teams', 'people', 'campuses', 'services'].map((t) => count(t)), before, 'nothing was half-deleted');
  // A person with only a roll-call mark or only a check-in is kept too.
  db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(s, P.bob);
  assert.equal(refused('DELETE FROM people WHERE id = ?', P.bob)?.message, MSG.person);
  const kid = app.add.person('Kid', 'Kerr', app.add.household('Kerr'), 'child');
  app.add.checkin('ci-kid-0001', kid);
  assert.equal(refused('DELETE FROM people WHERE id = ?', kid)?.message, MSG.person);
  assert.equal(refused('DELETE FROM households WHERE id = (SELECT household_id FROM people WHERE id = ?)', kid), null, 'a family can go; its child stays, with the check-in');
  assert.equal(count('checkins', "id = 'ci-kid-0001'"), 1);
  // Unused things still delete.
  const loner = app.add.person('Lone', 'Ly');
  assert.equal(db.prepare('DELETE FROM people WHERE id = ?').run(loner).changes, 1);
  assert.equal(db.prepare('DELETE FROM positions WHERE id = ?').run(app.add.position(P.team, 'Spare')).changes, 1);
  // An account can be deleted (sent_by is cleared, nothing is cascaded).
  const user = app.make('temp', 'staff');
  db.prepare('UPDATE assignments SET sent_by = ? WHERE service_id = ?').run(user, campService);
  assert.equal(db.prepare('DELETE FROM users WHERE id = ?').run(user).changes, 1);
  assert.equal(count('assignments', `service_id = ${campService} AND sent_by IS NULL`), 1);
});

test('the safety net: a database refusal that reaches the error handler is a plain 409, never a 500', () => {
  for (const [name, text] of Object.entries(MSG)) assert.ok(isHistoryError({ code: 'ERR_SQLITE_ERROR', message: text }), name);
  assert.equal(isHistoryError({ code: 'ERR_SQLITE_ERROR', message: 'UNIQUE constraint failed' }), false);
  assert.equal(isHistoryError(new Error(MSG.service)), false);
});

test('DELETE /services/:id: a past service with records says it is kept; others still delete', async () => {
  const kept = app.add.service(PAST);
  app.add.assignment(kept, P.guitar, P.ann, 'accepted');
  const detail = await call('staff', 'GET', `/services/${kept}`);
  assert.equal(detail.data.kept, true);
  for (const who of ['staff', 'admin']) {
    const r = await call(who, 'DELETE', `/services/${kept}`);
    assert.equal(r.status, 409);
    assert.equal(r.data.error, MSG.service);
  }
  assert.equal(count('services', `id = ${kept}`), 1);
  assert.equal(count('service_skips'), 0, 'a refused delete leaves no skipped day behind');
  assert.equal((await call('leader', 'DELETE', `/services/${kept}`)).status, 403);
  const empty = app.add.service(PAST2);
  assert.equal((await call('staff', 'GET', `/services/${empty}`)).data.kept, false);
  assert.equal((await call('staff', 'DELETE', `/services/${empty}`)).status, 200);
  const future = app.add.service(FUTURE);
  app.add.assignment(future, P.guitar, P.ann, 'accepted');
  assert.equal((await call('staff', 'DELETE', `/services/${future}`)).status, 200, 'an upcoming service still deletes, with its schedule');
  assert.equal(count('assignments', `service_id = ${future}`), 0);
});

test('within 14 hours of now counts as past (so no time zone can slip through)', async () => {
  const soon = new Date(Date.now() + 3600e3).toISOString().slice(0, 16);
  const later = new Date(Date.now() + 20 * 3600e3).toISOString().slice(0, 16);
  const a = app.add.service(soon);
  app.add.assignment(a, P.guitar, P.bob, 'accepted');
  assert.equal((await call('staff', 'DELETE', `/services/${a}`)).status, 409);
  const b = app.add.service(later);
  app.add.assignment(b, P.guitar, P.bob, 'accepted');
  assert.equal((await call('staff', 'DELETE', `/services/${b}`)).status, 200);
});

test('DELETE /assignments/:id: past accepted serving is kept; drafts, declines and upcoming still go', async () => {
  const past = app.add.service(PAST);
  const future = app.add.service(FUTURE);
  const served = app.add.assignment(past, P.drums, P.bob, 'accepted');
  const draft = app.add.assignment(past, P.guitar, P.bob, 'pending', false);
  const upcoming = app.add.assignment(future, P.drums, P.bob, 'accepted');
  const r = await call('staff', 'DELETE', `/assignments/${served}`);
  assert.equal(r.status, 409);
  assert.equal(r.data.error, MSG.assignment);
  assert.equal(count('assignments', `id = ${served}`), 1);
  assert.equal((await call('staff', 'DELETE', `/assignments/${draft}`)).status, 200);
  assert.equal((await call('staff', 'DELETE', `/assignments/${upcoming}`)).status, 200);
  assert.equal((await call('leader', 'DELETE', `/assignments/${served}`)).status, 403, 'guards unchanged');
});

test('DELETE /positions/:id: a position people served in is kept (rename it instead); unused ones delete', async () => {
  const r = await call('admin', 'DELETE', `/positions/${P.guitar}`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /kept in the record/);
  assert.match(r.data.error, /rename/);
  const forced = await call('admin', 'DELETE', `/positions/${P.guitar}`, { force: true });
  assert.equal(forced.status, 409, 'force doesn’t get around it');
  assert.equal(count('positions', `id = ${P.guitar}`), 1);
  assert.equal((await call('admin', 'PATCH', `/positions/${P.guitar}`, { name: 'Lead guitar' })).status, 200);
  assert.equal((await call('admin', 'DELETE', `/positions/${P.unused}`)).status, 200, 'nobody served in it');
  assert.equal((await call('leader', 'DELETE', `/positions/${P.drums}`)).status, 403, 'guards unchanged');
});

const makeSeries = (name = 'Sunday') => Number(db.prepare(`INSERT INTO service_types (campus_id, name, day_of_week, start_time, every_weeks, starts_on, ends_on)
  VALUES (1, ?, 0, '09:00', 1, '2020-01-05', '2099-12-31')`).run(name).lastInsertRowid);
const inSeries = (type, startsAt) => {
  const id = app.add.service(startsAt);
  db.prepare('UPDATE services SET service_type_id = ? WHERE id = ?').run(type, id);
  return id;
};

test('series: stopping from a past date only removes upcoming services, and never one kept for the record', async () => {
  const t = makeSeries();
  const past = inSeries(t, '2020-06-07T09:00');
  app.add.assignment(past, P.drums, P.ann, 'accepted');
  const soon = inSeries(t, new Date(Date.now() + 3600e3).toISOString().slice(0, 16));
  app.add.assignment(soon, P.drums, P.ann, 'accepted');
  const f1 = inSeries(t, '2099-06-07T09:00');
  const f2 = inSeries(t, '2099-06-14T09:00');
  app.add.assignment(f2, P.drums, P.ann, 'accepted');
  const r = await call('staff', 'DELETE', `/series/${t}?from=2020-01-01`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.removed, r.data.kept], [2, 1]);
  assert.deepEqual(db.prepare('SELECT id FROM services WHERE service_type_id = ? ORDER BY id').all(t).map((x) => x.id), [past, soon]);
  assert.equal(count('assignments', `service_id = ${past}`), 1, 'past serving untouched');
  assert.equal(count('services', `id IN (${f1}, ${f2})`), 0);
  assert.equal((await call('leader', 'DELETE', `/series/${t}?from=2099-01-01`)).status, 403, 'guards unchanged');
});

test('series: ending it on a past date leaves the past services and their records alone', async () => {
  const t = makeSeries('Ends');
  const past = inSeries(t, '2020-09-06T09:00');
  app.add.assignment(past, P.drums, P.bob, 'accepted');
  const plain = inSeries(t, '2020-09-13T09:00');
  const future = inSeries(t, '2099-09-06T09:00');
  const r = await call('staff', 'PATCH', `/series/${t}`, { ends_on: '2020-08-30' });
  assert.equal(r.status, 200, 'no database error reaches the screen');
  assert.equal(count('services', `id IN (${past}, ${plain})`), 2, 'dates before today are never deleted by a series edit');
  assert.equal(count('services', `id = ${future}`), 0, 'upcoming ones after the new end date go, as before');
});

test('merge: past serving stays on the archived duplicate; the rest moves or goes, as before', async () => {
  const keep = app.add.person('Kay', 'Keep');
  const dup = app.add.person('Kay', 'Keepe');
  const hh = app.add.household('Keeps');
  db.prepare('UPDATE people SET household_id = ?, household_role = ? WHERE id = ?').run(hh, 'child', dup);
  const past = app.add.service(PAST);
  const past2 = app.add.service(PAST2);
  const future = app.add.service(FUTURE);
  // Both served as Guitar at `past` and at `future`; only the dup served at past2.
  app.add.assignment(past, P.guitar, keep, 'accepted');
  const dupPast = app.add.assignment(past, P.guitar, dup, 'accepted');
  app.add.assignment(future, P.guitar, keep, 'accepted');
  const dupFuture = app.add.assignment(future, P.guitar, dup, 'accepted');
  const dupMoved = app.add.assignment(past2, P.guitar, dup, 'accepted');
  app.add.checkin('ci-dup-0001', dup, { service: past });
  db.prepare('INSERT INTO attendance (service_id, person_id) VALUES (?, ?)').run(past, dup);
  const r = await call('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.prepare('SELECT person_id FROM assignments WHERE id = ?').get(dupMoved).person_id, keep, 'what could move, moved');
  assert.equal(db.prepare('SELECT person_id FROM assignments WHERE id = ?').get(dupPast)?.person_id, dup, 'past serving the kept person already had stays on the duplicate');
  assert.equal(db.prepare('SELECT 1 FROM assignments WHERE id = ?').get(dupFuture), undefined, 'an upcoming duplicate is removed, as before');
  assert.equal(db.prepare("SELECT person_id FROM checkins WHERE id = 'ci-dup-0001'").get().person_id, keep, 'check-ins move to the kept person');
  assert.equal(db.prepare('SELECT archived FROM people WHERE id = ?').get(dup).archived, 1);
  assert.equal(count('attendance', `service_id = ${past} AND person_id = ${keep}`), 1);
});

test('a past accepted answer can’t be changed, so it can’t be declined and then deleted (route, own answer and database)', async () => {
  const past = app.add.service(PAST);
  const a = app.add.assignment(past, P.guitar, P.cat, 'accepted');
  const mine = app.make('cat', 'volunteer');
  db.prepare('UPDATE users SET person_id = ? WHERE id = ?').run(P.cat, mine);
  for (const who of ['cat', 'staff', 'admin']) {
    const r = await call(who, 'PATCH', `/assignments/${a}`, { status: 'declined', reason: 'sorry' });
    assert.equal(r.status, 409, who);
    assert.equal(r.data.error, MSG.restatus);
  }
  assert.equal((await call('staff', 'PATCH', `/assignments/${a}`, { status: 'pending' })).status, 409);
  assert.equal(db.prepare('SELECT status FROM assignments WHERE id = ?').get(a).status, 'accepted');
  assert.equal((await call('staff', 'DELETE', `/assignments/${a}`)).status, 409);
  assert.equal(count('assignments', `id = ${a}`), 1);
  // Answering something upcoming still works, and repeating the same status on a past one isn't a change.
  const future = app.add.service(FUTURE);
  const f = app.add.assignment(future, P.guitar, P.cat, 'pending');
  assert.equal((await call('cat', 'PATCH', `/assignments/${f}`, { status: 'declined', reason: 'away' })).status, 200);
  assert.equal((await call('staff', 'PATCH', `/assignments/${a}`, { status: 'accepted' })).status, 200);
  // The update window is 14 hours back: a correction a couple of hours after the start is allowed, one a day later is not.
  const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString().slice(0, 16);
  const recent = app.add.service(hoursAgo(2));
  const r2 = app.add.assignment(recent, P.drums, P.cat, 'accepted');
  assert.equal((await call('staff', 'PATCH', `/assignments/${r2}`, { status: 'declined' })).status, 200);
  const old = app.add.service(hoursAgo(20));
  const r3 = app.add.assignment(old, P.drums, P.cat, 'accepted');
  assert.equal((await call('staff', 'PATCH', `/assignments/${r3}`, { status: 'declined' })).status, 409);
});

test('a past service with records can’t be moved to the future to get round the delete guard', async () => {
  const past = app.add.service(PAST);
  app.add.assignment(past, P.guitar, P.ann, 'accepted');
  const r = await call('staff', 'PATCH', `/services/${past}`, { starts_at: '2099-05-05T09:00' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, MSG.retime);
  assert.equal(db.prepare('SELECT starts_at FROM services WHERE id = ?').get(past).starts_at, PAST);
  assert.equal(refused("UPDATE services SET starts_at = '2099-05-05T09:00' WHERE id = ?", past)?.message, MSG.retime, 'the database too');
  assert.equal((await call('staff', 'DELETE', `/services/${past}`)).status, 409);
  // Corrections that keep it in the past are fine; so is retiming a service with no records, or an upcoming one.
  assert.equal((await call('staff', 'PATCH', `/services/${past}`, { starts_at: '2020-03-01T09:30', title: 'Corrected' })).status, 200);
  const empty = app.add.service(PAST2);
  assert.equal((await call('staff', 'PATCH', `/services/${empty}`, { starts_at: '2099-05-06T09:00' })).status, 200);
  const upcoming = app.add.service(FUTURE);
  app.add.assignment(upcoming, P.guitar, P.ann, 'accepted');
  assert.equal((await call('staff', 'PATCH', `/services/${upcoming}`, { starts_at: '2099-03-02T10:00' })).status, 200);
  // Tomorrow's service (inside the delete window, outside the update window) can still be moved.
  const tomorrow = app.add.service(new Date(Date.now() + 20 * 3600e3).toISOString().slice(0, 16));
  app.add.assignment(tomorrow, P.guitar, P.bob, 'accepted');
  assert.equal((await call('staff', 'PATCH', `/services/${tomorrow}`, { starts_at: new Date(Date.now() + 22 * 3600e3).toISOString().slice(0, 16) })).status, 200);
});

test('series: a from_date in the past is clamped to today, and a service with records keeps its time', async () => {
  const t = makeSeries('Retime');
  const past = inSeries(t, '2020-10-04T09:00');
  app.add.assignment(past, P.drums, P.ann, 'accepted');
  const future = inSeries(t, '2099-10-04T09:00');
  const r = await call('staff', 'PATCH', `/series/${t}`, { from_date: '2020-01-01', start_time: '10:30' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT starts_at FROM services WHERE id = ?').get(past).starts_at, '2020-10-04T09:00', 'past services aren’t retimed');
  assert.equal(db.prepare('SELECT starts_at FROM services WHERE id = ?').get(future).starts_at, '2099-10-04T10:30');
});

test('merge writes the moved check-ins to the record (first 20 and the count)', async () => {
  const keep = app.add.person('Mo', 'Moves');
  const dup = app.add.person('Mo', 'Movess');
  for (let i = 0; i < 25; i++) app.add.checkin(`ci-mv-${String(i).padStart(3, '0')}`, dup, { day: '2020-04-01' });
  assert.equal((await call('admin', 'POST', `/people/${keep}/merge`, { duplicate_id: dup })).status, 200);
  const ev = db.prepare("SELECT * FROM checkin_events WHERE action = 'checkin.merge' AND person_id = ?").all(keep).map((e) => ({ ...e, d: JSON.parse(e.detail) }));
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].person_id, ev[0].user_id, ev[0].d.count, ev[0].d.checkin_ids.length, ev[0].d.truncated, ev[0].d.from_person_id, ev[0].d.to_person_id], [keep, ids.admin, 25, 20, true, dup, keep]);
});
