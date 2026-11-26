// Admin settings: church, campuses, check-in & attendance, sign-in & accounts, and the people import.
import { api, get, post, patch, put, del, html, mount, icon, dialog, formData, exclusiveCampusBoxes, options, toast, fail, displayName, pickPerson, chips, confirm, fmtUtcDate } from '../lib.js';
import { state, setTitle, go, campusName, applyTheme } from '../app.js';
import { gradeLabel } from '../checkin-rules.js';
import { backups } from './settings-backups.js';

const TABS = [['church', 'Church'], ['campuses', 'Campuses'], ['checkin', 'Check-in & attendance'], ['fields', 'Profile fields'], ['accounts', 'Sign-in & accounts'], ['import', 'Import people'], ['backups', 'Backups'], ['checks', 'Checks']];

// An admin limited to some campuses (state.me.campusIds is a list) can't change church-wide things;
// the server refuses them, so these tabs are left out rather than shown as dead ends.
const limitedAdmin = () => Boolean(state.me?.campusIds);
const CHURCH_WIDE_TABS = ['church', 'fields', 'import', 'backups'];
export const SCOPE_NOTE = 'Some options are for admins who cover every campus.';

export default async function settings(el, tab = 'church') {
  setTitle('Settings');
  if (limitedAdmin() && CHURCH_WIDE_TABS.includes(tab)) tab = 'accounts';
  mount(el, html`<div class="tabs">${TABS.filter(([k]) => !limitedAdmin() || !CHURCH_WIDE_TABS.includes(k)).map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}</button>`)}</div><div data-panel></div>`);
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) go(`/settings/${b.dataset.tab}`); };
  const panel = el.querySelector('[data-panel]');
  // Old links (#/settings/rooms) land on the section that now holds them.
  const pages = { church, campuses, checkin, rooms: checkin, fields: profileFields, accounts, import: importPeople, backups, checks };
  await (pages[tab] || church)(panel);
}

const refreshCampuses = async () => { state.campuses = await get('/campuses'); };

// ---------------------------------------------------------------- church
async function save(changes) {
  await patch('/settings', changes);
  Object.assign(state.settings, changes);
  toast('Saved.');
}

async function church(panel) {
  const [s, video] = await Promise.all([get('/settings'), get('/calls/usage').catch(() => null)]);
  mount(panel, html`<form class="card stack" style="max-width:640px">
    <label class="field">Church name<input type="text" name="church_name" value="${s.church_name}" required></label>
    <div class="field"><span>Brand colour</span>
      <div class="color-row"><input type="color" name="brand_color" value="${s.brand_color}"><code data-hex>${s.brand_color}</code>
        <button type="button" class="btn small ghost" data-reset>Reset</button></div>
      <span class="muted small">Used for buttons, links and highlights everywhere, including check-in and the sign-in page.</span></div>
    <div class="row end"><button class="btn primary">Save</button></div>
  </form>
  <form class="card stack" style="max-width:640px" data-app>
    <h2 style="margin:0">App</h2>
    <p class="muted small" style="margin:0">People can install this site on their phone’s home screen (My Schedule shows them how). These set how it looks there and when it reminds volunteers.</p>
    <div class="row" style="align-items:center;gap:14px">
      <img src="/app-icon/192.png?v=${s.app_icon_version}" alt="App icon" width="72" height="72" style="border-radius:16px;border:1px solid var(--line)">
      <div class="stack" style="gap:6px"><label class="btn small">${icon('upload')} Upload icon<input type="file" accept="image/*" data-icon hidden></label>
        ${s.custom_app_icon ? html`<button type="button" class="btn small ghost" data-icon-reset>Use the default</button>` : ''}
        <span class="muted small">A square image, at least 512 × 512.</span></div>
    </div>
    <label class="field">Name under the icon<input type="text" name="app_short_name" value="${s.app_short_name}" maxlength="14" placeholder="${(s.church_name || '').split(' ')[0]}">
      <span class="muted small">Keep it short, about 12 letters.</span></label>
    <label class="field">Remind volunteers before they serve<select name="reminder_hours">${options([{ value: 0, label: 'Don’t send reminders' }, { value: 24, label: 'A day before' }, { value: 48, label: 'Two days before' }, { value: 72, label: 'Three days before' }, { value: 168, label: 'A week before' }], s.reminder_hours)}</select>
      <span class="muted small">People who haven’t replied are asked to accept or decline.</span></label>
    <div class="row end"><button class="btn primary">Save</button></div>
  </form>
  <form class="card stack" style="max-width:640px" data-video>
    <h2 style="margin:0">Video calls</h2>
    ${video?.configured
      ? html`<p class="small" style="margin:0"><span class="pill good">${icon('check')} Connected to Daily</span></p>
        <div><div class="row small"><b>${video.minutes.toLocaleString()} of ${video.limit.toLocaleString()} minutes</b> used this month<span class="spacer"></span><span class="muted">${video.left.toLocaleString()} left</span></div>
          <div class="meter"><span style="width:${Math.min(100, video.limit ? (100 * video.minutes) / video.limit : 100)}%" class="${video.left <= 0 ? 'bad' : video.minutes / (video.limit || 1) > 0.8 ? 'warn' : ''}"></span></div>
          <span class="muted small">A minute is one person on a call for one minute (a 10-person, 1-hour meeting is 600). Counts reset on the 1st.</span></div>`
      : html`<p class="small" style="margin:0"><span class="pill warn">Not set up</span> Calls in chats use Daily (daily.co). Add your Daily API key in Render as <code>MB_DAILY_API_KEY</code>; the README walks through it.</p>`}
    <label class="field">Monthly limit (minutes)<input type="number" name="video_minutes_limit" min="0" step="100" value="${s.video_minutes_limit}">
      <span class="muted small">Daily’s free plan includes 10,000 minutes a month. Keeping this at 9,000 or less keeps calls free: once it’s reached, new calls can’t start and calls going on end, until the 1st. 0 turns video calls off.</span></label>
    <div class="row end"><button class="btn primary">Save</button></div>
  </form>`);
  const vform = panel.querySelector('[data-video]');
  vform.onsubmit = async (e) => {
    e.preventDefault();
    try { await save({ video_minutes_limit: Math.max(0, Math.round(Number(vform.video_minutes_limit.value) || 0)) }); church(panel); } catch (err) { fail(err); }
  };
  const app = panel.querySelector('[data-app]');
  app.onsubmit = async (e) => {
    e.preventDefault();
    try { await save({ app_short_name: app.app_short_name.value.trim(), reminder_hours: Number(app.reminder_hours.value) }); } catch (err) { fail(err); }
  };
  app.querySelector('[data-icon]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      for (const size of [512, 192, 180]) await api('POST', `/app-icon/${size}`, await squarePng(file, size));
      toast('App icon updated. Installed apps pick it up the next time they update.');
      church(panel);
    } catch (err) { fail(err); }
  };
  app.querySelector('[data-icon-reset]')?.addEventListener('click', async () => {
    try { await del('/app-icon'); church(panel); } catch (err) { fail(err); }
  });
  const form = panel.querySelector('form');
  const preview = () => {
    panel.querySelector('[data-hex]').textContent = form.brand_color.value;
    applyTheme(state.me.theme, form.brand_color.value);
  };
  form.brand_color.oninput = preview;
  panel.querySelector('[data-reset]').onclick = () => { form.brand_color.value = '#135fd1'; preview(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await save(formData(form));
      document.querySelector('[data-church]').textContent = state.settings.church_name;
    } catch (err) { fail(err); }
  };
}

// Center-crops an image to a square PNG on white (home screens don't show transparency well).
function squarePng(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size, size);
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))), 'image/png');
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------- check-in & attendance
async function checkin(panel) {
  const s = await get('/settings');
  mount(panel, html`<div class="stack" style="max-width:820px">
    ${limitedAdmin() ? html`<div class="alert info small">Name tags and headcount areas are the same for every campus, so an admin who covers every campus changes them. Kids' rooms for your campus are below.</div>` : ''}
    ${limitedAdmin() ? '' : html`    <form class="card stack" data-labels>
      <h2>Name tags</h2>
      <label class="field">Label printer and size<select name="label_size">${options([
        { value: 'brother-62x29', label: 'Brother QL: 62 × 29 mm (DK-1209)' },
        { value: 'brother-62x100', label: 'Brother QL: 62 × 100 mm (DK-1202)' },
        { value: 'dymo-30252', label: 'DYMO 30252: 1⅛ × 3½ in' },
        { value: 'dymo-30256', label: 'DYMO 30256: 2⁵⁄₁₆ × 4 in' },
        { value: 'letter', label: 'Plain paper (no label printer)' },
      ], s.label_size)}</select></label>
      <label class="check"><input type="checkbox" name="checkin_print_parent_tag" ${s.checkin_print_parent_tag ? 'checked' : ''}> Print a parent pickup tag with each check-in</label>
      <div class="row end"><button class="btn primary">Save</button></div>
    </form>`}
    ${limitedAdmin() ? '' : html`<div class="card"><h2>Headcount areas</h2>
      <p class="muted small">The rooms you count on each service’s Attendance tab.</p><div data-areas></div></div>`}
    <div data-rooms></div>
  </div>`);
  if (panel.querySelector('[data-labels]')) panel.querySelector('[data-labels]').onsubmit = async (e) => {
    e.preventDefault();
    try { await save(formData(e.target)); } catch (err) { fail(err); }
  };
  if (panel.querySelector('[data-areas]')) chips(panel.querySelector('[data-areas]'), s.headcount_areas, (list) => save({ headcount_areas: list }).catch(fail), { placeholder: 'e.g. Balcony', addLabel: 'Add area' });
  await rooms(panel.querySelector('[data-rooms]'));
}

// ---------------------------------------------------------------- campuses
async function campuses(panel) {
  await refreshCampuses();
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Pacific/Honolulu')) : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Campuses</h2>${limitedAdmin() ? '' : html`<button class="btn primary" data-add>${icon('plus')} Add campus</button>`}</div>
    ${state.campuses.length ? html`<table class="list"><tbody>${state.campuses.map((c) => html`<tr class="${!limitedAdmin() || state.me.campusIds.includes(c.id) ? 'click' : ''}" data-id="${!limitedAdmin() || state.me.campusIds.includes(c.id) ? c.id : ''}">
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
        <label class="field wide">Take attendance opens with<select name="attendance_mode">${options([{ value: 'both', label: 'Names and headcount' }, { value: 'names', label: 'Names only (roll call)' }, { value: 'headcount', label: 'Headcount first' }], c.attendance_mode || 'both')}</select>
          <span class="muted small">What the Take attendance screen on a phone shows first at this campus.</span></label>
        ${c.id ? html`<label class="check wide"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Open (uncheck to hide a campus that has closed)</label>` : ''}</div>`,
      onSubmit: (f) => (c.id ? patch(`/campuses/${c.id}`, formData(f)) : post('/campuses', formData(f))),
    });
    if (ok) { await refreshCampuses(); location.reload(); }
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const tr = e.target.closest('tr[data-id]');
    if (tr && tr.dataset.id) edit(state.campuses.find((c) => c.id === Number(tr.dataset.id))); // other campuses aren't editable for a campus admin
  };
}

// ---------------------------------------------------------------- kids' rooms
const AGES = [0, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168, 180].map((m) => ({ value: m, label: m < 24 ? `${m} months` : `${m / 12} years` }));
const GRADES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => ({ value: g, label: gradeLabel(g) }));

async function rooms(panel) {
  const list = await get('/rooms');
  // A campus admin sees and adds rooms for their own campuses only (the server checks the same).
  const mine = state.campuses.filter((c) => !limitedAdmin() || state.me.campusIds.includes(c.id));
  const describe = (r) => [
    r.min_grade != null ? `${gradeLabel(r.min_grade)} – ${gradeLabel(r.max_grade)}` : '',
    r.min_age_months != null ? `ages ${AGES.find((a) => a.value === r.min_age_months)?.label ?? `${r.min_age_months} mo`} – ${AGES.find((a) => a.value === r.max_age_months)?.label ?? `${r.max_age_months} mo`}` : '',
  ].filter(Boolean).join(', or ');
  mount(panel, html`<div class="card">
    <div class="card-head"><h2>Kids’ rooms</h2><button class="btn primary" data-add>${icon('plus')} Add room</button></div>
    <p class="muted small">At check-in, school-age kids go to the room for their grade; younger kids go by age. Rooms are checked top to bottom.</p>
    ${mine.map((c) => html`<h3 style="margin-top:14px">${c.name}</h3>${list.filter((r) => r.campus_id === c.id).length
      ? html`<table class="list"><tbody>${list.filter((r) => r.campus_id === c.id).map((r) => html`<tr class="click" data-id="${r.id}"><td><b>${r.name}</b></td><td class="muted small">${describe(r)}</td><td class="muted small">${r.capacity ? `Max ${r.capacity}` : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="muted small">No rooms yet.</p>`}`)}
  </div>`);
  const edit = async (r = {}) => {
    const ok = await dialog({
      title: r.id ? r.name : 'New room',
      body: html`<div class="form">
        <label class="field">Campus<select name="campus_id" ${r.id ? 'disabled' : ''}>${options(mine.map((c) => ({ value: c.id, label: c.name })), r.campus_id ?? state.campusId)}</select></label>
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

// ---------------------------------------------------------------- profile fields
const TYPE_LABELS = { text: 'Short text', longtext: 'Paragraph', date: 'Date', yesno: 'Yes / no', choice: 'One choice (steps)', multi: 'Several choices', number: 'Number' };

async function profileFields(panel) {
  const fields = await get('/profile-fields?all=1');
  const sections = [...new Set(fields.map((f) => f.section))];
  mount(panel, html`<div class="card" style="max-width:900px">
    <div class="card-head"><h2>Profile fields</h2><button class="btn primary" data-add>${icon('plus')} Add field</button></div>
    <p class="muted small">Things you track for each person: milestones, classes, leadership steps and anything else.
      They show on each profile, grouped by section, and you can filter People by them. Drag to reorder.</p>
    ${sections.map((sec) => html`<h3 style="margin-top:16px">${sec}</h3>
      <div data-sortable>${fields.filter((f) => f.section === sec).map((f) => html`<div class="field-row ${f.archived ? 'archived' : ''}" draggable="true" data-id="${f.id}">
        <span class="grip">${icon('grip')}</span>
        <span><b>${f.label}</b> <span class="muted small">${TYPE_LABELS[f.type]}${f.visibility === 'staff' ? ' · staff only' : ''}${f.archived ? ' · hidden' : ''}</span>
          ${f.options.length ? html`<div class="small muted">${f.options.join(' · ')}</div>` : ''}</span>
        <button class="btn small" data-edit="${f.id}">${icon('edit')} Edit</button></div>`)}</div>`)}
    ${!fields.length ? html`<div class="empty">No fields yet.</div>` : ''}
  </div>`);

  const edit = async (f = { type: 'text', section: sections[0] || 'Spiritual journey', options: [], visibility: 'leader' }) => {
    let opts = [...f.options];
    const ok = await dialog({
      title: f.id ? `Edit “${f.label}”` : 'New profile field', wide: true,
      body: html`<div class="form">
        <label class="field">Name<input type="text" name="label" value="${f.label || ''}" required placeholder="Date of baptism"></label>
        <label class="field">Section<input type="text" name="section" value="${f.section}" list="sections" required>
          <datalist id="sections">${sections.map((x) => html`<option value="${x}">`)}</datalist></label>
        <label class="field">Kind of answer<select name="type">${options(Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })), f.type)}</select></label>
        <label class="field">Who can see it<select name="visibility">${options([{ value: 'leader', label: 'Leaders and staff' }, { value: 'staff', label: 'Staff only' }], f.visibility)}</select></label>
        <div class="field wide" data-opts-wrap><span>Choices <span class="muted small">(in order: for steps, list them first to last)</span></span><div data-opts></div></div>
        ${f.id ? html`<label class="check wide"><input type="checkbox" name="archived" ${f.archived ? 'checked' : ''}> Hide this field (answers are kept)</label>` : ''}
      </div>`,
      onOpen: (d) => {
        const sel = d.querySelector('[name=type]');
        const wrap = d.querySelector('[data-opts-wrap]');
        const sync = () => wrap.classList.toggle('hidden', !['choice', 'multi'].includes(sel.value));
        sel.onchange = sync;
        sync();
        chips(d.querySelector('[data-opts]'), opts, (list) => { opts = list; }, { placeholder: 'Add a choice', addLabel: 'Add' });
      },
      onSubmit: (form) => {
        const b = formData(form);
        const pending = form.querySelector('[data-new]')?.value.trim();
        if (pending && !opts.includes(pending)) opts.push(pending);
        const body = { ...b, options: ['choice', 'multi'].includes(b.type) ? opts : [] };
        return f.id ? patch(`/profile-fields/${f.id}`, body) : post('/profile-fields', body);
      },
    });
    if (ok) profileFields(panel);
  };

  let dragging = null;
  panel.ondragstart = (e) => { dragging = e.target.closest('.field-row'); };
  panel.ondragover = (e) => {
    e.preventDefault();
    const over = e.target.closest('.field-row');
    if (!dragging || !over || over === dragging || over.parentElement !== dragging.parentElement) return;
    over[e.clientY > over.getBoundingClientRect().top + over.offsetHeight / 2 ? 'after' : 'before'](dragging);
  };
  panel.ondragend = async () => {
    if (!dragging) return;
    dragging = null;
    try { await put('/profile-fields/order', { ids: [...panel.querySelectorAll('.field-row')].map((r) => Number(r.dataset.id)) }); } catch (e) { fail(e); }
  };
  panel.onclick = (e) => {
    if (e.target.closest('[data-add]')) return edit();
    const b = e.target.closest('[data-edit]');
    if (b) edit(fields.find((f) => f.id === Number(b.dataset.edit)));
  };
}

// ---------------------------------------------------------------- accounts
async function accounts(panel, q = '') {
  const [list, s, auth] = await Promise.all([get(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`), get('/settings'), fetch('/auth/options').then((r) => r.json()).catch(() => ({}))]);
  const users = list.users;
  const roleHelp = {
    volunteer: 'Their own schedule and the services they serve at',
    leader: 'Also people, teams, scheduling their teams, check-in',
    staff: 'Also edits people, services, rooms and all scheduling',
    admin: 'Everything, including settings and accounts',
  };
  const limited = limitedAdmin();
  const mine = state.me.campusIds || [];
  mount(panel, html`${limited ? html`<div class="alert small" data-scope-note>${SCOPE_NOTE} You can manage accounts for your own campuses.</div>` : html`<form class="card stack" style="max-width:820px" data-signin>
    <h2>Who can sign in</h2>
    ${auth.email === false ? html`<div class="alert warn small">Email sign-in (codes and passwords) isn’t set up yet, so people can only use Google. Add <code>MB_SMTP_USER</code> and <code>MB_SMTP_PASS</code> in your host’s settings (see README → Email).</div>` : ''}
    <label class="field">On their own, with Google or their email<select name="sign_in_policy">${options([
      { value: 'anyone', label: 'Anyone: people in People, and new people (added to People)' },
      { value: 'directory', label: 'Only people whose email is in People, and church accounts' },
      { value: 'domain', label: 'Church Google accounts only' },
      { value: 'invited', label: 'Only accounts an admin adds below' },
    ], s.sign_in_policy)}</select>
      <span class="muted small">Everyone starts as a volunteer: their own schedule and the services they serve at. With “Anyone”, people new to the church can create an account in the app and are added to People for you to welcome.</span></label>
    <label class="field">Church Google domain<input type="text" name="workspace_domain" value="${s.workspace_domain}" placeholder="mbclife.church">
      <span class="muted small">Used by the “church accounts” options.</span></label>
    <h2 style="margin-top:8px">Who can make changes</h2>
    <label class="field">Edit orders of service<select name="plan_edit_role">${options([
      { value: 'leader', label: 'Leaders, staff and admins' },
      { value: 'staff', label: 'Staff and admins' },
      { value: 'admin', label: 'Admins only' },
    ], s.plan_edit_role)}</select></label>
    <label class="field">Schedule volunteers<select name="schedule_role">${options([
      { value: 'team_leaders', label: 'Team leaders (their own teams), staff and admins' },
      { value: 'staff', label: 'Staff and admins' },
      { value: 'admin', label: 'Admins only' },
    ], s.schedule_role)}</select>
      <span class="muted small">Staff can also <b>Lock</b> a single service so only admins can change it.</span></label>
    <div class="row end"><button class="btn primary">Save</button></div>
  </form>`}
  ${list.duplicate_links?.length ? html`<div class="card" style="margin-top:14px" data-duplicates>
    <h2>${list.duplicate_links.length === 1 ? 'One person has' : `${list.duplicate_links.length} people have`} more than one account</h2>
    <p class="muted small">Each person should have one account. Nothing has been changed. For each person below, decide which account should stay linked, then press <b>Find</b> next to the other one, open it and choose <b>Unlink</b>. Please don’t delete accounts to fix this. Once it’s sorted out, the hub enforces the rule by itself.</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>Person</th><th>Accounts</th></tr></thead><tbody>
    ${list.duplicate_links.map((d) => html`<tr><td>${d.name || 'Person'} <span class="muted small">#${d.person_id}</span></td>
      <td>${d.accounts.map((a) => html`<div class="small">${a.email} <span class="pill">${a.role}</span>${a.active ? '' : html` <span class="pill bad">Disabled</span>`} <span class="muted">last sign-in ${a.last_login ? fmtUtcDate(a.last_login) : 'never'}</span> <button class="btn small ghost" data-find="${a.email}">Find</button></div>`)}</td></tr>`)}
    </tbody></table></div></div>` : ''}
  <div class="card" style="margin-top:14px">
    <div class="card-head"><h2>Accounts with more access</h2><button class="btn primary" data-add>${icon('plus')} Add account</button></div>
    <p class="muted small">Whoever the sign-in option above allows can sign in as a volunteer: no account needed. ${list.volunteers} volunteer accounts so far. A new account is never linked to a person automatically; you link it below. Add someone here to give them more access, even before their first sign-in, or search to find any account.</p>
    <form class="row" data-search style="margin-bottom:8px"><input type="search" name="q" value="${q}" placeholder="Search all accounts by name or email" style="flex:1"><button class="btn">Search</button>${q ? html`<button type="button" class="btn ghost" data-clear>Clear</button>` : ''}</form>
    <div class="table-wrap"><table class="list"><thead><tr><th>Email</th><th>Person</th><th>Access</th><th>Campuses</th><th>Last sign-in</th></tr></thead><tbody>
    ${users.length ? '' : html`<tr><td colspan="5" class="muted">${q ? 'No accounts match.' : 'No one has more than volunteer access yet.'}</td></tr>`}
    ${users.map((u) => html`<tr class="click" data-id="${u.id}"><td>${u.email}${u.active ? '' : html` <span class="pill bad">Disabled</span>`}</td>
      <td>${u.first_name ? `${u.first_name} ${u.last_name}` : html`<span class="pill warn">Not linked</span>`}</td>
      <td><span class="pill">${u.role}</span>${u.finance ? html` <span class="pill info">Finance</span>` : ''}${u.announce ? html` <span class="pill info">Announcements</span>` : ''}${u.attendance ? html` <span class="pill info">Attendance</span>` : ''}${u.checkin && !['staff', 'admin'].includes(u.role) ? html` <span class="pill info">Check-in</span>` : ''}</td><td class="small muted">${u.campus_ids ? u.campus_ids.map(campusName).join(', ') : 'All'}</td>
      <td class="small muted">${u.last_login ? fmtUtcDate(u.last_login) : 'Never'}</td></tr>`)}
    </tbody></table></div></div>
  <div class="card" style="margin-top:14px" data-unlinked>
    <h2>Accounts not linked to a person</h2>
    <p class="muted small">These people can sign in, but their account isn’t connected to anyone in People, so they see no schedule. Nothing is linked automatically. Where the email matches one person in People you’ll see them suggested, and you confirm; otherwise choose the right person for each one.</p>
    ${list.unlinked.length ? list.unlinked.map((u) => html`<div class="row" style="flex-wrap:wrap;gap:8px;padding:8px 0;border-top:1px solid var(--line, rgba(128,128,128,.25))">
      <div style="flex:1;min-width:200px"><span style="overflow-wrap:anywhere">${u.email}</span> <span class="pill">${u.role}</span>
        ${u.suggestion ? html`<div class="small muted">Same email as ${u.suggestion.name}${u.suggestion.campus_short ? ` (${u.suggestion.campus_short})` : ''}${u.suggestion.note ? `, ${u.suggestion.note}` : ''}</div>` : ''}
        <div class="small muted">${u.link_requested_at ? `Asked to be linked ${fmtUtcDate(u.link_requested_at)} · ` : ''}Last sign-in ${u.last_login ? fmtUtcDate(u.last_login) : 'never'}</div></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${u.suggestion && u.suggestion.note !== 'already has an account' ? html`<button class="btn small primary" data-link-suggested="${u.id}">Link to ${u.suggestion.name}</button>` : ''}<button class="btn small" data-link-account="${u.id}">Link to person…</button></div></div>`) : html`<p class="muted">Every account is linked to a person.</p>`}
  </div>
  ${list.shared_emails?.length ? html`<details class="card" style="margin-top:14px" data-shared-emails>
    <summary><b>People sharing an email</b> <span class="muted small">${list.shared_emails.length} ${list.shared_emails.length === 1 ? 'email' : 'emails'}</span></summary>
    <p class="muted small">An email that belongs to more than one person can’t be matched to an account automatically, and a sign-in could be linked to the wrong person. Open each person and give them their own email, or remove it. Nothing here changes by itself.</p>
    ${list.shared_emails.map((g) => html`<div style="padding:8px 0;border-top:1px solid var(--line, rgba(128,128,128,.25))"><div class="small" style="overflow-wrap:anywhere"><b>${g.email}</b></div>
      ${g.people.map((p) => html`<div class="small"><a href="#/people/${p.id}">${p.name}</a>${p.campus ? html` <span class="muted">· ${p.campus}</span>` : ''}</div>`)}</div>`)}
  </details>` : ''}`);
  const signin = panel.querySelector('[data-signin]');
  if (signin) signin.onsubmit = async (e) => {
    e.preventDefault();
    try { await save(formData(e.target)); } catch (err) { fail(err); }
  };
  const edit = async (u = { role: 'volunteer', active: 1, campus_ids: limited ? [...mine] : null }) => {
    let campusTouched = !u.id; // a limited admin sends the campus list only when it was changed
    let personId = u.person_id ?? null;
    let personLabel = u.first_name ? `${u.first_name} ${u.last_name}` : '';
    const ok = await dialog({
      title: u.id ? u.email : 'Add account',
      body: html`<div class="stack">
        ${u.id ? '' : html`<label class="field">Email<input type="email" name="email" required></label>`}
        <label class="field">Access<select name="role">${options(Object.keys(roleHelp).filter((r) => !limited || r !== 'admin').map((r) => ({ value: r, label: `${r[0].toUpperCase()}${r.slice(1)} — ${roleHelp[r]}` })), u.role)}</select></label>
        <div class="field"><span>Campuses</span>
          <label class="check"><input type="checkbox" name="all" ${!u.campus_ids ? 'checked' : ''} ${limited ? 'disabled' : ''}> All campuses</label>
          ${state.campuses.map((c) => html`<label class="check"><input type="checkbox" data-campus="${c.id}" ${u.campus_ids?.includes(c.id) ? 'checked' : ''} ${limited && !mine.includes(c.id) ? 'disabled' : ''}> ${c.name}</label>`)}</div>
        ${limited ? html`<p class="muted small" style="margin:0">${SCOPE_NOTE}</p>` : ''}
        <label class="check"><input type="checkbox" name="finance" ${u.finance ? 'checked' : ''} ${limited ? 'disabled' : ''}> <span><b>Finance</b>: sees giving (who gave and how much), records gifts, sends statements. Separate from Access above: admins don’t see giving without it.</span></label>
        <label class="check"><input type="checkbox" name="announce" ${u.announce ? 'checked' : ''} ${limited ? 'disabled' : ''}> <span><b>Announcements</b>: sends notifications to the congregation from the hub (everyone, a campus or a team). Admins can always.</span></label>
        <label class="check"><input type="checkbox" name="attendance" ${u.attendance ? 'checked' : ''}> <span><b>Attendance</b>: can take attendance (roll call, families, new guests, headcounts) at the campuses ticked above, and nothing else. Leaders and above already can. Needs a campus ticked.</span></label>
        <label class="check"><input type="checkbox" name="checkin" ${u.checkin ? 'checked' : ''}> <span><b>Kids’ check-in</b>: a leader can open check-in and the family list (children’s allergies and medical notes) on this account. For children’s ministry people only. Staff, admins and paired check-in iPads always can.</span></label>
        <div class="row"><span>Person: <b data-person>${personLabel || 'not linked'}</b></span><button type="button" class="btn small" data-link>Link to person…</button>${personId ? html`<button type="button" class="btn small ghost" data-unlink>Unlink</button>` : ''}</div>
        ${u.id ? html`<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Can sign in</label>` : ''}
        ${u.id ? html`<p class="muted small" style="margin:0">${u.has_password ? 'Signs in with email and password (or Google).' : 'Hasn’t set a password; signs in with Google or an emailed code.'}</p>
          <div><button type="button" class="btn danger small" data-delete>${icon('trash')} Delete account</button></div>` : ''}
      </div>`,
      onOpen: (d, close) => {
        exclusiveCampusBoxes(d, () => { campusTouched = true; });
        d.querySelector('[data-delete]')?.addEventListener('click', async () => {
          if (!(await confirm('Delete this account?', `${u.email} can’t sign in until they set up again (as a volunteer, if they’re in People). Their record in People, attendance and serving history stay.`))) return;
          try { await del(`/users/${u.id}`); toast('Account deleted.'); close('deleted'); } catch (err) { fail(err); }
        });
        d.querySelector('[data-unlink]')?.addEventListener('click', (e) => {
          personId = null; d.querySelector('[data-person]').textContent = 'not linked'; e.target.remove();
        });
        d.querySelector('[data-link]').onclick = async () => {
          const p = await pickPerson('Link to which person?');
          if (p) { personId = p.id; d.querySelector('[data-person]').textContent = displayName(p); }
        };
      },
      onSubmit: (f) => {
        const b = formData(f);
        const body = { role: b.role, person_id: personId, finance: b.finance, announce: b.announce, attendance: b.attendance, checkin: b.checkin, campus_ids: b.all ? 'all' : [...f.querySelectorAll('[data-campus]:checked')].map((c) => Number(c.dataset.campus)) };
        if (limited) { delete body.finance; delete body.announce; if (!campusTouched) delete body.campus_ids; } // disabled for them; the server refuses changes
        if (u.id) body.active = b.active;
        else body.email = b.email;
        return u.id ? patch(`/users/${u.id}`, body) : post('/users', body);
      },
    });
    if (ok) accounts(panel, q);
  };
  panel.querySelector('[data-search]').onsubmit = (e) => { e.preventDefault(); accounts(panel, e.target.q.value.trim()); };
  panel.onclick = async (e) => {
    const findBtn = e.target.closest('[data-find]');
    if (findBtn) return accounts(panel, findBtn.dataset.find);
    const linkBtn = e.target.closest('[data-link-account]');
    if (linkBtn) {
      const u = list.unlinked.find((x) => x.id === Number(linkBtn.dataset.linkAccount));
      const p = await pickPerson(`Link ${u.email} to which person?`);
      if (!p) return;
      if (!(await dialog({ title: `Link this account to ${displayName(p)}?`, body: html`<p>${u.email} will see ${displayName(p)}’s schedule, teams and chats. Only link it if you’re sure this account belongs to them.</p>`, submit: 'Link' }))) return;
      try { await patch(`/users/${u.id}`, { person_id: p.id }); toast('Account linked.'); accounts(panel, q); } catch (err) { fail(err); }
      return;
    }
    const suggBtn = e.target.closest('[data-link-suggested]');
    if (suggBtn) {
      const u = list.unlinked.find((x) => x.id === Number(suggBtn.dataset.linkSuggested));
      const sg = u.suggestion;
      if (!(await dialog({ title: `Link this account to ${sg.name}?`, body: html`<p>${u.email} will see ${sg.name}’s schedule, teams and chats. Only link it if you’re sure this account belongs to them.</p>`, submit: 'Link' }))) return;
      try { await patch(`/users/${u.id}`, { person_id: sg.person_id }); toast('Account linked.'); accounts(panel, q); } catch (err) { fail(err); }
      return;
    }
    if (e.target.closest('[data-clear]')) return accounts(panel);
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
    <form class="form" data-map>${pv.fields.map((f) => html`<label class="field">${FIELD_LABELS[f] || pv.labels?.[f] || f}<select name="${f}">${options(pv.headers.map((h) => ({ value: h, label: h })), pv.mapping[f], { blank: '— skip —' })}</select></label>`)}
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

// ---------------------------------------------------------------- checks
// Is this server set up safely for real use? Yes/no checks from the server; no secrets shown.
async function checks(panel) {
  const c = await get('/admin/production-checks');
  const pill = { ok: ['good', 'Yes'], warn: ['warn', 'Check'], bad: ['bad', 'No'], info: ['info', 'Info'] };
  mount(panel, html`<div class="card stack" style="max-width:820px">
    <h2 style="margin:0">Checks</h2>
    <p class="muted small" style="margin:0">${c.hosted ? 'This server is hosted, so these are the settings for real use.' : 'This isn’t the hosted server, so some checks are for information only.'} Settings marked “No” must be fixed before staff use the hub.</p>
    ${c.ready ? html`<div class="alert good small">Nothing here blocks real use.</div>` : html`<div class="alert bad small">Some checks say “No”. Fix those first.</div>`}
    <table class="list"><tbody>${c.checks.map((x) => html`<tr>
      <td style="width:5.5em"><span class="pill ${pill[x.status][0]}">${pill[x.status][1]}</span></td>
      <td><b>${x.label}</b><div class="muted small">${x.detail}</div></td></tr>`)}</tbody></table>
  </div>`);
}
