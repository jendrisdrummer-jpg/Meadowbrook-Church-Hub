// Kids check-in station. Works offline: it keeps a copy of the family roster and queues
// check-ins until the connection is back. Check-in ids and pickup codes are made here, so
// a queued check-in syncs exactly once however many times it is re-sent.
import { html, mount, avatar, displayName, dialog, options, toast, fail, familyName } from './lib.js';
import { roomFor, pickupCode, normalizeCode, showCode, hasEpi, ageLabel, gradeLabel, digitsOnly, groupFamilies, newRelease, upgradeOutbox, parkEntry, canTidy, labelName, heldPeople, rosterIsToday, collectorChoice, ID_TYPES, HOLD_MESSAGE, STALE_MESSAGE, CHECKIN_APP_VERSION, LABELS, featuresOf, holdAlertText, holdLeaveText, kidLabelHtml, parentTagHtml, labelCss } from './checkin-rules.js';

const KEY = {
  station: 'mb.checkin.station',
  token: 'mb.checkin.token', // a paired iPad's sign-in (from the hub’s Check-in iPads page)
  roster: (campusId) => `mb.checkin.roster.${campusId}`,
  queue: 'mb.checkin.queue',
  outbox: 'mb.checkin.outbox.v2', // one entry per release made while offline
  stuck: 'mb.checkin.outbox.stuck', // releases the hub refuses every time: ids and times only, for a coordinator
  outboxOld: 'mb.checkin.outbox', // the flat list of ids an older check-in kept
  today: (campusId, day) => `mb.checkin.today.${campusId}.${day}`,
};

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('This device is out of storage space.', 'bad'); return false; } },
};

const RELOAD_MESSAGE = 'This iPad needs the latest check-in. Close the app and open it again.';
const state = { needsReload: false, station: store.get(KEY.station, null), token: store.get(KEY.token, null), roster: null, mode: 'in', online: navigator.onLine, authed: true, campuses: [] };
const $main = document.querySelector('[data-main]');
// How this church runs check-in (Check-in iPads in the Hub), from the roster. An older copy of the roster has none: then the iPad
// works as it always has.
const feat = () => featuresOf(state.roster);
// Parents show their tag, so there is no Check out screen.
function applyFeatures() {
  const out = document.querySelector('[data-mode="out"]');
  if (out) out.hidden = feat().checkout === 'tag';
  if (feat().checkout === 'tag' && state.mode === 'out') setMode('in');
}

async function call(method, url, body) {
  const headers = { 'x-mb': '1', 'content-type': 'application/json', 'x-checkin-version': String(CHECKIN_APP_VERSION) };
  if (state.token) headers['x-station'] = state.token;
  const res = await fetch('/api' + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  // Removed in the hub: forget the pairing and show a new code.
  if (res.status === 401 && data.station_removed) { forgetPairing(); location.reload(); throw new Error(data.error); }
  if (res.status === 401) { state.authed = false; drawStatus(); throw Object.assign(new Error('Signed out. Sign in again to sync.'), { status: 401 }); }
  // The hub only accepts the latest check-in. What this iPad has recorded stays in its queue and outbox
  // (they are only cleared after a 2xx answer) and syncs once the app is reopened.
  if (res.status === 426 && data.reload) { state.needsReload = true; drawStatus(); throw Object.assign(new Error(RELOAD_MESSAGE), { status: 426 }); }
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
  // A paired iPad takes its name, campus and labels from the hub.
  if (state.token) {
    try {
      const s = await call('GET', '/checkin/station');
      state.station = { campusId: s.campusId, name: s.name, print: s.print, paired: true, stationLetter: s.stationLetter || null };
      store.set(KEY.station, state.station);
    } catch (e) {
      if (!state.station) { mount($main, html`<div class="alert bad">Can’t reach the church right now. Connect to the internet and reload.</div>`); return; }
    }
  }
  try {
    state.campuses = await call('GET', '/campuses');
  } catch (e) {
    if (e.status === 401 && !state.station) { await pairScreen(); return; }
  }
  if (!state.station) { await setup(); return; }
  state.roster = store.get(KEY.roster(state.station.campusId), null);
  await refreshRoster();
  if (state.denied) { mount($main, html`<div class="alert bad">${state.denied}</div>`); return; }
  if (!state.roster && state.needsReload) { mount($main, html`<div class="alert bad">${RELOAD_MESSAGE}</div>`); return; }
  if (!state.roster) { mount($main, html`<div class="alert bad">This station has no family list yet. Connect to the internet and reload.</div>`); return; }
  drawHeader();
  applyFeatures();
  setMode('in');
  sync().then(tidyOldData);
  setInterval(() => sync().then(tidyOldData), 30000);
  setInterval(refreshRoster, 10 * 60000);
}

async function refreshRoster() {
  if (!state.station || !navigator.onLine) return;
  try {
    state.roster = await call('GET', `/checkin/roster?campus_id=${state.station.campusId}`);
    store.set(KEY.roster(state.station.campusId), state.roster);
    state.authed = true;
    applyFeatures();
    // Merge the server's list of today's check-ins (other stations) into ours.
    const active = await call('GET', `/checkin/active?campus_id=${state.station.campusId}`);
    const mine = todays();
    const byId = new Map(mine.map((c) => [c.id, c]));
    // A child released on this iPad stays checked out here until the hub has been told.
    const waiting = new Map(loadOutbox().flatMap((e) => e.ids.map((id) => [id, e.at])));
    for (const a of active) {
      const merged = { ...byId.get(a.id), ...a, synced: true };
      if (feat().holds === 'off') delete merged.on_hold; // holds were switched off since this copy was made
      delete merged.medical_notes; // an earlier check-in kept the longer medical note here; it is only fetched on tap now
      if (waiting.has(a.id)) merged.checked_out_at = byId.get(a.id)?.checked_out_at || waiting.get(a.id) || new Date().toISOString();
      byId.set(a.id, merged);
    }
    saveToday([...byId.values()]);
    drawStatus();
  } catch (e) {
    if (e.status === 403) state.denied = e.message;
    else if (e.status !== 401) console.warn('Roster refresh failed', e);
  }
}

const stuckCount = () => store.get(KEY.stuck, []).reduce((n, e) => n + e.ids.length, 0);

// The iPad's copy of the church's data: family lists and each day's list of who is checked in.
const COPIES = ['mb.checkin.roster.', 'mb.checkin.today.'];
function forgetCopies(keep = new Set()) {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    keys.filter((k) => COPIES.some((p) => k.startsWith(p)) && !keep.has(k)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// Unpairing wipes everything about the church from this iPad except what hasn't been sent yet
// (the check-in queue and the outbox), so nothing is lost and nothing else stays behind.
function forgetPairing() {
  forgetCopies();
  try { localStorage.removeItem(KEY.token); localStorage.removeItem(KEY.station); } catch { /* ignore */ }
  state.token = null;
  state.station = null;
}

// Once everything has been sent, lists from earlier days and rosters from other campuses are no longer needed.
function tidyOldData() {
  if (!state.station || !state.roster || !canTidy(store.get(KEY.queue, []), loadOutbox())) return;
  forgetCopies(new Set([KEY.roster(state.station.campusId), KEY.today(state.station.campusId, day())]));
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'; // iPads can say "Macintosh"
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return /Windows/.test(ua) ? 'Windows computer' : /Mac/.test(ua) ? 'Mac' : 'Browser';
}

// Not signed in and not paired: show a code for staff to enter in the hub, and wait for it.
async function pairScreen() {
  for (const sel of ['[data-modes]', '[data-setup]', '[data-status]']) document.querySelector(sel).style.display = 'none';
  let pairing;
  let timer;
  const start = async () => {
    try {
      pairing = await call('POST', '/checkin/pair', { device: deviceName() });
    } catch (err) {
      mount($main, html`<div class="alert bad">${err.message}</div>`);
      return;
    }
    const code = `${pairing.code.slice(0, 3)}-${pairing.code.slice(3)}`;
    mount($main, html`<div class="k-pair">
      <h1>Set up this ${deviceName() === 'iPad' ? 'iPad' : 'device'} for check-in</h1>
      <p>On a computer or phone, open the hub and go to <b>Check-in iPads</b> (under More), then choose <b>Add a station</b> and type this code:</p>
      <div class="k-pair-code" aria-label="${pairing.code.split('').join(' ')}">${code}</div>
      <p class="muted small" data-pair-note>Waiting… The code changes every 15 minutes.</p>
      <p class="small"><a href="/login?next=%2Fcheckin">Or sign in as a leader instead</a></p></div>`);
    clearInterval(timer);
    const born = Date.now();
    timer = setInterval(async () => {
      if (Date.now() - born > (pairing.expires_in - 20) * 1000) { clearInterval(timer); return start(); }
      try {
        const r = await call('GET', `/checkin/pair/${pairing.secret}`);
        if (!r.paired) return;
        clearInterval(timer);
        state.token = r.token;
        store.set(KEY.token, r.token);
        store.set(KEY.station, { campusId: r.station.campusId, name: r.station.name, print: r.station.print, paired: true, stationLetter: r.station.stationLetter || null });
        mount($main, html`<div class="k-pair"><h1>All set!</h1><p>This is now <b>${r.station.name}</b> at ${r.station.campusName}.</p></div>`);
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        if (err.message.includes('expired')) { clearInterval(timer); start(); }
      }
    }, 3000);
  };
  await start();
}

async function setup() {
  // A paired station is set up from the hub.
  if (state.station?.paired) {
    await dialog({
      title: 'This check-in station', submit: false, cancel: 'Close',
      body: html`<p style="margin:0">This ${deviceName()} is <b>${state.station.name}</b>${state.roster?.campus ? html` at <b>${state.roster.campus.name}</b>` : ''}.</p>
        <p class="muted small">To rename it, move it to another campus, turn labels on or off, or remove it, go to <b>Check-in iPads</b> (under More) in the hub.</p>`,
    });
    return;
  }
  // Only campuses this account can use; someone without check-in access hears so before the form.
  let allowed = state.campuses;
  try { allowed = await call('GET', '/checkin/campuses'); } catch (e) {
    if (e.status === 403) { mount($main, html`<div class="alert bad">${e.message}</div>`); return; }
  }
  const camps = allowed.filter((c) => c.active);
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
  document.querySelector('[data-where]').textContent = `${c.name} · ${state.station.name}${state.station.stationLetter ? ` · codes start with ${state.station.stationLetter}` : ''}`;
  document.title = `Check-in · ${c.name}`;
  drawStatus();
}

function drawStatus() {
  const q = store.get(KEY.queue, []).length + loadOutbox().reduce((n, e) => n + e.ids.length, 0);
  mount(document.querySelector('[data-status]'), html`
    ${state.online ? html`<span class="k-online">● Online</span>` : html`<span class="k-offline">● Offline: still checking in</span>`}
    ${q ? html`<span class="k-pending">${q} waiting to sync</span>` : ''}
    ${stuckCount() ? html`<span class="k-pending" role="alert">${stuckCount()} ${stuckCount() === 1 ? 'child’s check-out' : 'children’s check-outs'} couldn’t be sent. Ask a coordinator.</span>` : ''}
    ${state.needsReload ? html`<span class="k-pending" role="alert">${RELOAD_MESSAGE}</span>` : ''}
    ${!state.authed && !state.station?.paired ? html`<a class="btn small" href="/login?next=%2Fcheckin">Sign in to sync</a>` : ''}`);
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
  mount(box, fams.length ? fams.map((h) => html`<button class="k-family" data-h="${h.id}"><b>${familyName(h.name)}</b>
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

// Level 1, always shown: the allergen words, an EpiPen yes/no and the one-line action.
const safetyLine = (k, br = true) => (k.allergies || hasEpi(k) || k.allergy_action ? html`${br ? html`<br>` : ''}${hasEpi(k) ? html`<span class="allergy">EPI: YES</span> ` : ''}${k.allergies ? html`<span class="allergy">⚠ ${k.allergies}</span>` : ''}${k.allergy_action ? html` <span class="small">${k.allergy_action}</span>` : ''}` : '');

function drawFamily(h) {
  const kids = h.members.filter((m) => m.household_role === 'child');
  const adults = h.members.filter((m) => m.household_role !== 'child');
  const already = new Set(todays().filter((c) => !c.checked_out_at).map((c) => c.person_id));
  const services = state.roster.services || [];
  const svc = currentService();
  // Holds that only warn: the volunteer sees which child it is before checking them in, and the message again afterwards.
  const alertOn = feat().holds === 'alert';
  const heldNow = alertOn ? heldPeople(state.roster, todays()) : new Set();
  mount($main, html`<div class="row"><button class="btn" data-back>← Back</button><h1 style="margin-left:6px">${familyName(h.name)}</h1></div>
    <div class="k-kids">${kids.map((k) => {
      const room = roomFor(k, state.roster.rooms, day());
      const done = already.has(k.id);
      return html`<label class="k-kid ${done ? 'done' : 'on'}">
        <input type="checkbox" data-kid="${k.id}" ${done ? '' : 'checked'}>${avatar(k)}
        <span class="info"><b>${displayName(k)}</b> <span class="muted">${ageLabel(k.birthdate, day())}${k.grade != null ? ` · ${gradeLabel(k.grade)}` : ''}</span>
          ${safetyLine(k)}
          ${alertOn && heldNow.has(k.id) ? html`<br><span class="pill bad">Hold: please bring a leader to the desk</span>` : ''}
          ${done ? html`<br><span class="muted">Already checked in</span>` : ''}</span>
        <span class="room ${room ? '' : 'none'}">${room ? room.name : 'No room fits'}</span>
        ${state.roster.rooms.length > 1 ? html`<select data-room="${k.id}" style="width:auto" aria-label="Room">${options(state.roster.rooms.map((r) => ({ value: r.id, label: r.name })), room?.id, { blank: 'Room…' })}</select>` : ''}
      </label>`;
    })}</div>
    ${!kids.length ? html`<p class="k-hint">No children in this family yet.</p>` : ''}
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
  // A new code is the station's letter plus four characters, and never one already used today on this iPad's list.
  const code = existing || pickupCode({ letter: state.station.stationLetter, taken: new Set(todays().map((c) => c.security_code)), random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 });
  const at = new Date().toISOString();
  const records = chosen.map(({ kid, room }) => ({
    id: crypto.randomUUID(), person_id: kid.id, room_id: room?.id ?? null, service_id: serviceId,
    kind: 'kid', security_code: code, station: state.station.name, checked_in_at: at,
  }));
  store.set(KEY.queue, [...store.get(KEY.queue, []), ...records]);
  saveToday([...todays(), ...records.map((r, i) => ({
    ...r, household_id: h.id, first_name: chosen[i].kid.first_name, last_name: chosen[i].kid.last_name, nickname: chosen[i].kid.nickname,
    allergies: chosen[i].kid.allergies, allergy_epi: chosen[i].kid.allergy_epi, allergy_action: chosen[i].kid.allergy_action, room_name: chosen[i].room?.name ?? null, synced: false,
  }))]);
  drawStatus();
  sync();
  if (state.station.print) printLabels(chosen, code, at);
  // Holds that only warn: a calm, prominent message to the volunteer. Only the child's name, never why.
  const heldKids = feat().holds === 'alert' ? chosen.filter((c) => heldPeople(state.roster, todays()).has(c.kid.id)) : [];
  mount($main, html`<div class="card" style="text-align:center;max-width:520px;margin:30px auto">
    <h1>${chosen.map((c) => c.kid.nickname || c.kid.first_name).join(' & ')} ${chosen.length > 1 ? 'are' : 'is'} checked in</h1>
    <div data-hold-alert>${heldKids.length ? holdAlert(heldKids.map((c) => c.kid.nickname || c.kid.first_name)) : ''}</div>
    <p class="muted">Pickup code</p><div class="k-code" aria-label="${code.split('').join(' ')}">${showCode(code)}</div>
    ${chosen.map((c) => html`<div>${c.kid.nickname || c.kid.first_name}: <b>${c.room?.name || 'room to be assigned'}</b></div>`)}
    <div class="row" style="justify-content:center;margin-top:20px">
      ${state.station.print ? html`<button class="btn k-big" data-reprint>Print again</button>` : ''}
      <button class="btn primary k-big" data-done>Done</button></div></div>`);
  $main.querySelector('[data-done]').onclick = drawSearch;
  $main.querySelector('[data-reprint]')?.addEventListener('click', () => printLabels(chosen, code, at));
  // The screen goes back to the search after a while, except while a message for a leader is showing.
  setTimeout(() => { if ($main.querySelector('[data-done]') && !$main.querySelector('[data-hold-alert] [role=alert]')) drawSearch(); }, 20000);
}

const holdAlert = (names) => html`<div class="alert bad k-holdalert" role="alert" style="text-align:left;font-size:19px;margin:14px 0"><b>${holdAlertText(names)}</b></div>`;
// The hub says a child has a hold that this iPad's family list didn't know about (placed after it was made): show the message now,
// if the check-in confirmation is still on screen, and remember it for the lists.
function lateHold(saved) {
  if (feat().holds !== 'alert') return;
  const held = saved.filter((s) => s.on_hold);
  if (!held.length) return;
  const known = heldPeople(state.roster, todays());
  const fresh = held.filter((s) => !known.has(s.person_id));
  saveToday(todays().map((c) => (held.some((h) => h.id === c.id) ? { ...c, on_hold: 1 } : c)));
  const box = $main.querySelector('[data-hold-alert]');
  if (fresh.length && box && !box.querySelector('[role=alert]')) {
    const names = fresh.map((s) => todays().find((c) => c.id === s.id)).filter(Boolean).map((c) => c.nickname || c.first_name);
    mount(box, holdAlert(names));
  }
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
    lateHold(saved);
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
      household = { id: parent.household_id, name: `${parent.last_name} family`, phone: '', members: [parent], pickups: [] };
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
    title: `Add a child to ${familyName(h.name)}`, submit: 'Add child',
    body: html`<div class="form">
      <label class="field">First name<input type="text" name="first_name" required></label>
      <label class="field">Last name<input type="text" name="last_name" value="${h.members[0]?.last_name || ''}"></label>
      <label class="field">Birthdate<input type="date" name="birthdate" required></label>
      <label class="field wide">Allergies<input type="text" name="allergies" placeholder="None"></label>
      <label class="check wide"><input type="checkbox" name="allergy_epi"> Has an EpiPen</label></div>`,
    onSubmit: async (f) => {
      kid = await call('POST', '/people', { first_name: f.first_name.value, last_name: f.last_name.value, birthdate: f.birthdate.value, allergies: f.allergies.value, allergy_epi: f.allergy_epi.checked, household_id: h.id, household_role: 'child', campus_id: state.station.campusId, status: 'guest', force: true });
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
// A pickup code only finds children; it never decides who may take them. Children are ticked one at a
// time, one family at a time, and every release records the time it really happened. A release made
// without the internet waits in the outbox, one entry per release, and is never dropped.
function drawCheckout() {
  mount($main, html`<div style="max-width:420px;margin:0 auto;text-align:center">
    <h1>Check out</h1><p class="k-hint">Enter the code from the parent’s pickup tag.</p>
    <input class="k-search" data-code maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="CODE" aria-label="Pickup code">
    <p class="k-hint">The code is a letter and four characters. Tags from before this update have four.</p>
    <button class="btn" data-find>Find</button>
    <div data-match style="margin-top:16px"></div></div>`);
  const input = $main.querySelector('[data-code]');
  input.focus();
  // A full code (five characters) is looked up as soon as it is typed. A shorter, older code is looked up with Find
  // or Return, so the first four characters of a new code never pull up someone else's family.
  input.oninput = () => {
    input.value = normalizeCode(input.value).slice(0, 5);
    if (input.value.length === 5) showMatch(input.value);
    else mount($main.querySelector('[data-match]'), '');
  };
  const find = () => { if (input.value.length >= 4) showMatch(input.value); else toast('Type the whole code.'); };
  $main.querySelector('[data-find]').onclick = find;
  input.onkeydown = (e) => { if (e.key === 'Enter') find(); };
}

const plural = (n, one, many) => (n === 1 ? one : many);

function pickupList(householdId) {
  const fam = householdId != null ? state.roster.households.find((h) => h.id === householdId) : null;
  return fam ? [...fam.members.filter((m) => m.household_role !== 'child').map(displayName), ...fam.pickups.map((p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ''}`)] : [];
}

// Who may collect this family's children from an iPad: the adults in the household and the listed pickup people.
// The value is what the iPad sends (the hub looks the name up), the label is what the volunteer sees.
function collectors(householdId) {
  const fam = householdId != null ? state.roster.households.find((h) => h.id === householdId) : null;
  if (!fam) return [];
  return [...fam.members.filter((m) => m.household_role !== 'child').map((m) => ({ value: `adult:${m.id}`, label: displayName(m), name: displayName(m) })),
    ...fam.pickups.map((p) => ({ value: `pickup:${p.id}`, label: `${p.name}${p.relationship ? ` (${p.relationship})` : ''}`, name: p.name, relationship: p.relationship || '' }))];
}

function showMatch(code) {
  const open = todays().filter((c) => c.security_code === code && !c.checked_out_at);
  const box = $main.querySelector('[data-match]');
  if (!open.length) { mount(box, html`<div class="alert bad">No children are checked in with code ${showCode(code)}.</div>`); return; }
  const families = groupFamilies(open);
  const many = families.length > 1;
  // A child with a hold is never checked out here, online or off. The iPad only knows that there is one, never why.
  // Where holds only warn, a held child can be checked out but the volunteer is asked to bring a leader first (the hub tells the lead).
  const blocking = feat().holds === 'block';
  const held = heldPeople(state.roster, todays());
  const anyHeld = blocking && open.some((k) => held.has(k.person_id));
  const warnHeld = !blocking && feat().holds === 'alert' ? open.filter((k) => held.has(k.person_id)) : [];
  mount(box, html`<div class="k-out" style="text-align:left">
    <p class="k-count"><b>${open.length}</b> ${plural(open.length, 'child is', 'children are')} checked in with this code. Read the number to the parent and check it against their tag.</p>
    ${many ? html`<div class="alert bad" role="alert"><b>This code matches ${families.length === 2 ? 'two' : families.length} families.</b> Check ID and choose the children.</div>` : ''}
    ${anyHeld ? html`<div class="alert bad" role="alert"><b>Hold: see coordinator.</b> ${HOLD_MESSAGE} <button class="btn small" style="margin-top:8px" data-recheck>Check again</button></div>` : ''}
    ${warnHeld.length ? html`<div class="alert bad" role="alert"><b>${holdLeaveText(warnHeld.map((k) => k.nickname || k.first_name))}</b></div>` : ''}
    <div data-message></div>
    ${families.map((f) => {
      const allowed = pickupList(f.household_id);
      const who = collectors(f.household_id);
      const name = f.household_id != null ? familyName(state.roster.households.find((h) => h.id === f.household_id)?.name || f.items[0].household_name || '') : '';
      return html`<section class="card k-fam" data-fam="${f.key}">
        ${many ? html`<h2>${name || displayName(f.items[0])}</h2>` : ''}
        <div class="k-kids">${f.items.map((k) => (blocking && held.has(k.person_id)
          ? html`<div class="k-kid held">${avatar(k)}<span class="info"><b>${displayName(k)}</b><br><span class="pill bad">Hold: see coordinator</span></span><span class="room">${k.room_name || ''}</span></div>`
          : html`<label class="k-kid"><input type="checkbox" data-pick="${k.id}">${avatar(k)}
          <span class="info"><b>${displayName(k)}</b></span><span class="room">${k.room_name || ''}</span></label>`))}</div>
        ${who.length ? html`<label class="field k-collector">Who is collecting?<select data-collector><option value="">Choose…</option>${who.map((w) => html`<option value="${w.value}">${w.label}</option>`)}</select></label>
          <label class="field k-collector">ID shown<select data-idtype required><option value="">Choose…</option>${ID_TYPES.map((t) => html`<option value="${t.value}">${t.label}</option>`)}</select></label>`
          : html`<p class="small muted">No one is on file to collect this child. Please ask a coordinator to come to the desk; they check ID and call a parent.</p>`}
        <p class="small muted">${allowed.length ? html`Allowed to pick up: ${allowed.join(', ')}` : 'No one is listed to pick up this child. Check ID and ask a coordinator.'}</p>
        ${many ? html`<label class="check k-idcheck"><input type="checkbox" data-id-checked> ID checked</label>` : ''}
        <button class="btn primary k-big" style="width:100%;margin-top:10px" data-out disabled>Choose the children</button></section>`;
    })}</div>`);
  const cards = [...box.querySelectorAll('[data-fam]')];
  // Only one family at a time: once a child is ticked, the other families wait.
  const refresh = () => {
    const active = cards.find((c) => c.querySelector('[data-pick]:checked'));
    cards.forEach((card) => {
      const picked = card.querySelectorAll('[data-pick]:checked').length;
      const locked = Boolean(active) && active !== card;
      card.querySelectorAll('[data-pick], [data-id-checked], [data-collector], [data-idtype]').forEach((i) => { i.disabled = locked; });
      card.classList.toggle('waiting', locked);
      const btn = card.querySelector('[data-out]');
      const needId = many && !card.querySelector('[data-id-checked]').checked;
      const needWho = Boolean(card.querySelector('[data-collector]')) && !card.querySelector('[data-collector]').value;
      const needIdType = Boolean(card.querySelector('[data-idtype]')) && !card.querySelector('[data-idtype]').value;
      btn.disabled = locked || !picked || needId || needWho || needIdType || !card.querySelector('[data-collector]');
      btn.textContent = !picked ? 'Choose the children' : needId ? 'Tick “ID checked” first' : needWho ? 'Choose who is collecting' : needIdType ? 'Choose the ID shown' : `Check out ${picked} ${plural(picked, 'child', 'children')}`;
      card.querySelectorAll('.k-kid').forEach((l) => l.classList.toggle('on', Boolean(l.querySelector('input')?.checked)));
    });
  };
  box.onchange = refresh;
  refresh();
  cards.forEach((card) => {
    card.querySelector('[data-out]').onclick = () => {
      const f = families.find((x) => x.key === card.dataset.fam);
      const ids = new Set([...card.querySelectorAll('[data-pick]:checked')].map((i) => i.dataset.pick));
      const choice = collectorChoice(card.querySelector('[data-collector]').value, card.querySelector('[data-idtype]').value);
      const picked = collectors(f.household_id).find((w) => w.value === card.querySelector('[data-collector]').value);
      release(f, f.items.filter((k) => ids.has(k.id)), box, choice && { ...choice, name: picked?.name || '', relationship: picked?.relationship || '' });
    };
  });
  // A hold may have been lifted (or placed) since this iPad last asked: look again.
  box.querySelector('[data-recheck]')?.addEventListener('click', async () => {
    if (!navigator.onLine) { toast('This iPad has no connection, so it can’t check. Please ask a staff member.', 'bad'); return; }
    await refreshRoster();
    showMatch(code);
  });
}

// One family's ticked children leave. Online, the hub is asked first and can say no (409); offline, or when the
// hub can't be reached, the release is kept in the outbox with the time it happened and sent when it can be.
async function release(fam, kids, box, collector) {
  const at = new Date().toISOString();
  const ids = kids.map((k) => k.id);
  const campusId = state.station.campusId;
  const say = (text) => {
    mount(box.querySelector('[data-message]'), html`<div class="alert bad" role="alert">${text}</div>`);
    box.querySelectorAll('[data-out]').forEach((b) => { b.disabled = false; });
  };
  // Never for a child with a hold, even if one slipped through to here.
  const held = heldPeople(state.roster, todays());
  if (feat().holds === 'block' && kids.some((k) => held.has(k.person_id))) { say(`${HOLD_MESSAGE} Nothing was checked out.`); return; }
  if (!collector) { say('Choose who is collecting. Nothing was checked out.'); return; }
  const buttons = box.querySelectorAll('[data-out]');
  buttons.forEach((b) => { b.disabled = true; });
  let waiting = !navigator.onLine;
  if (!waiting) {
    try {
      await sync();
      // Their check-in hasn't reached the hub yet, so the release has to wait behind it.
      if (store.get(KEY.queue, []).length) waiting = true;
      else await call('POST', '/checkin/checkout', { campus_id: campusId, mode: 'request', household_id: fam.household_id, ids, collector });
    } catch (e) {
      if (e.status === 409) {
        // The hub knows of a hold this iPad didn't (or this church has since switched check-out off): fetch the latest, so the child
        // shows as held from now on, and the Check out screen goes away if it should.
        refreshRoster();
        say(`${e.message} Nothing was checked out.`);
        return;
      }
      // Can't reach the hub, or it can't take it right now: the children are leaving, so keep the release.
      if (!e.status || e.status === 401 || e.status === 426 || e.status >= 500) waiting = true;
      else { fail(e); box.querySelectorAll('[data-out]').forEach((b) => { b.disabled = false; }); return; }
    }
  }
  if (waiting) {
    // Without a connection the iPad can't know about a hold placed since its list was made, so it only releases when the
    // list is from today. Otherwise it's the paper sign-out sheet and a coordinator.
    if (!rosterIsToday(state.roster)) { say(STALE_MESSAGE); return; }
    const saved = saveOutbox([...loadOutbox(), newRelease({ id: crypto.randomUUID(), campusId, ids, householdId: fam.household_id, at, collector })]);
    if (!saved) {
      mount(box.querySelector('[data-message]'), html`<div class="alert bad" role="alert">This iPad couldn’t save the check-out, so nothing was checked out. Use the paper sign-out sheet and tell a coordinator.</div>`);
      box.querySelectorAll('[data-out]').forEach((b) => { b.disabled = false; });
      return;
    }
    toast('No connection: checked out on this iPad. It will tell the hub when it can.');
  }
  const gone = new Set(ids);
  saveToday(todays().map((c) => (gone.has(c.id) ? { ...c, checked_out_at: at } : c)));
  drawStatus();
  toast(`Checked out ${kids.map((k) => k.nickname || k.first_name).join(' & ')}.`);
  drawCheckout();
}

// The outbox: one entry per release made while offline. Older iPads kept a flat list of ids under another key;
// it is carried over once, without times.
function loadOutbox() {
  const old = store.get(KEY.outboxOld, null);
  let list = store.get(KEY.outbox, []);
  if (old) {
    list = [...list, ...upgradeOutbox(old, state.station?.campusId ?? null, () => crypto.randomUUID())];
    if (store.set(KEY.outbox, list)) { try { localStorage.removeItem(KEY.outboxOld); } catch { /* ignore */ } }
  }
  return list;
}
const saveOutbox = (list) => store.set(KEY.outbox, list);

let flushing = false;
// Sends waiting releases, oldest first. They only go once every check-in is on the hub, so a child is
// always checked in there before they are checked out. An entry leaves the outbox only after the hub says yes.
async function flushCheckouts() {
  if (flushing || !state.station || !navigator.onLine || store.get(KEY.queue, []).length) return;
  flushing = true;
  try {
    for (const entry of loadOutbox()) {
      try {
        await call('POST', '/checkin/checkout', { campus_id: entry.campus_id ?? state.station.campusId, mode: 'report', ids: entry.ids, ...(entry.at ? { at: entry.at } : {}), ...(entry.collector ? { collector: entry.collector } : {}) });
        saveOutbox(loadOutbox().filter((e) => e.id !== entry.id));
      } catch (e) {
        if (!e.status || e.status === 401 || e.status === 426 || e.status >= 500) break; // try again later
        // Anything else would be refused every time: park it for a coordinator (ids and times only) so it can't block
        // the clean-up, and the rest go on.
        const moved = parkEntry(loadOutbox(), store.get(KEY.stuck, []), entry.id, e.status);
        if (store.set(KEY.stuck, moved.stuck)) saveOutbox(moved.outbox);
      }
    }
  } finally { flushing = false; drawStatus(); }
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
          <td>${safetyLine(k, false)} ${feat().medical_tap ? html`<button class="btn small ghost" data-care="${k.person_id}">Care note</button>` : ''}</td>
          <td class="num" style="text-align:right"><b>${showCode(k.security_code)}</b></td></tr>`)}</tbody></table>` : html`<p class="muted">Empty</p>`}</div>`;
    })}
    <p class="muted small">${list.filter((c) => !c.checked_out_at).length} checked in now · ${list.length} today</p>`);
  $main.querySelector('[data-refresh]').onclick = drawRooms;
  $main.querySelectorAll('[data-care]').forEach((b) => { b.onclick = () => showCareNote(Number(b.dataset.care)); });
}

// Level 2: the longer medical note is asked for when someone taps, from the hub, and every look is logged there.
// It is never kept on the iPad, so with no connection all there is to show is the safety line.
async function showCareNote(personId) {
  if (!navigator.onLine) { toast('The care note needs a connection. The safety line on this screen is still right.', 'bad'); return; }
  let note;
  try { note = await call('GET', `/checkin/medical/${personId}?campus_id=${state.station.campusId}`); } catch (e) { fail(e); return; }
  const kid = todays().find((c) => c.person_id === personId);
  await dialog({
    title: `Care note${kid ? `: ${displayName(kid)}` : ''}`, submit: false, cancel: 'Close',
    body: html`<div class="stack">
      ${hasEpi(note) ? html`<div class="alert bad"><b>EPI: YES</b>${note.allergy_action ? ` · ${note.allergy_action}` : ''}</div>` : ''}
      ${note.allergies ? html`<p style="margin:0"><span class="allergy">Allergies:</span> ${note.allergies}</p>` : ''}
      ${note.medical_notes ? html`<p style="margin:0;white-space:pre-wrap">${note.medical_notes}</p>` : html`<p class="muted" style="margin:0">No other medical notes.</p>`}
      <p class="muted small" style="margin:0">Looking at this is recorded. Please don’t repeat it to anyone who doesn’t need it.</p></div>`,
  });
}

// ---------------------------------------------------------------- printing
// What is printed where other families can see it: a first name and last-name initial, the room, the date and
// the check-in time, and the code. Never the family name or the full last name. Medical details print at Level 1
// only: the allergen words, "EPI: YES" and a one-line action. The longer medical note is never printed.
function printLabels(chosen, code, at) {
  const size = LABELS[state.roster.label_size] || LABELS['brother-62x29'];
  const when = new Date(at);
  const date = when.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  const time = when.toTimeString().slice(0, 5);
  // Check the name against every child who could be in the same room, not only those checked in so far.
  const allKids = state.roster.households.flatMap((x) => x.members.filter((m) => m.household_role === 'child'));
  const eligible = (room) => [...allKids.filter((k) => room && roomFor(k, state.roster.rooms, day())?.id === room.id), ...chosen.filter((c) => (c.room?.id ?? null) === (room?.id ?? null)).map((c) => c.kid)];
  const overflow = feat().label_overflow;
  const area = document.querySelector('[data-print]');
  area.innerHTML = labelCss(size)
    + chosen.map(({ kid, room }) => kidLabelHtml({ kid, name: labelName(kid, eligible(room), day()), room, code, date, time, size, overflow })).join('')
    + (state.roster.print_parent_tag ? parentTagHtml({ kids: chosen.map((c) => c.kid), code, date, time, size }) : '');
  setTimeout(() => window.print(), 50);
}

boot().catch(fail);
