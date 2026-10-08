// Admin settings: church, campuses, kids' rooms, service times, accounts and the people import.
import { get, post, patch, html, mount, icon, dialog, formData, options, toast, fail, DAYS, displayName, pickPerson } from '../lib.js';
import { state, setTitle, go, campusName } from '../app.js';
import { gradeLabel } from '../checkin-rules.js';

const TABS = [['church', 'Church'], ['campuses', 'Campuses'], ['rooms', 'Kids’ rooms'], ['services', 'Service times'], ['accounts', 'Accounts'], ['import', 'Import people']];

export default async function settings(el, tab = 'church') {
  setTitle('Settings');
  mount(el, html`<div class="tabs">${TABS.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}</button>`)}</div><div data-panel></div>`);
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) go(`/settings/${b.dataset.tab}`); };
  const panel = el.querySelector('[data-panel]');
  await ({ church, campuses, rooms, services, accounts, import: importPeople }[tab] || church)(panel);
}

const refreshCampuses = async () => { state.campuses = await get('/campuses'); };

// ---------------------------------------------------------------- church
async function church(panel) {
  const s = await get('/settings');
  mount(panel, html`<form class="card stack" style="max-width:640px">
    <label class="field">Church name<input type="text" name="church_name" value="${s.church_name}"></label>
    <label class="field">Who can sign in on their own<select name="sign_in_policy">${options([
      { value: 'anyone', label: 'Anyone with a Google account' },
      { value: 'directory', label: 'People whose email is in the directory, and church accounts' },
      { value: 'domain', label: 'Church Google accounts only' },
      { value: 'invited', label: 'Only accounts an admin adds' },
    ], s.sign_in_policy)}</select>
      <span class="muted small">New sign-ins start as volunteers: they see only their own schedule until you give them more access in Accounts.</span></label>
    <label class="field">Church Google domain<input type="text" name="workspace_domain" value="${s.workspace_domain}" placeholder="meadowbrook.church">
      <span class="muted small">Used by the “church accounts” options above.</span></label>
    <label class="field">Headcount areas, one per line<textarea name="headcount_areas">${s.headcount_areas.join('\n')}</textarea></label>
    <label class="field">Name tag labels<select name="label_size">${options([
      { value: 'brother-62x29', label: 'Brother QL — 62 × 29 mm (DK-1209)' },
      { value: 'brother-62x100', label: 'Brother QL — 62 × 100 mm (DK-1202)' },
      { value: 'dymo-30252', label: 'DYMO 30252 — 1⅛ × 3½ in' },
      { value: 'dymo-30256', label: 'DYMO 30256 — 2⁵⁄₁₆ × 4 in' },
      { value: 'letter', label: 'Plain paper (no label printer)' },
    ], s.label_size)}</select></label>
    <label class="check"><input type="checkbox" name="checkin_print_parent_tag" ${s.checkin_print_parent_tag ? 'checked' : ''}> Print a parent pickup tag with each check-in</label>
    <div class="row end"><button class="btn primary">Save</button></div>
  </form>`);
  panel.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    b.headcount_areas = b.headcount_areas.split('\n').map((x) => x.trim()).filter(Boolean);
    try { await patch('/settings', b); Object.assign(state.settings, b); toast('Saved.'); } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- campuses
async function campuses(panel) {
  await refreshCampuses();
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Pacific/Honolulu')) : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Campuses</h2><button class="btn primary" data-add>${icon('plus')} Add campus</button></div>
    ${state.campuses.length ? html`<table class="list"><tbody>${state.campuses.map((c) => html`<tr class="click" data-id="${c.id}">
      <td><span class="dot" style="background:${c.color}"></span></td><td><b>${c.name}</b> <span class="muted">${c.short_name}</span><div class="muted small">${c.address}</div></td>
      <td class="muted small">${c.timezone}</td><td>${c.active ? '' : html`<span class="pill">Closed</span>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">Add each of your campuses. You can add more whenever a new one opens.</div>`}
  </div>`);
  const edit = async (c = {}) => {
    const ok = await dialog({
      title: c.id ? c.name : 'New campus',
      body: html`<div class="form">
        <label class="field">Name<input type="text" name="name" value="${c.name || ''}" required placeholder="Meadowbrook North"></label>
        <label class="field">Short name<input type="text" name="short_name" value="${c.short_name || ''}" placeholder="North" maxlength="20"></label>
        <label class="field wide">Address<input type="text" name="address" value="${c.address || ''}"></label>
        <label class="field">Time zone<select name="timezone">${options(zones.map((z) => ({ value: z, label: z.replace('America/', '').replace(/_/g, ' ') })), c.timezone || 'America/Chicago')}</select></label>
        <label class="field">Colour<input type="color" name="color" value="${c.color || '#2f7d4f'}" style="height:38px;width:100%"></label>
        ${c.id ? html`<label class="check wide"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Open (uncheck to hide a campus that has closed)</label>` : ''}</div>`,
      onSubmit: (f) => (c.id ? patch(`/campuses/${c.id}`, formData(f)) : post('/campuses', formData(f))),
    });
    if (ok) { await refreshCampuses(); location.reload(); }
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const tr = e.target.closest('tr[data-id]');
    if (tr) edit(state.campuses.find((c) => c.id === Number(tr.dataset.id)));
  };
}

// ---------------------------------------------------------------- kids' rooms
const AGES = [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168, 180].map((m) => ({ value: m, label: m < 24 ? `${m} months` : `${m / 12} years` }));
const GRADES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => ({ value: g, label: gradeLabel(g) }));

async function rooms(panel) {
  const list = await get('/rooms');
  const describe = (r) => [
    r.min_grade != null ? `${gradeLabel(r.min_grade)} – ${gradeLabel(r.max_grade)}` : '',
    r.min_age_months != null ? `ages ${AGES.find((a) => a.value === r.min_age_months)?.label ?? `${r.min_age_months} mo`} – ${AGES.find((a) => a.value === r.max_age_months)?.label ?? `${r.max_age_months} mo`}` : '',
  ].filter(Boolean).join(', or ');
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Kids’ rooms</h2><button class="btn primary" data-add>${icon('plus')} Add room</button></div>
    <p class="muted small">At check-in, school-age kids go to the room for their grade; younger kids go by age. Rooms are checked top to bottom.</p>
    ${state.campuses.map((c) => html`<h3 style="margin-top:14px">${c.name}</h3>${list.filter((r) => r.campus_id === c.id).length
      ? html`<table class="list"><tbody>${list.filter((r) => r.campus_id === c.id).map((r) => html`<tr class="click" data-id="${r.id}"><td><b>${r.name}</b></td><td class="muted small">${describe(r)}</td><td class="muted small">${r.capacity ? `Max ${r.capacity}` : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="muted small">No rooms yet.</p>`}`)}
  </div>`);
  const edit = async (r = {}) => {
    const ok = await dialog({
      title: r.id ? r.name : 'New room',
      body: html`<div class="form">
        <label class="field">Campus<select name="campus_id" ${r.id ? 'disabled' : ''}>${options(state.campuses.map((c) => ({ value: c.id, label: c.name })), r.campus_id ?? state.campusId)}</select></label>
        <label class="field">Room name<input type="text" name="name" value="${r.name || ''}" required placeholder="Nursery"></label>
        <label class="field">From age<select name="min_age_months">${options(AGES, r.min_age_months, { blank: '—' })}</select></label>
        <label class="field">Through age (months)<input type="number" name="max_age_months" value="${r.max_age_months ?? ''}" placeholder="e.g. 23 for under 2s"></label>
        <label class="field">From grade<select name="min_grade">${options(GRADES, r.min_grade, { blank: '—' })}</select></label>
        <label class="field">Through grade<select name="max_grade">${options(GRADES, r.max_grade, { blank: '—' })}</select></label>
        <label class="field">Capacity<input type="number" name="capacity" value="${r.capacity ?? ''}"></label>
        <label class="field">Order<input type="number" name="sort" value="${r.sort ?? 0}"></label>
        ${r.id ? html`<label class="check wide"><input type="checkbox" name="archived"> Remove this room</label>` : ''}</div>`,
      onSubmit: (f) => (r.id ? patch(`/rooms/${r.id}`, formData(f)) : post('/rooms', formData(f))),
    });
    if (ok) rooms(panel);
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const tr = e.target.closest('tr[data-id]');
    if (tr) edit(list.find((r) => r.id === Number(tr.dataset.id)));
  };
}

// ---------------------------------------------------------------- service times
async function services(panel) {
  const [types, teams] = await Promise.all([get('/service-types'), get('/teams')]);
  const positions = teams.flatMap((t) => t.positions.map((p) => ({ ...p, team: t.name, campus_id: t.campus_id })));
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Regular service times</h2><button class="btn primary" data-add>${icon('plus')} Add service time</button></div>
    <p class="muted small">Each service time lists the volunteer positions it needs. Use <b>Add upcoming weeks</b> on the Services page to create the actual services.</p>
    ${state.campuses.map((c) => html`<h3 style="margin-top:14px">${c.name}</h3>${types.filter((t) => t.campus_id === c.id).length
      ? html`<table class="list"><tbody>${types.filter((t) => t.campus_id === c.id).map((t) => html`<tr class="click" data-id="${t.id}"><td><b>${t.name}</b><div class="muted small">${t.day_of_week != null ? DAYS[t.day_of_week] : 'No regular day'} at ${t.start_time} · ${t.duration_min} min</div></td>
        <td class="small">${t.needs.map((n) => `${n.position_name}${n.count > 1 ? ` ×${n.count}` : ''}`).join(', ') || html`<span class="muted">No positions yet</span>`}</td></tr>`)}</tbody></table>`
      : html`<p class="muted small">None yet.</p>`}`)}
  </div>`);
  const edit = async (t = {}) => {
    const campusId = t.campus_id ?? state.campusId ?? state.campuses[0]?.id;
    const avail = positions.filter((p) => p.campus_id == null || p.campus_id === campusId);
    const need = (pid) => t.needs?.find((n) => n.position_id === pid)?.count ?? 0;
    const ok = await dialog({
      title: t.id ? t.name : 'New service time', wide: true,
      body: html`<div class="form">
        <label class="field">Campus<select name="campus_id" ${t.id ? 'disabled' : ''}>${options(state.campuses.map((c) => ({ value: c.id, label: c.name })), campusId)}</select></label>
        <label class="field">Name<input type="text" name="name" value="${t.name || ''}" required placeholder="Sunday 9:00 AM"></label>
        <label class="field">Day<select name="day_of_week">${options(DAYS.map((d, i) => ({ value: i, label: d })), t.day_of_week ?? 0, { blank: 'No regular day' })}</select></label>
        <label class="field">Starts<input type="time" name="start_time" value="${t.start_time || '09:00'}"></label>
        <label class="field">Length (minutes)<input type="number" name="duration_min" value="${t.duration_min ?? 75}"></label>
        ${t.id ? html`<label class="check"><input type="checkbox" name="archived"> Stop using this service time</label>` : ''}
      </div>
      <h3 style="margin-top:16px">How many of each position does this service need?</h3>
      ${avail.length ? html`<div class="grid three" style="gap:6px">${avail.map((p) => html`<label class="row small" style="justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:4px 8px">
        <span>${p.name} <span class="muted">${p.team}</span></span><input type="number" min="0" max="20" data-need="${p.id}" value="${need(p.id)}" style="width:64px"></label>`)}</div>`
        : html`<p class="muted small">Create teams and positions on the Teams page first.</p>`}`,
      onSubmit: (f) => {
        const b = formData(f);
        b.needs = [...f.querySelectorAll('[data-need]')].map((i) => ({ position_id: Number(i.dataset.need), count: Number(i.value) || 0 })).filter((n) => n.count > 0);
        if (b.day_of_week === '') b.day_of_week = null;
        return t.id ? patch(`/service-types/${t.id}`, b) : post('/service-types', b);
      },
    });
    if (ok) services(panel);
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const tr = e.target.closest('tr[data-id]');
    if (tr) edit(types.find((t) => t.id === Number(tr.dataset.id)));
  };
}

// ---------------------------------------------------------------- accounts
async function accounts(panel) {
  const users = await get('/users');
  const roleHelp = {
    volunteer: 'Their own schedule and the services they serve at',
    leader: 'Also people, teams, scheduling their teams, check-in',
    staff: 'Also edits people, services, rooms and all scheduling',
    admin: 'Everything, including settings and accounts',
  };
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Accounts</h2><button class="btn primary" data-add>${icon('plus')} Add account</button></div>
    <p class="muted small">People sign in with Google. ${({
      anyone: 'Anyone can sign in and starts as a volunteer.',
      directory: 'People in the directory (and church accounts) can sign in and start as volunteers.',
      domain: 'Church Google accounts can sign in and start as volunteers.',
      invited: 'Only the accounts listed here can sign in.',
    })[state.settings.sign_in_policy] || ''} Add someone here to give them more access before they sign in.</p>
    <table class="list"><thead><tr><th>Email</th><th>Person</th><th>Access</th><th>Campuses</th><th>Last sign-in</th></tr></thead><tbody>
    ${users.map((u) => html`<tr class="click" data-id="${u.id}"><td>${u.email}${u.active ? '' : html` <span class="pill bad">Disabled</span>`}</td>
      <td>${u.first_name ? `${u.first_name} ${u.last_name}` : html`<span class="pill warn">Not linked</span>`}</td>
      <td><span class="pill">${u.role}</span></td><td class="small muted">${u.campus_ids ? u.campus_ids.map(campusName).join(', ') : 'All'}</td>
      <td class="small muted">${u.last_login ? new Date(u.last_login + 'Z').toLocaleDateString() : 'Never'}</td></tr>`)}
    </tbody></table></div>`);
  const edit = async (u = { role: 'volunteer', active: 1, campus_ids: null }) => {
    let personId = u.person_id ?? null;
    let personLabel = u.first_name ? `${u.first_name} ${u.last_name}` : '';
    const ok = await dialog({
      title: u.id ? u.email : 'Add account',
      body: html`<div class="stack">
        ${u.id ? '' : html`<label class="field">Google account email<input type="email" name="email" required></label>`}
        <label class="field">Access<select name="role">${options(Object.keys(roleHelp).map((r) => ({ value: r, label: `${r[0].toUpperCase()}${r.slice(1)} — ${roleHelp[r]}` })), u.role)}</select></label>
        <div class="field"><span>Campuses</span>
          <label class="check"><input type="checkbox" name="all" ${!u.campus_ids ? 'checked' : ''}> All campuses</label>
          ${state.campuses.map((c) => html`<label class="check"><input type="checkbox" data-campus="${c.id}" ${u.campus_ids?.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}</div>
        <div class="row"><span>Person: <b data-person>${personLabel || 'not linked'}</b></span><button type="button" class="btn small" data-link>Link to person…</button></div>
        ${u.id ? html`<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Can sign in</label>` : ''}
      </div>`,
      onOpen: (d) => {
        d.querySelector('[data-link]').onclick = async () => {
          const p = await pickPerson('Link to which person?');
          if (p) { personId = p.id; d.querySelector('[data-person]').textContent = displayName(p); }
        };
      },
      onSubmit: (f) => {
        const b = formData(f);
        const body = { role: b.role, person_id: personId, campus_ids: b.all ? 'all' : [...f.querySelectorAll('[data-campus]:checked')].map((c) => Number(c.dataset.campus)) };
        if (u.id) body.active = b.active;
        else body.email = b.email;
        return u.id ? patch(`/users/${u.id}`, body) : post('/users', body);
      },
    });
    if (ok) accounts(panel);
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const tr = e.target.closest('tr[data-id]');
    if (tr) edit(users.find((u) => u.id === Number(tr.dataset.id)));
  };
}

// ---------------------------------------------------------------- import
const FIELD_LABELS = {
  external_id: 'Faith Teams person ID', first_name: 'First name', last_name: 'Last name', nickname: 'Goes by', email: 'Email', phone: 'Phone',
  birthdate: 'Birthdate', gender: 'Gender', grade: 'Grade', status: 'Membership status', household: 'Household / family', household_role: 'Family role',
  address: 'Street address', city: 'City', state: 'State', zip: 'ZIP', allergies: 'Allergies', campus: 'Campus',
};

async function importPeople(panel) {
  mount(panel, html`<div class="card" style="max-width:820px">
    <h2>Import people from Faith Teams (or any spreadsheet)</h2>
    <ol class="small" style="padding-left:18px">
      <li>In Faith Teams, export your people list as a CSV file. Include family/household, birthdates and allergies if you can.</li>
      <li>Choose the file below. We’ll match up the columns, and you can fix any we got wrong.</li>
      <li>Run a <b>test import</b> first: it shows what would happen without changing anything.</li>
    </ol>
    <p class="muted small">Importing the same file again updates people instead of duplicating them.</p>
    <input type="file" accept=".csv,text/csv" data-file>
    <div data-step></div>
  </div>`);
  panel.querySelector('[data-file]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const csv = await file.text();
    try {
      const pv = await post('/import/preview', csv);
      drawMapping(panel.querySelector('[data-step]'), csv, pv);
    } catch (err) { fail(err); }
  };
}

function drawMapping(box, csv, pv) {
  mount(box, html`<h3 style="margin-top:18px">${pv.count} rows found. Match the columns:</h3>
    <form class="form" data-map>${pv.fields.map((f) => html`<label class="field">${FIELD_LABELS[f] || f}<select name="${f}">${options(pv.headers.map((h) => ({ value: h, label: h })), pv.mapping[f], { blank: '— skip —' })}</select></label>`)}
      ${state.campuses.length ? html`<label class="field">Campus for anyone without one<select name="__campus">${options(state.campuses.map((c) => ({ value: c.id, label: c.name })), state.campusId, { blank: '—' })}</select></label>` : ''}</form>
    <h3 style="margin-top:14px">First few rows</h3>
    <div class="table-wrap"><table class="list small"><thead><tr>${pv.headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
      <tbody>${pv.sample.map((r) => html`<tr>${pv.headers.map((h) => html`<td>${r[h]}</td>`)}</tr>`)}</tbody></table></div>
    <div class="row end" style="margin-top:14px"><button class="btn" data-run="dry">Test import</button><button class="btn primary" data-run="real">Import</button></div>
    <div data-result style="margin-top:12px"></div>`);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-run]');
    if (!b) return;
    const m = formData(box.querySelector('[data-map]'));
    const campus = m.__campus || null;
    delete m.__campus;
    Object.keys(m).forEach((k) => !m[k] && delete m[k]);
    b.disabled = true;
    try {
      const r = await post('/import/people', { csv, mapping: m, campus_id: campus, dry_run: b.dataset.run === 'dry' });
      mount(box.querySelector('[data-result]'), html`<div class="alert ${r.dry_run ? 'info' : ''}">
        <b>${r.dry_run ? 'Test only, nothing was saved.' : 'Import finished.'}</b>
        ${r.created} new people, ${r.updated} updated, ${r.households} new households.
        ${r.skipped.length ? html`<br>Skipped ${r.skipped.length}: ${r.skipped.slice(0, 10).map((s) => `row ${s.row} (${s.reason})`).join(', ')}${r.skipped.length > 10 ? '…' : ''}` : ''}
        ${!r.dry_run ? html`<br><a href="#/people">Go to People →</a>` : ''}</div>`);
    } catch (err) { fail(err); } finally { b.disabled = false; }
  };
}
