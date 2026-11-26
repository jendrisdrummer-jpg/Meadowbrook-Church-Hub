import { get, patch, html, raw, mount, icon, fmtDate, fmtTime, toast, fail } from '../lib.js';
import { state, can, setTitle, campusQuery } from '../app.js';
import { greetingForHour } from '../greeting.js';
import { declineAssignment } from '../myschedule.js';

export default async function home(el) {
  const first = state.me.name.split(' ')[0];
  const hello = greetingForHour(new Date().getHours());
  setTitle(`${hello}, ${first}`);
  // The name is set in italics; the text is the same for screen readers and the tab title.
  const h1 = document.querySelector('[data-title]');
  h1.classList.add('greeting');
  h1.replaceChildren(`${hello}, `, Object.assign(document.createElement('em'), { textContent: first }));
  const d = await get(`/dashboard${campusQuery()}`);

  // Volunteers: anything waiting for a reply comes first, then what's coming up.
  const row = (a) => html`<tr>
        <td><b class="nowrap">${fmtDate(a.starts_at)}</b><br>${a.position}<br><span class="muted small">${fmtTime(a.starts_at)} · ${a.campus_short || a.campus}</span>
          ${a.status === 'pending' ? html`<div class="row" style="margin-top:8px"><button class="btn small primary" data-accept="${a.id}">Accept</button><button class="btn small" data-decline="${a.id}">Can’t make it</button></div>` : ''}</td>
        <td>${a.status === 'pending' ? html`<span class="pill warn">Please reply</span>` : html`<span class="pill good">${icon('check')} Accepted</span>`}</td></tr>`;
  const waitingReply = d.my_next.filter((a) => a.status === 'pending');
  const comingUp = d.my_next.filter((a) => a.status !== 'pending');
  const table = (list) => html`<table class="list pair"><tbody>${list.map(row)}</tbody></table>`;
  const volunteer = !can('leader');
  const mine = d.my_next.length
    ? html`${waitingReply.length ? html`${volunteer ? '' : html`<h3 class="home-sub warn">Please reply</h3>`}${table(waitingReply)}` : ''}
        ${comingUp.length ? html`${waitingReply.length ? html`<h3 class="home-sub">Coming up</h3>` : ''}${table(comingUp)}` : ''}`
    : html`<div class="empty">You’re not scheduled for anything coming up.</div>`;

  const setupHint = can('admin') && !state.campuses.length
    ? html`<div class="alert info" style="margin-bottom:14px">Welcome! Start in <a href="#/settings/campuses">Settings → Campuses</a> to add your campuses, then import people from Faith Teams in <a href="#/settings/import">Settings → Import</a>.</div>`
    : '';

  if (!can('leader')) {
    mount(el, html`${setupHint}<div class="card"><div class="card-head"><h2>${volunteer && waitingReply.length ? 'Please reply' : 'Your next times serving'}</h2><a href="#/my" class="btn small">My Schedule</a></div>${mine}</div>`);
    bind(el);
    return;
  }

  const a = d.attention;
  const staff = can('staff');
  const teams = !staff ? d.my_teams : [];
  const one = teams.length === 1 ? teams[0] : null;
  const dayName = (t) => (t ? new Date(`${t.slice(0, 10)}T12:00`).toLocaleDateString(undefined, { weekday: 'long' }) : '');
  const plural = (n, one1, many) => (n === 1 ? one1 : many);
  // Each tile is hidden at zero and links to where it's fixed.
  const tiles = [
    a.open_spots && { n: a.open_spots, text: one ? `open ${plural(a.open_spots, 'spot', 'spots')} on ${one.name} this ${dayName(a.open_next || one.next_service)}` : `open volunteer ${plural(a.open_spots, 'spot', 'spots')} this week`, href: '#/schedule', warn: true, team: true },
    a.not_replied && { n: a.not_replied, text: `${plural(a.not_replied, 'person hasn’t', 'people haven’t')} replied to a request`, href: '#/schedule', team: true },
    a.declines && { n: a.declines, text: `declined ${plural(a.declines, 'spot', 'spots')} to cover${a.declines_next ? ` (${fmtDate(a.declines_next)})` : ''}`,
      // To the soonest affected service's Who's serving tab, where Find a replacement is; the schedule if we don't know which.
      href: a.declines_service ? `#/services/${a.declines_service}` : '#/schedule', tab: a.declines_service ? 'people' : null, team: true },
    staff && a.connect_cards && { n: a.connect_cards, text: `connect ${plural(a.connect_cards, 'card', 'cards')} to follow up`, href: '#/connect' },
    staff && a.signups && { n: a.signups, text: `app ${plural(a.signups, 'sign-up', 'sign-ups')} to welcome`, href: '#/connect?tab=signups' },
    staff && a.forms_new && { n: a.forms_new, text: `new ${plural(a.forms_new, 'response', 'responses')}${a.forms_title ? `: ${a.forms_title}` : ''}`, href: '#/forms' },
  ].filter(Boolean).filter((t) => staff || t.team || a.connect_cards || a.signups);
  const tileRow = tiles.length
    ? html`<h2 class="home-label">${staff ? 'Needs your attention' : one ? 'Your team this week' : 'Needs your attention'}</h2>
        <div class="attn">${tiles.map((t) => html`<a class="attn-tile ${t.warn ? 'warn' : ''}" href="${t.href}" ${t.tab ? raw(`data-tab-go="${t.tab}"`) : ''}><b>${t.n}</b><span>${t.text}</span></a>`)}</div>`
    : html`<div class="attn-clear">${icon('check')} You’re all caught up. Nothing needs your attention right now.</div>`;

  const teamHead = teams.length
    ? html`<div class="home-team row">
        ${one ? html`<span class="dot" style="background:${one.color}"></span><h2>${one.name}</h2><span class="muted">${one.members} ${plural(one.members, 'person', 'people')}</span>`
          : html`<h2>Your teams</h2><span class="muted">${teams.map((t) => t.name).join(', ')}</span>`}
        <span class="spacer"></span>
        ${one?.chat_id ? html`<a class="btn" href="#/chat/${one.chat_id}">${icon('chat')} Message team</a>` : ''}
        <a class="btn primary" href="#/schedule" ${one ? raw(`data-sched-team="${one.id}"`) : ''}>${icon('teams')} Schedule ${one ? 'this team' : 'a team'}</a></div>`
    : '';

  const svcRow = (s) => {
    const pct = s.needed ? Math.min(100, Math.round((s.filled / s.needed) * 100)) : 0;
    const sub = teams.length && s.positions.length ? s.positions.map((p) => `${p.name} ${p.filled} of ${p.needed}`).join(' · ') : [s.series, s.title].filter(Boolean).join(' · ');
    return html`<div class="home-svc">
      <div class="home-svc-main"><span class="dot" style="background:${s.campus_color}"></span><a href="#/services/${s.id}"><b>${fmtDate(s.starts_at)} · ${fmtTime(s.starts_at)}</b></a> <span class="muted">${s.campus_short || s.campus}</span>
        ${sub ? html`<div class="muted small">${sub}</div>` : ''}
        ${s.items ? '' : html`<div class="small warn-text">No order of service yet</div>`}</div>
      <div class="home-svc-bar">${s.needed ? html`<div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <span class="muted small">${s.filled} of ${s.needed} filled${s.waiting ? ` · ${s.waiting} waiting to reply` : ''}${s.declined ? ` · ${s.declined} declined` : ''}</span>`
        : html`<span class="muted small">${s.accepted} accepted${s.waiting ? ` · ${s.waiting} waiting to reply` : ''}</span>`}</div>
      ${s.needed ? (s.open_total ? html`<span class="pill warn">${s.open_total} open</span>` : html`<span class="pill good">${icon('check')} Filled</span>`) : ''}
      <div class="home-svc-go"><a class="btn small" href="#/services/${s.id}" data-tab-go="people">Schedule</a><a class="btn small ghost" href="#/services/${s.id}" data-tab-go="counts">Attendance</a></div>
    </div>`;
  };
  const services = d.services.length
    ? html`<div class="card"><div class="card-head"><h2>${one ? `${one.name} this week` : 'This week’s services'}</h2><a href="#/services" class="btn small">All services</a></div>${d.services.map(svcRow)}</div>`
    : html`<div class="card empty">No services in the next 7 days. ${staff ? html`<a href="#/services">Add services</a>` : ''}</div>`;

  const away = d.blockouts_this_week;
  const awayCard = html`<div class="card"><div class="card-head"><h2>${teams.length ? 'Away on your team' : 'Away this week'}</h2>${away.length ? html`<span class="pill">${away.length} ${plural(away.length, 'person', 'people')}</span>` : ''}</div>${away.length
    ? html`<table class="list pair"><tbody>${away.map((b) => html`<tr><td>${b.nickname || b.first_name} ${b.last_name}${b.reason ? html`<br><span class="muted small">${b.reason}</span>` : ''}</td><td class="muted small">${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date)}` : ''}</td></tr>`)}</tbody></table>`
    : html`<div class="muted">Nobody has marked themselves away.</div>`}</div>`;

  const p = d.people;
  mount(el, html`${setupHint}${teamHead}${tileRow}
    <div class="grid two home-grid">
      <div class="stack">${services}</div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Your next time serving</h2><a href="#/my" class="btn small">My Schedule</a></div>${mine}</div>
        ${awayCard}
      </div>
    </div>
    ${staff ? html`<p class="home-totals muted small"><b>${p.total ?? 0}</b> people · <b>${p.members ?? 0}</b> members · <b>${p.new_guests ?? 0}</b> new guests in 30 days</p>` : ''}`);
  bind(el);
}

function bind(el) {
  el.onclick = async (e) => {
    // Remember which tab or team the link should open on; the link itself then does its normal thing.
    const go = e.target.closest('[data-tab-go]');
    if (go) { try { sessionStorage.setItem('mb.service.tab', go.dataset.tabGo); } catch { /* not remembered */ } }
    const sched = e.target.closest('[data-sched-team]');
    if (sched) {
      try { sessionStorage.setItem('mb.schedule', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('mb.schedule') || '{}'), teamId: Number(sched.dataset.schedTeam) })); } catch { /* not remembered */ }
    }
    const b = e.target.closest('[data-accept], [data-decline]');
    if (!b) return;
    try {
      if (b.dataset.decline) {
        if (await declineAssignment(b.dataset.decline)) home(el);
        return;
      }
      await patch(`/assignments/${b.dataset.accept}`, { status: 'accepted' });
      toast('Thanks for serving!');
      home(el);
    } catch (err) { fail(err); }
  };
}
