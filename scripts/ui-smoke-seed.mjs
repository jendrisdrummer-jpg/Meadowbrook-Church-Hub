// Long, realistic content for the UI smoke run: the layouts that broke on real phones only broke
// with long titles, names and emails (a repeating service's row squeezed to one letter per line).
// Called by ui-smoke.mjs on its throwaway database; made-up data only.
const LONG_TITLE = 'Sunday Morning Worship and Communion Gathering with Kids Dedication';
const LONG_WORD = 'Supercalifragilisticexpialidocious-Longhyphenatedsurname';

export function seedLongContent(db) {
  const ins = (table, row) => Number(db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
  const campuses = db.prepare('SELECT id FROM campuses ORDER BY id').all().map((c) => c.id);
  const [c1, c2] = campuses;
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const stamp = (n, hhmm) => `${iso(daysFrom(n))}T${hhmm}`;

  // Repeating services with long titles, rhythms, template names and many positions.
  const tpl = ins('service_templates', { name: 'Extended Communion Sunday Order of Service with Baptisms and Testimonies', campus_id: c1, start_time: '10:00' });
  const positions = db.prepare('SELECT id FROM positions ORDER BY id LIMIT 14').all().map((p) => p.id);
  const series = [
    { campus_id: c1, name: 'Sunday 10:00 AM', day_of_week: 0, start_time: '10:00', every_weeks: 1, default_title: LONG_TITLE, template_id: tpl },
    { campus_id: c2, name: 'Wednesday Evening Prayer, Worship and Teaching Night for the Whole Family', day_of_week: 3, start_time: '18:30', every_weeks: 2, default_title: '', ends_on: iso(daysFrom(200)) },
    { campus_id: c2, name: 'Sunday 9:00 AM', day_of_week: 0, start_time: '09:00', every_weeks: 1, default_title: 'Short one' },
    { campus_id: c1, name: 'Good Friday', day_of_week: 5, start_time: '19:00', every_weeks: 1, default_title: 'Good Friday Tenebrae Service of Shadows' },
  ];
  series.forEach((s, i) => {
    const id = ins('service_types', { duration_min: 75, starts_on: iso(daysFrom(-30)), ...s });
    positions.slice(0, i === 3 ? 0 : i === 2 ? 1 : 14).forEach((p) => db.prepare('INSERT OR IGNORE INTO service_type_needs (service_type_id, position_id, count) VALUES (?, ?, 1)').run(id, p));
  });

  // People with long names and emails.
  const person = (first, last, email, extra = {}) => ins('people', { first_name: first, last_name: last, email, phone: '555-0100', status: 'member', campus_id: c1, ...extra });
  person('Maximilian-Bartholomew', `Featherstonehaugh-${LONG_WORD}`, 'maximilian.bartholomew.featherstonehaugh@a-very-long-email-domain-name.example.org');
  person('Bartholomew', 'Wolfeschlegelsteinhausenbergerdorff', 'b.wolfeschlegelsteinhausenbergerdorff@example.com', { household_role: 'child', grade: 3 });
  person('Anna Maria Josephine Catherine', 'Van Der Westhuizen Oosthuizen', 'annamaria@example.com', { campus_id: c2, status: 'guest' });
  person('Ng', 'Li', 'a@b.co');

  // Teams with long names and positions.
  const team = ins('teams', { name: 'Hospitality, Welcome, Parking and First Impressions Ministry Team', campus_id: c1, color: '#4f6bed', description: 'Everyone who greets, parks cars, hands out bulletins and helps first-time guests find their way around the building on a Sunday.' });
  ['Parking Lot Attendant and Rainy Day Umbrella Escort', 'Welcome Table Host', 'Greeter'].forEach((n, i) => ins('positions', { team_id: team, name: n, sort: i }));
  ins('teams', { name: 'Production and Livestream and Lyrics and Lighting Volunteers Collective', campus_id: null, color: '#7c4dcc' });

  // Songs.
  [['Great Is Thy Faithfulness (Morning by Morning New Mercies I See) Extended Arrangement', 'Thomas Chisholm, William Runyan, Chris Tomlin, Pat Barrett, Brooke Ligertwood'],
    ['O Come, O Come, Emmanuel / Hallelujah What a Savior Medley', 'Traditional']].forEach(([title, author]) => ins('songs', { title, author, default_key: 'G', ccli: '1234567', bpm: 72 }));

  // Forms with long questions and a response.
  const questions = [
    { id: 'q1', label: 'Please describe in as much detail as you can how you would like to be involved in serving on Sunday mornings and what gifts you bring to the team', type: 'text', required: true },
    { id: 'q2', label: 'Which of these long-named ministry areas interests you most this season?', type: 'choice', options: ['Hospitality, Welcome and Parking Team', 'Children’s Ministry Nursery to Fifth Grade', 'Production, Livestream and Lighting'], required: false },
    { id: 'q3', label: 'Is there anything we should know?', type: 'yesno', required: false },
  ];
  const form = ins('forms', { slug: 'long-form-smoke', title: 'Volunteer Interest and Availability Survey for the Upcoming Fall Season of Ministry', intro: 'Tell us how you would like to serve. '.repeat(5), questions: JSON.stringify(questions), campus_id: c1 });
  ins('form_responses', { form_id: form, name: `Maximilian-Bartholomew Featherstonehaugh`, email: 'maximilian.bartholomew.featherstonehaugh@a-very-long-email-domain-name.example.org', answers: JSON.stringify({ q1: 'I would love to help. '.repeat(20), q2: 'Hospitality, Welcome and Parking Team', q3: 'yes' }) });

  // Events, groups, connect cards, media.
  ins('events', { title: 'Annual Church-Wide Fall Harvest Festival, Potluck Dinner and Community Outreach Evening', description: 'Come celebrate. '.repeat(30), location: 'Meadowbrook Community Fellowship Hall and Outdoor Pavilion', address: '1234 Very Long Street Name Boulevard, Springfield', starts_at: stamp(10, '17:30'), published: 1, signup: 1, capacity: 120, questions: JSON.stringify([{ id: 'a', label: 'Do you have any food allergies we should plan for in the potluck and what are they exactly?', type: 'text', required: false }]) });
  ins('groups', { name: 'Young Married Couples Wednesday Night Dinner and Discussion Group at the Hendersons', description: 'We meet to share a meal and talk. '.repeat(6), campus_id: c1 });
  ins('connect_cards', { campus_id: c1, first_name: 'Maximilian-Bartholomew', last_name: `Featherstonehaugh-${LONG_WORD}`, email: 'maximilian.bartholomew.featherstonehaugh@a-very-long-email-domain-name.example.org', phone: '555-0100', first_time: 1, interests: JSON.stringify(['Hospitality, Welcome and Parking Team', 'Children’s Ministry', 'Small groups']), message: 'Please pray for our family during a long season of transition. '.repeat(5) });
  ins('media', { video_id: 'smokelongvid01', title: 'The Long Walk Home: Reflections on the Parable of the Prodigal Son and the Waiting Father, Part Three', yt_title: 'Sunday Service', day: iso(daysFrom(-3)), recorded_at: `${iso(daysFrom(-3))}T15:00:00`, speaker: 'Pastor Bartholomew Featherstonehaugh-Wolfeschlegelstein', series: 'The Gospel of Luke: A Journey Through the Parables of Jesus', scripture: 'Luke 15:11-32; Luke 14:25-35; Luke 16:1-13', campus_id: c1, duration: 2400 });
  ins('media', { video_id: 'smokelongvid02', title: 'Short', day: iso(daysFrom(-10)), recorded_at: `${iso(daysFrom(-10))}T15:00:00`, duration: 1800 });

  // A long task and announcement, for the lists that carry them.
  ins('announcements', { title: 'Reminder: the parking lot team meets before the first service this Sunday for a very important briefing', body: 'Please arrive early. '.repeat(15), send_at: `${iso(daysFrom(2))} 14:00:00` });
  ins('tasks', { title: 'Confirm the rental of the extra folding chairs and tables for the fall harvest festival potluck dinner', notes: 'Call the rental company. '.repeat(8), team_id: team, due_date: iso(daysFrom(3)) });
}
