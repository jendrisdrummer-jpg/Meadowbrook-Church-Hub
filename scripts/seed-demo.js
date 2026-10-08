// Fills a fresh database with made-up demo data: two campuses, families, teams, services,
// schedules, songs, past attendance and check-ins. Run with `npm run demo`.
// Every name here is invented.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { openDb, tx, setSetting } from '../server/db.js';
import { securityCode, roomFor } from '../public/js/checkin-rules.js';
import { addMinutes } from '../server/routes/services.js';

const file = process.env.MB_DB || 'data/demo.db';
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const db = openDb(file);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];
const ins = (table, row) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
const iso = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const LAST = ['Anderson', 'Brooks', 'Carter', 'Diaz', 'Ellis', 'Foster', 'Garcia', 'Hayes', 'Irving', 'Jensen', 'Kim', 'Lopez', 'Morgan', 'Nguyen', 'Owens', 'Patel', 'Quinn', 'Reyes', 'Shaw', 'Turner', 'Vance', 'Walsh', 'Young', 'Zimmer'];
const ADULT_F = ['Sarah', 'Emily', 'Jessica', 'Rachel', 'Megan', 'Laura', 'Hannah', 'Grace', 'Olivia', 'Natalie', 'Rebecca', 'Anna'];
const ADULT_M = ['David', 'Michael', 'James', 'Daniel', 'Matthew', 'Andrew', 'Chris', 'Ryan', 'Josh', 'Nathan', 'Ben', 'Luke'];
const KIDS = ['Emma', 'Liam', 'Ava', 'Noah', 'Mia', 'Elijah', 'Ella', 'Lucas', 'Lily', 'Mason', 'Zoe', 'Ethan', 'Chloe', 'Caleb', 'Ruby', 'Owen'];
const ALLERGIES = ['', '', '', '', '', 'Peanuts', 'Dairy', 'Tree nuts', 'Bee stings'];

tx(db, () => {
  setSetting(db, 'church_name', 'Meadowbrook Church');
  setSetting(db, 'workspace_domain', 'meadowbrook.church');
  const north = ins('campuses', { name: 'Meadowbrook North', short_name: 'North', address: '100 Meadow Ln', timezone: 'America/Chicago', color: '#2f7d4f', sort: 0 });
  const south = ins('campuses', { name: 'Meadowbrook South', short_name: 'South', address: '2400 Brook Rd', timezone: 'America/Chicago', color: '#3b6fd8', sort: 1 });
  const campuses = [north, south];

  const rooms = {};
  for (const c of campuses) {
    rooms[c] = [
      { name: 'Nursery', min_age_months: 0, max_age_months: 23 },
      { name: 'Toddlers', min_age_months: 24, max_age_months: 47 },
      { name: 'Preschool', min_age_months: 48, max_age_months: 71, min_grade: -1, max_grade: -1 },
      { name: 'Kids (K–2nd)', min_grade: 0, max_grade: 2, min_age_months: 72, max_age_months: 95 },
      { name: 'Kids (3rd–5th)', min_grade: 3, max_grade: 5, min_age_months: 96, max_age_months: 131 },
    ].map((r, i) => ({ ...r, id: ins('rooms', { campus_id: c, sort: i, capacity: 20, ...r }) }));
  }

  // Households.
  const people = [];
  LAST.forEach((last, i) => {
    const campus = i % 3 === 2 ? south : north;
    const hid = ins('households', { name: `${last} Household`, campus_id: campus, address: `${100 + i * 7} ${pick(['Oak', 'Elm', 'Maple', 'Cedar'])} St`, city: 'Springfield', state: 'IL', zip: '62704' });
    const status = pick(['member', 'member', 'regular', 'regular', 'guest']);
    const adults = [pick(ADULT_F), ...(rand() > 0.25 ? [pick(ADULT_M)] : [])];
    adults.forEach((first, j) => {
      const id = ins('people', {
        household_id: hid, household_role: 'adult', first_name: first, last_name: last, campus_id: campus, status,
        email: `${first}.${last}@example.com`.toLowerCase(), phone: `555-${String(200 + i).padStart(3, '0')}-${String(1000 + j * 11 + i * 37).slice(-4)}`,
        birthdate: `${1975 + Math.floor(rand() * 20)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`, gender: j === 0 ? 'female' : 'male',
      });
      people.push({ id, first, last, campus, adult: true });
    });
    const kids = Math.floor(rand() * 3.4);
    for (let k = 0; k < kids; k++) {
      const age = Math.floor(rand() * 11);
      const birth = iso(daysFrom(-(age * 365 + Math.floor(rand() * 300) + 60)));
      const grade = age >= 6 ? age - 6 : age === 5 ? 0 : null;
      const id = ins('people', { household_id: hid, household_role: 'child', first_name: pick(KIDS), last_name: last, campus_id: campus, status, birthdate: birth, grade, allergies: pick(ALLERGIES) });
      people.push({ id, last, campus, adult: false, birthdate: birth, grade });
    }
    if (rand() > 0.7) ins('household_pickups', { household_id: hid, name: `${pick(['Linda', 'Carol', 'Frank', 'George'])} ${last}`, relationship: 'Grandparent', phone: '555-010-2020' });
  });

  // Accounts. Sign in on the demo as any of these (MB_DEV_LOGIN is on).
  const pastor = people.find((p) => p.adult && p.campus === north);
  const southStaff = people.find((p) => p.adult && p.campus === south);
  const volunteer = people.filter((p) => p.adult && p.campus === north)[3];
  db.prepare("UPDATE people SET email = 'pastor@meadowbrook.church' WHERE id = ?").run(pastor.id);
  ins('users', { email: 'pastor@meadowbrook.church', role: 'admin', person_id: pastor.id });
  db.prepare("UPDATE people SET email = 'south@meadowbrook.church' WHERE id = ?").run(southStaff.id);
  ins('users', { email: 'south@meadowbrook.church', role: 'staff', person_id: southStaff.id, campus_ids: JSON.stringify([south]) });
  db.prepare("UPDATE people SET email = 'volunteer@meadowbrook.church' WHERE id = ?").run(volunteer.id);
  ins('users', { email: 'volunteer@meadowbrook.church', role: 'volunteer', person_id: volunteer.id });

  // Teams and positions: worship and kids per campus, production church-wide.
  const adults = people.filter((p) => p.adult);
  const team = (name, campus, color, positions, size) => {
    const tid = ins('teams', { name, campus_id: campus, color });
    const pos = positions.map((n, i) => ({ id: ins('positions', { team_id: tid, name: n, sort: i }), name: n }));
    const pool = adults.filter((p) => campus == null || p.campus === campus).sort(() => rand() - 0.5).slice(0, size);
    pool.forEach((p, i) => {
      const plays = [pos[i % pos.length], ...(rand() > 0.7 ? [pick(pos)] : [])];
      for (const ps of new Set(plays)) db.prepare('INSERT OR IGNORE INTO team_members (team_id, person_id, position_id, is_leader) VALUES (?, ?, ?, ?)').run(tid, p.id, ps.id, i === 0 ? 1 : 0);
    });
    return pos;
  };
  const needs = {};
  for (const c of campuses) {
    const label = c === north ? 'North' : 'South';
    const w = team(`Worship · ${label}`, c, '#7c4dcc', ['Worship Leader', 'Vocals', 'Acoustic Guitar', 'Keys', 'Drums', 'Bass'], 12);
    const k = team(`Kids · ${label}`, c, '#d39b3a', ['Nursery', 'Preschool Teacher', 'Elementary Leader', 'Check-in Desk'], 10);
    const h = team(`Hospitality · ${label}`, c, '#c2412d', ['Greeter', 'Usher', 'Coffee'], 8);
    needs[c] = [[w[0], 1], [w[1], 2], [w[2], 1], [w[3], 1], [w[4], 1], [k[0], 2], [k[1], 1], [k[2], 2], [k[3], 1], [h[0], 2], [h[1], 2]];
  }
  const prod = team('Production', null, '#4f6bed', ['Sound', 'Lyrics / ProPresenter', 'Livestream', 'Lighting'], 9);
  needs[north].push([prod[0], 1], [prod[1], 1], [prod[2], 1]);
  needs[south].push([prod[0], 1], [prod[1], 1]);

  // Repeating services, starting six Sundays ago.
  const firstSunday = daysFrom(-new Date().getDay() - 42);
  const types = [
    { campus: north, name: 'Sunday 9:00 AM', time: '09:00' },
    { campus: north, name: 'Sunday 11:00 AM', time: '11:00' },
    { campus: south, name: 'Sunday 10:00 AM', time: '10:00' },
  ].map((t) => {
    const id = ins('service_types', { campus_id: t.campus, name: t.name, day_of_week: 0, start_time: t.time, duration_min: 75, starts_on: iso(firstSunday) });
    for (const [p, n] of needs[t.campus]) db.prepare('INSERT INTO service_type_needs (service_type_id, position_id, count) VALUES (?, ?, ?)').run(id, p.id, n);
    return { ...t, id };
  });

  // Songs.
  const songs = [['Goodness of God', 'Jenn Johnson, Ed Cash', 'A'], ['Build My Life', 'Pat Barrett', 'G'], ['Way Maker', 'Sinach', 'E'], ['Holy Forever', 'Chris Tomlin', 'C'],
    ['Firm Foundation', 'Cody Carnes', 'B'], ['Gratitude', 'Brandon Lake', 'F'], ['King of Kings', 'Hillsong Worship', 'D'], ['Great Are You Lord', 'All Sons & Daughters', 'G'],
    ['Living Hope', 'Phil Wickham', 'C'], ['What A Beautiful Name', 'Hillsong Worship', 'D']]
    .map(([title, author, key], i) => ins('songs', { title, author, default_key: key, ccli: String(7000000 + i * 1371) }));

  // Services: 6 weeks back, 6 weeks ahead.
  const sunday = daysFrom(-new Date().getDay());
  const series = ['Rooted', 'Rooted', 'Rooted', 'Psalms of Summer', 'Psalms of Summer', 'Psalms of Summer', 'Advent Hope', 'Advent Hope', 'Advent Hope', 'Advent Hope', 'Christmas', 'New Year'];
  for (let w = -6; w <= 6; w++) {
    const day = new Date(sunday); day.setDate(day.getDate() + w * 7);
    const date = iso(day);
    for (const t of types) {
      const starts = `${date}T${t.time}`;
      const sid = ins('services', { campus_id: t.campus, service_type_id: t.id, starts_at: starts, duration_min: 75, series: series[w + 6] || '', title: w === 0 ? 'Part 3' : '' });
      for (const [p, n] of needs[t.campus]) ins('service_needs', { service_id: sid, position_id: p.id, count: n });
      if (w <= 2) {
        const plan = [['header', 'Pre-service', 0], ['item', 'Countdown & walk-in music', 300], ['header', 'Worship', 0],
          ['song', null, 300], ['song', null, 270], ['song', null, 330], ['item', 'Welcome & announcements', 240],
          ['header', 'Message', 0], ['item', 'Sermon', 2100], ['song', null, 300], ['item', 'Benediction', 60]];
        let used = new Set();
        plan.forEach(([kind, title, len], i) => {
          let songId = null;
          if (kind === 'song') { do { songId = pick(songs); } while (used.has(songId)); used.add(songId); }
          const s = songId ? db.prepare('SELECT title, default_key FROM songs WHERE id = ?').get(songId) : null;
          ins('plan_items', { service_id: sid, sort: i, kind, title: s?.title ?? title, song_id: songId, song_key: s?.default_key ?? '', length_sec: len });
        });
      }
      // Schedule people, leaving some gaps in future weeks so there's work to do.
      for (const [pos, n] of needs[t.campus]) {
        const members = db.prepare('SELECT person_id FROM team_members WHERE position_id = ?').all(pos.id).map((r) => r.person_id);
        for (let i = 0; i < n; i++) {
          if (w > 0 && rand() < 0.15 * w) continue;
          const person = members.length ? members[(w + 6 + i + t.id) % members.length] : null;
          if (!person) continue;
          const clash = db.prepare(`SELECT 1 FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.person_id = ? AND s.starts_at < ? AND s.starts_at > ?`)
            .get(person, addMinutes(starts, 75), addMinutes(starts, -75));
          if (clash) continue;
          const status = w < 0 ? 'accepted' : rand() < 0.6 ? 'accepted' : rand() < 0.85 ? 'pending' : 'declined';
          db.prepare('INSERT OR IGNORE INTO assignments (service_id, position_id, person_id, status, decline_reason) VALUES (?, ?, ?, ?, ?)')
            .run(sid, pos.id, person, status, status === 'declined' ? 'Out of town' : '');
        }
      }
      // Past attendance: headcounts and kids' check-ins.
      if (w < 0) {
        const base = t.campus === north ? (t.time === '09:00' ? 140 : 170) : 95;
        ins('headcounts', { service_id: sid, area: 'Auditorium', count: base + Math.floor(rand() * 30) - 10 });
        ins('headcounts', { service_id: sid, area: 'Online', count: 30 + Math.floor(rand() * 25) });
        const kids = people.filter((p) => !p.adult && p.campus === t.campus && rand() < 0.45);
        for (const k of kids) {
          const room = roomFor(k, rooms[t.campus], date);
          const at = new Date(`${starts}:00`);
          ins('checkins', { id: crypto.randomUUID(), campus_id: t.campus, service_id: sid, person_id: k.id, room_id: room?.id ?? null, kind: 'kid', security_code: securityCode(rand), station: 'Lobby', day: date, checked_in_at: at.toISOString(), checked_out_at: new Date(at.getTime() + 80 * 60000).toISOString(), checked_out_by: 'Lobby' });
        }
      }
    }
  }
  // A few away dates.
  for (const p of adults.slice(0, 5)) ins('blockouts', { person_id: p.id, start_date: iso(daysFrom(2)), end_date: iso(daysFrom(9)), reason: pick(['Vacation', 'Work trip', 'Family visit']) });
});

console.log(`Demo data written to ${file}. Sign in as pastor@meadowbrook.church (admin), south@meadowbrook.church (South staff) or volunteer@meadowbrook.church.`);
