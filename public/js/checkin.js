// Kids check-in station. Works offline: it keeps a copy of the family roster and queues
// check-ins until the connection is back. Check-in ids and pickup codes are made here, so
// a queued check-in syncs exactly once however many times it is re-sent.
import { html, mount, avatar, displayName, dialog, options, toast, fail, esc } from './lib.js';
import { roomFor, securityCode, ageLabel, gradeLabel, digitsOnly } from './checkin-rules.js';

const KEY = {
  station: 'mb.checkin.station',
  roster: (campusId) => `mb.checkin.roster.${campusId}`,
  queue: 'mb.checkin.queue',
  today: (campusId, day) => `mb.checkin.today.${campusId}.${day}`,
};

const LABELS = {
  'brother-62x29': { w: '62mm', h: '29mm', pad: '1.5mm 2.5mm', name: '20pt', small: '8pt', code: '14pt' },
  'brother-62x100': { w: '62mm', h: '100mm', pad: '4mm', name: '30pt', small: '11pt', code: '22pt' },
  'dymo-30252': { w: '3.5in', h: '1.125in', pad: '0.06in 0.12in', name: '20pt', small: '8pt', code: '14pt' },
  'dymo-30256': { w: '4in', h: '2.3125in', pad: '0.12in', name: '30pt', small: '11pt', code: '22pt' },
  letter: { w: '3.5in', h: '2in', pad: '0.15in', name: '26pt', small: '10pt', code: '18pt', page: 'letter' },
};

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('This device is out of storage space.', 'bad'); } },
};

const state = { station: store.get(KEY.station, null), roster: null, mode: 'in', online: navigator.onLine, authed: true, campuses: [] };
const $main = document.querySelector('[data-main]');

async function call(method, url, body) {
  const res = await fetch('/api' + url, { method, headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { state.authed = false; drawStatus(); throw Object.assign(new Error('Signed out. Sign in again to sync.'), { status: 401 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

// ---------------------------------------------------------------- startup
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('online', () => { state.online = true; drawStatus(); sync(); refreshRoster(); });
  window.addEventListener('offline', () => { state.online = false; drawStatus(); });
  document.querySelector('[data-modes]').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
  document.querySelector('[data-setup]').onclick = setup;
  try {
    state.campuses = await call('GET', '/campuses');
  } catch (e) {
    if (e.status === 401 && !state.station) { location.href = '/login'; return; }
  }
  if (!state.station) { await setup(); return; }
  state.roster = store.get(KEY.roster(state.station.campusId), null);
  await refreshRoster();
  if (!state.roster) { mount($main, html`<div class="alert bad">This station has no family list yet. Connect to the internet and reload.</div>`); return; }
  drawHeader();
  setMode('in');
  sync();
  setInterval(sync, 30000);
  setInterval(refreshRoster, 10 * 60000);
}

async function refreshRoster() {
  if (!state.station || !navigator.onLine) return;
  try {
    state.roster = await call('GET', `/checkin/roster?campus_id=${state.station.campusId}`);
    store.set(KEY.roster(state.station.campusId), state.roster);
    state.authed = true;
    // Merge the server's list of today's check-ins (other stations) into ours.
    const active = await call('GET', `/checkin/active?campus_id=${state.station.campusId}`);
    const mine = todays();
    const byId = new Map(mine.map((c) => [c.id, c]));
    for (const a of active) byId.set(a.id, { ...byId.get(a.id), ...a, synced: true });
    saveToday([...byId.values()]);
    drawStatus();
  } catch (e) {
    if (e.status !== 401) console.warn('Roster refresh failed', e);
  }
}

async function setup() {
  const camps = state.campuses.filter((c) => c.active);
  if (!camps.length) { mount($main, html`<div class="alert bad">Sign in, and make sure at least one campus is set up in Settings.</div>`); return; }
  const cur = state.station || {};
  let saved;
  await dialog({
    title: 'Set up this check-in station', submit: 'Start checking in', cancel: state.station ? 'Cancel' : null,
    body: html`<div class="stack">
      <label class="field">Campus<select name="campus">${options(camps.map((c) => ({ value: c.id, label: c.name })), cur.campusId)}</select></label>
      <label class="field">Station name (printed on labels)<input type="text" name="name" value="${cur.name || 'Welcome desk'}" required></label>
      <label class="check"><input type="checkbox" name="print" ${cur.print !== false ? 'checked' : ''}> Print name tags</label>
      <p class="muted small">Keep this tablet signed in. If the internet drops, check-in keeps working and catches up when it’s back.</p></div>`,
    onSubmit: (f) => {
      saved = { campusId: Number(f.campus.value), name: f.name.value.trim(), print: f.print.checked };
    },
  });
  if (!saved) return;
  state.station = saved;
  store.set(KEY.station, saved);
  location.reload();
}

function drawHeader() {
  const c = state.roster.campus;
  document.querySelector('[data-church]').textContent = state.roster.church_name || 'Kids Check-in';
  document.querySelector('[data-where]').textContent = `${c.name} · ${state.station.name}`;
  document.title = `Check-in · ${c.name}`;
  drawStatus();
}

function drawStatus() {
  const q = store.get(KEY.queue, []).length;
  mount(document.querySelector('[data-status]'), html`
    ${state.online ? html`<span class="k-online">● Online</span>` : html`<span class="k-offline">● Offline: still checking in</span>`}
    ${q ? html`<span class="k-pending">${q} waiting to sync</span>` : ''}
    ${!state.authed ? html`<a class="btn small" href="/login">Sign in to sync</a>` : ''}`);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  ({ in: drawSearch, out: drawCheckout, rooms: drawRooms })[mode]();
}

// ---------------------------------------------------------------- today's check-ins (local + server)
const day = () => state.roster.today;
const todays = () => store.get(KEY.today(state.station.campusId, day()), []);
const saveToday = (list) => store.set(KEY.today(state.station.campusId, day()), list);

// ---------------------------------------------------------------- check in
function drawSearch() {
  mount($main, html`<input class="k-search" type="search" data-q placeholder="Last 4 of phone, or last name" autocomplete="off" inputmode="search">
    <p class="k-hint">Type the last four digits of a parent’s phone number, or the family’s last name.</p>
    <div class="k-results" data-results></div>
    <p class="k-hint" style="margin-top:28px">First time here? <button class="btn small" data-new-family>Add a new family</button></p>`);
  const q = $main.querySelector('[data-q]');
  q.focus();
  q.oninput = () => drawResults(q.value);
  $main.querySelector('[data-new-family]').onclick = newFamily;
}

function findFamilies(query) {
  const q = query.trim().toLowerCase();
  const d = digitsOnly(q);
  if (q.length < 2) return [];
  return state.roster.households.filter((h) => {
    const phones = [h.phone, ...h.members.map((m) => m.phone)].map(digitsOnly).filter(Boolean);
    if (d.length >= 4 && d.length === q.replace(/[\s()-]/g, '').length) return phones.some((p) => p.endsWith(d) || p.includes(d));
    return h.name.toLowerCase().includes(q) || h.members.some((m) => `${m.first_name} ${m.last_name} ${m.nickname}`.toLowerCase().includes(q));
  }).slice(0, 12);
}

function drawResults(query) {
  const fams = findFamilies(query);
  const box = $main.querySelector('[data-results]');
  mount(box, fams.length ? fams.map((h) => html`<button class="k-family" data-h="${h.id}"><b>${h.name}</b>
      <span class="muted">${h.members.filter((m) => m.household_role === 'child').map((m) => m.nickname || m.first_name).join(', ')}</span></button>`)
    : query.trim().length >= 2 ? html`<p class="k-hint">No family found.</p>` : '');
  box.onclick = (e) => { const b = e.target.closest('[data-h]'); if (b) drawFamily(state.roster.households.find((h) => h.id === Number(b.dataset.h))); };
}

function currentService() {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const list = state.roster.services || [];
  // The service that's on now or next; otherwise the last one today.
  return list.find((s) => {
    const end = new Date(`${s.starts_at}:00`);
    end.setMinutes(end.getMinutes() + s.duration_min);
    return end.toTimeString().slice(0, 5) >= hhmm;
  }) || list[list.length - 1] || null;
}

function drawFamily(h) {
  const kids = h.members.filter((m) => m.household_role === 'child');
  const adults = h.members.filter((m) => m.household_role !== 'child');
  const already = new Set(todays().filter((c) => !c.checked_out_at).map((c) => c.person_id));
  const services = state.roster.services || [];
  const svc = currentService();
  mount($main, html`<div class="row"><button class="btn" data-back>← Back</button><h1 style="margin-left:6px">${h.name}</h1></div>
    <div class="k-kids">${kids.map((k) => {
      const room = roomFor(k, state.roster.rooms, day());
      const done = already.has(k.id);
      return html`<label class="k-kid ${done ? 'done' : 'on'}">
        <input type="checkbox" data-kid="${k.id}" ${done ? '' : 'checked'}>${avatar(k)}
        <span class="info"><b>${displayName(k)}</b> <span class="muted">${ageLabel(k.birthdate, day())}${k.grade != null ? ` · ${gradeLabel(k.grade)}` : ''}</span>
          ${k.allergies ? html`<br><span class="allergy">⚠ ${k.allergies}</span>` : ''}
          ${done ? html`<br><span class="muted">Already checked in</span>` : ''}</span>
        <span class="room ${room ? '' : 'none'}">${room ? room.name : 'No room fits'}</span>
        ${state.roster.rooms.length > 1 ? html`<select data-room="${k.id}" style="width:auto" aria-label="Room">${options(state.roster.rooms.map((r) => ({ value: r.id, label: r.name })), room?.id, { blank: 'Room…' })}</select>` : ''}
      </label>`;
    })}</div>
    ${!kids.length ? html`<p class="k-hint">No children in this household yet.</p>` : ''}
    ${services.length > 1 ? html`<label class="field" style="max-width:320px">Service<select data-service>${options(services.map((s) => ({ value: s.id, label: `${new Date(`${s.starts_at}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${s.title ? ` · ${s.title}` : ''}` })), svc?.id)}</select></label>` : ''}
    <div class="row" style="margin-top:18px">
      <button class="btn primary k-big" data-go>${state.station.print ? 'Check in & print' : 'Check in'}</button>
      <button class="btn k-big" data-add-kid>+ Add a child</button>
      <span class="spacer"></span>
      <span class="muted small">Pickup: ${adults.map((a) => displayName(a)).join(', ')}${h.pickups.length ? `, ${h.pickups.map((p) => p.name).join(', ')}` : ''}</span>
    </div>`);
  $main.querySelector('[data-back]').onclick = drawSearch;
  $main.querySelectorAll('.k-kid input').forEach((i) => { i.onchange = () => i.closest('.k-kid').classList.toggle('on', i.checked); });
  $main.querySelector('[data-add-kid]').onclick = () => addChild(h);
  $main.querySelector('[data-go]').onclick = () => {
    const chosen = [...$main.querySelectorAll('[data-kid]:checked')].map((i) => {
      const kid = kids.find((k) => k.id === Number(i.dataset.kid));
      const sel = $main.querySelector(`[data-room="${kid.id}"]`);
      const room = sel?.value ? state.roster.rooms.find((r) => r.id === Number(sel.value)) : roomFor(kid, state.roster.rooms, day());
      return { kid, room };
    });
    if (!chosen.length) { toast('Pick at least one child.'); return; }
    const serviceId = Number($main.querySelector('[data-service]')?.value) || svc?.id || null;
    checkIn(h, chosen, serviceId);
  };
}

function checkIn(h, chosen, serviceId) {
  // One pickup code per family per check-in, so parents carry a single tag.
  const existing = todays().find((c) => c.household_id === h.id && !c.checked_out_at)?.security_code;
  const code = existing || securityCode(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
  const at = new Date().toISOString();
  const records = chosen.map(({ kid, room }) => ({
    id: crypto.randomUUID(), person_id: kid.id, room_id: room?.id ?? null, service_id: serviceId,
    kind: 'kid', security_code: code, station: state.station.name, checked_in_at: at,
  }));
  store.set(KEY.queue, [...store.get(KEY.queue, []), ...records]);
  saveToday([...todays(), ...records.map((r, i) => ({
    ...r, household_id: h.id, first_name: chosen[i].kid.first_name, last_name: chosen[i].kid.last_name, nickname: chosen[i].kid.nickname,
    allergies: chosen[i].kid.allergies, medical_notes: chosen[i].kid.medical_notes, room_name: chosen[i].room?.name ?? null, synced: false,
  }))]);
  drawStatus();
  sync();
  if (state.station.print) printLabels(h, chosen, code);
  mount($main, html`<div class="card" style="text-align:center;max-width:520px;margin:30px auto">
    <h1>${chosen.map((c) => c.kid.nickname || c.kid.first_name).join(' & ')} ${chosen.length > 1 ? 'are' : 'is'} checked in</h1>
    <p class="muted">Pickup code</p><div class="k-code">${code}</div>
    ${chosen.map((c) => html`<div>${c.kid.nickname || c.kid.first_name}: <b>${c.room?.name || 'room to be assigned'}</b></div>`)}
    <div class="row" style="justify-content:center;margin-top:20px">
      ${state.station.print ? html`<button class="btn k-big" data-reprint>Print again</button>` : ''}
      <button class="btn primary k-big" data-done>Done</button></div></div>`);
  $main.querySelector('[data-done]').onclick = drawSearch;
  $main.querySelector('[data-reprint]')?.addEventListener('click', () => printLabels(h, chosen, code));
  setTimeout(() => { if ($main.querySelector('[data-done]')) drawSearch(); }, 20000);
}

async function sync() {
  const queue = store.get(KEY.queue, []);
  if (!queue.length || !navigator.onLine || !state.station) { drawStatus(); return; }
  const batch = queue.slice(0, 200);
  try {
    const saved = await call('POST', '/checkin/checkins', { campus_id: state.station.campusId, records: batch });
    const sent = new Set(batch.map((r) => r.id));
    store.set(KEY.queue, store.get(KEY.queue, []).filter((r) => !sent.has(r.id)));
    const byId = new Map(saved.map((s) => [s.id, s]));
    saveToday(todays().map((c) => (byId.has(c.id) ? { ...c, room_id: byId.get(c.id).room_id, synced: true } : c)));
    state.online = true;
    state.authed = true;
    if (store.get(KEY.queue, []).length) return sync();
  } catch (e) {
    // No status means the request never reached the server.
    if (!e.status) state.online = false;
  }
  drawStatus();
}

// ---------------------------------------------------------------- new families and children (online only)
async function newFamily() {
  if (!navigator.onLine) { toast('Adding a family needs the internet. Write their details down and add them later.', 'bad'); return; }
  let household;
  await dialog({
    title: 'New family', submit: 'Next',
    body: html`<div class="form">
      <label class="field">Parent first name<input type="text" name="first_name" required></label>
      <label class="field">Last name<input type="text" name="last_name" required></label>
      <label class="field">Mobile phone<input type="tel" name="phone" required></label>
      <label class="field">Email<input type="email" name="email"></label></div>`,
    onSubmit: async (f) => {
      const parent = await call('POST', '/people', { first_name: f.first_name.value, last_name: f.last_name.value, phone: f.phone.value, email: f.email.value, campus_id: state.station.campusId, status: 'guest', new_household: true, force: true });
      household = { id: parent.household_id, name: `${parent.last_name} Household`, phone: '', members: [parent], pickups: [] };
    },
  });
  if (!household) return;
  state.roster.households.push(household);
  await addChild(household);
}

async function addChild(h) {
  if (!navigator.onLine) { toast('Adding a child needs the internet.', 'bad'); return; }
  let kid;
  await dialog({
    title: `Add a child to ${h.name}`, submit: 'Add child',
    body: html`<div class="form">
      <label class="field">First name<input type="text" name="first_name" required></label>
      <label class="field">Last name<input type="text" name="last_name" value="${h.members[0]?.last_name || ''}"></label>
      <label class="field">Birthdate<input type="date" name="birthdate" required></label>
      <label class="field wide">Allergies or medical needs<input type="text" name="allergies" placeholder="None"></label></div>`,
    onSubmit: async (f) => {
      kid = await call('POST', '/people', { first_name: f.first_name.value, last_name: f.last_name.value, birthdate: f.birthdate.value, allergies: f.allergies.value, household_id: h.id, household_role: 'child', campus_id: state.station.campusId, status: 'guest', force: true });
    },
  });
  if (!kid) return;
  const target = state.roster.households.find((x) => x.id === h.id) || h;
  target.members.push(kid);
  if (!state.roster.households.includes(target)) state.roster.households.push(target);
  store.set(KEY.roster(state.station.campusId), state.roster);
  drawFamily(target);
}

// ---------------------------------------------------------------- check out
function drawCheckout() {
  mount($main, html`<div style="max-width:420px;margin:0 auto;text-align:center">
    <h1>Check out</h1><p class="k-hint">Enter the code from the parent’s pickup tag.</p>
    <input class="k-search" data-code maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="CODE">
    <div data-match style="margin-top:16px"></div></div>`);
  const input = $main.querySelector('[data-code]');
  input.focus();
  input.oninput = () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (input.value.length === 4) showMatch(input.value);
    else mount($main.querySelector('[data-match]'), '');
  };
}

function showMatch(code) {
  const kids = todays().filter((c) => c.security_code === code && !c.checked_out_at);
  const box = $main.querySelector('[data-match]');
  if (!kids.length) { mount(box, html`<div class="alert bad">No children are checked in with code ${code}.</div>`); return; }
  const fam = state.roster.households.find((h) => h.members.some((m) => m.id === kids[0].person_id));
  const pickup = fam ? [...fam.members.filter((m) => m.household_role !== 'child').map(displayName), ...fam.pickups.map((p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ''}`)] : [];
  mount(box, html`<div class="card" style="text-align:left">
    ${kids.map((k) => html`<div class="row" style="padding:6px 0"><b>${displayName(k)}</b><span class="muted">${k.room_name || ''}</span></div>`)}
    ${pickup.length ? html`<p class="small muted">Allowed to pick up: ${pickup.join(', ')}</p>` : ''}
    <button class="btn primary k-big" style="width:100%;margin-top:10px" data-out>Check out ${kids.length > 1 ? `all ${kids.length}` : ''}</button></div>`);
  box.querySelector('[data-out]').onclick = async () => {
    const now = new Date().toISOString();
    try {
      if (navigator.onLine) {
        await sync();
        await call('POST', '/checkin/checkout', { campus_id: state.station.campusId, ids: kids.map((k) => k.id), by: state.station.name });
      } else {
        toast('Offline: checked out on this tablet. It will update the server later.');
        store.set('mb.checkin.outbox', [...store.get('mb.checkin.outbox', []), ...kids.map((k) => k.id)]);
      }
      const ids = new Set(kids.map((k) => k.id));
      saveToday(todays().map((c) => (ids.has(c.id) ? { ...c, checked_out_at: now } : c)));
      toast(`Checked out ${kids.map((k) => k.nickname || k.first_name).join(' & ')}.`);
      drawCheckout();
    } catch (e) { fail(e); }
  };
}

// Checkouts made while offline are sent once we reconnect.
async function flushCheckouts() {
  const ids = store.get('mb.checkin.outbox', []);
  if (!ids.length || !navigator.onLine || store.get(KEY.queue, []).length) return;
  try {
    await call('POST', '/checkin/checkout', { campus_id: state.station.campusId, ids, by: state.station.name });
    store.set('mb.checkin.outbox', []);
  } catch { /* try again next time */ }
}
setInterval(flushCheckouts, 30000);
window.addEventListener('online', () => setTimeout(flushCheckouts, 3000));

// ---------------------------------------------------------------- rooms
async function drawRooms() {
  if (navigator.onLine) await refreshRoster();
  if (state.mode !== 'rooms') return;
  const list = todays();
  const rooms = [...state.roster.rooms, { id: null, name: 'No room' }];
  mount($main, html`<div class="row" style="margin-bottom:14px"><h1>In the rooms now</h1><span class="spacer"></span><button class="btn" data-refresh>Refresh</button></div>
    ${rooms.map((r) => {
      const kids = list.filter((c) => (c.room_id ?? null) === r.id && !c.checked_out_at);
      if (!kids.length && r.id === null) return '';
      return html`<div class="card k-room"><div class="card-head"><h2>${r.name}</h2><span class="pill">${kids.length}${r.capacity ? ` / ${r.capacity}` : ''}</span></div>
        ${kids.length ? html`<table class="list"><tbody>${kids.map((k) => html`<tr><td><b>${displayName(k)}</b></td>
          <td>${k.allergies ? html`<span class="allergy">⚠ ${k.allergies}</span>` : ''} ${k.medical_notes ? html`<span class="muted small">${k.medical_notes}</span>` : ''}</td>
          <td class="num" style="text-align:right"><b>${k.security_code}</b></td></tr>`)}</tbody></table>` : html`<p class="muted">Empty</p>`}</div>`;
    })}
    <p class="muted small">${list.filter((c) => !c.checked_out_at).length} checked in now · ${list.length} today</p>`);
  $main.querySelector('[data-refresh]').onclick = drawRooms;
}

// ---------------------------------------------------------------- printing
function printLabels(h, chosen, code) {
  const size = LABELS[state.roster.label_size] || LABELS['brother-62x29'];
  const date = new Date().toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  const kidLabel = ({ kid, room }) => `<div class="label">
      ${kid.allergies ? `<div class="alert-strip">ALLERGY: ${esc(kid.allergies)}</div>` : ''}
      <div class="name" style="font-size:${size.name}">${esc(kid.nickname || kid.first_name)}</div>
      <div class="last" style="font-size:${size.small}">${esc(kid.last_name)}</div>
      <div class="meta" style="font-size:${size.small}"><span>${esc(room?.name || '')}</span><span>${date}</span><span class="code" style="font-size:${size.code}">${code}</span></div>
      ${kid.medical_notes ? `<div style="font-size:${size.small}">${esc(kid.medical_notes)}</div>` : ''}
    </div>`;
  const parentLabel = `<div class="label">
      <div style="font-size:${size.small}">PARENT PICKUP · ${esc(h.name)}</div>
      <div class="code" style="font-size:${size.name}">${code}</div>
      <div style="font-size:${size.small}">${chosen.map((c) => esc(c.kid.nickname || c.kid.first_name)).join(', ')} · ${date}</div>
      <div style="font-size:${size.small}">Show this tag to pick up your child.</div>
    </div>`;
  const css = `<style>@page { size: ${size.page || `${size.w} ${size.h}`}; margin: ${size.page ? '0.5in' : '0'}; }
    .label { width: ${size.w}; height: ${size.h}; padding: ${size.pad}; box-sizing: border-box; ${size.page ? 'border: 1px dashed #999; margin-bottom: 0.2in;' : ''} }</style>`;
  const area = document.querySelector('[data-print]');
  area.innerHTML = css + chosen.map(kidLabel).join('') + (state.roster.print_parent_tag ? parentLabel : '');
  setTimeout(() => window.print(), 50);
}

boot().catch(fail);
