import { get, patch, html, mount, icon, fmtDate, fmtTime, toast, fail } from '../lib.js';
import { state, can, setTitle, campusQuery } from '../app.js';

export default async function home(el) {
  const first = state.me.name.split(' ')[0];
  setTitle(`Welcome, ${first}`);
  const d = await get(`/dashboard${campusQuery()}`);

  const mine = d.my_next.length
    ? html`<table class="list"><tbody>${d.my_next.map((a) => html`<tr>
        <td class="nowrap"><b>${fmtDate(a.starts_at)}</b><br><span class="muted small">${fmtTime(a.starts_at)} · ${a.campus_short || a.campus}</span></td>
        <td>${a.position}</td>
        <td style="text-align:right">${a.status === 'pending'
          ? html`<button class="btn small primary" data-accept="${a.id}">Accept</button>`
          : html`<span class="pill good">${icon('check')} Accepted</span>`}</td></tr>`)}</tbody></table>`
    : html`<div class="empty">You’re not scheduled for anything coming up.</div>`;

  const setupHint = can('admin') && !state.campuses.length
    ? html`<div class="alert info" style="margin-bottom:14px">Welcome! Start in <a href="#/settings/campuses">Settings → Campuses</a> to add your campuses, then import people from Faith Teams in <a href="#/settings/import">Settings → Import</a>.</div>`
    : '';

  if (!can('leader')) {
    mount(el, html`${setupHint}<div class="card"><div class="card-head"><h2>Your next times serving</h2><a href="#/my" class="btn small">My Schedule</a></div>${mine}</div>`);
    bind(el);
    return;
  }

  const services = d.services.length
    ? d.services.map((s) => html`<a class="card" href="#/services/${s.id}" style="display:block;color:inherit;text-decoration:none">
        <div class="row"><span class="dot" style="background:${s.campus_color}"></span><b>${fmtDate(s.starts_at)} · ${fmtTime(s.starts_at)}</b><span class="muted">${s.campus_short || s.campus}</span><span class="spacer"></span>
          ${s.open_total ? html`<span class="pill warn">${s.open_total} open</span>` : html`<span class="pill good">${icon('check')} Fully scheduled</span>`}</div>
        ${s.title || s.series ? html`<div class="muted small" style="margin-top:4px">${[s.series, s.title].filter(Boolean).join(' · ')}</div>` : ''}
        <div class="row small" style="margin-top:8px">
          <span class="pill good">${s.accepted} accepted</span>
          ${s.pending ? html`<span class="pill">${s.pending} waiting to reply</span>` : ''}
          ${s.declined ? html`<span class="pill bad">${s.declined} declined</span>` : ''}
          ${s.items ? html`<span class="pill info">${s.items} plan items</span>` : html`<span class="pill warn">No plan yet</span>`}
        </div>
        ${s.open_positions.length ? html`<div class="small muted" style="margin-top:8px">Still need: ${s.open_positions.map((p) => `${p.name}${p.open > 1 ? ` ×${p.open}` : ''}`).join(', ')}</div>` : ''}
      </a>`)
    : html`<div class="card empty">No services in the next 7 days. ${can('staff') ? html`<a href="#/services">Add services</a>` : ''}</div>`;

  mount(el, html`${setupHint}
    <div class="stats">
      <div class="stat"><b>${d.people.total ?? 0}</b><span>People</span></div>
      <div class="stat"><b>${d.people.members ?? 0}</b><span>Members</span></div>
      <div class="stat"><b>${d.people.new_guests ?? 0}</b><span>New guests (30 days)</span></div>
      <div class="stat"><b>${d.services.reduce((a, s) => a + s.open_total, 0)}</b><span>Open volunteer spots this week</span></div>
    </div>
    <div class="grid two">
      <div class="stack"><h2>This week’s services</h2>${services}</div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Your next times serving</h2><a href="#/my" class="btn small">My Schedule</a></div>${mine}</div>
        <div class="card"><h2>Away this week</h2>${d.blockouts_this_week.length
          ? html`<table class="list"><tbody>${d.blockouts_this_week.map((b) => html`<tr><td>${b.nickname || b.first_name} ${b.last_name}</td><td class="muted small">${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date)}` : ''}</td><td class="muted small">${b.reason}</td></tr>`)}</tbody></table>`
          : html`<div class="muted">Nobody has marked themselves away.</div>`}</div>
      </div>
    </div>`);
  bind(el);
}

function bind(el) {
  el.onclick = async (e) => {
    const b = e.target.closest('[data-accept]');
    if (!b) return;
    try {
      await patch(`/assignments/${b.dataset.accept}`, { status: 'accepted' });
      toast('Thanks for serving!');
      home(el);
    } catch (err) { fail(err); }
  };
}
