// The "This week" Home card: the next service at the member's campus, what they're serving, the
// events they've said they're going to, and at most one next step. Guests see service times only.
// Everything comes from endpoints that already exist and only ever return the caller's own data.
import { html, icon, fmtDate, fmtTime, get, DAYS } from '../lib.js';
import { whenText } from './events.js';

const ymd = (d) => d.toLocaleDateString('en-CA');

// Fetches what the card needs beyond the app config and the member's schedule: their events this week.
export async function loadThisWeek(app, { preview = false } = {}) {
  if (!app.user || preview) return { events: [] };
  const from = new Date();
  const to = new Date(from.getTime() + 6 * 864e5);
  const events = await get(`/events?from=${ymd(from)}&to=${ymd(to)}`).catch(() => []);
  return { events: events.filter((e) => e.mine?.status === 'confirmed') };
}

// This week's non-declined assignments, requests waiting for a reply first.
export function servingThisWeek(assignments = [], now = new Date()) {
  const end = `${ymd(new Date(now.getTime() + 6 * 864e5))}T23:59`;
  const start = `${ymd(now)}T00:00`;
  return assignments.filter((a) => a.status !== 'declined' && a.starts_at >= start && a.starts_at <= end)
    .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || a.starts_at.localeCompare(b.starts_at));
}

// The services to show: the member's own campus when it has any, otherwise each campus's next one.
export function servicesFor(app, nextService) {
  const mine = app.user?.campus_id;
  const own = mine ? app.times.filter((t) => t.campus_id === mine) : [];
  const pool = own.length ? own : app.times;
  const byCampus = Map.groupBy(pool, (t) => t.campus_id);
  const out = [...byCampus.values()].map((list) => nextService(list)).filter(Boolean).sort((a, b) => a.start - b.start);
  return own.length ? out.slice(0, 1) : out.slice(0, 3);
}

// h: { nextService, clock, tabFor, signInHref } from widgets.js (passed in so the two files don't import each other).
export function thisWeekInner(w, ctx, h) {
  const { app } = ctx;
  const title = w.title || `This week at ${app.church_name}`;
  const now = new Date();
  const services = servicesFor(app, h.nextService);
  const multi = app.campuses.length > 1;
  const serviceRows = services.length ? services.map(({ t, start }) => {
    const day = start.toDateString() === now.toDateString() ? 'Today' : DAYS[t.day_of_week];
    return html`<div class="tw-row">${icon('clock')}<span class="grow"><b>${day} at ${h.clock(t.start_time)}</b>${multi ? html`<br><span class="w-sub">${t.campus_name}</span>` : ''}</span></div>`;
  }) : html`<div class="tw-row">${icon('clock')}<span class="grow w-sub">Service times will show here once they’re set up.</span></div>`;

  if (!app.user) {
    return html`<h2>${title}</h2><div class="tw-sec"><span class="w-sub tw-label">Next service</span>${serviceRows}</div>
      <a class="btn small primary" href="${h.signInHref('/')}">Sign in to see your week</a>`;
  }

  const serving = servingThisWeek(ctx.mine?.assignments, now);
  const events = (ctx.week?.events || []).slice(0, 3);
  const serveTab = `#/${h.tabFor('serve')}`;
  const waiting = serving.find((a) => a.status === 'pending');
  const live = services[0] && services[0].start <= now;
  // At most one call to action: a waiting reply first (unless Home's "Please reply" banner already shows it), then the livestream while it's on.
  const cta = waiting && ctx.replyBanner ? (live ? html`<a class="btn small primary" href="#/${h.tabFor('watch')}">${icon('play')} Watch live</a>` : '')
    : waiting ? html`<a class="btn small primary" href="${serveTab}">Reply to your request</a>`
    : live ? html`<a class="btn small primary" href="#/${h.tabFor('watch')}">${icon('play')} Watch live</a>` : '';

  const servingBlock = !app.user.linked
    ? html`<p class="w-sub" style="margin:0">Once the office connects your account to your record, what you’re serving will show here.</p>`
    : serving.length ? serving.slice(0, 3).map((a) => html`<a class="tw-row" href="${serveTab}">${icon('calendar')}<span class="grow"><b>${a.position}</b> · ${a.team}<br>
        <span class="w-sub">${fmtDate(a.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(a.starts_at)}${a.campus ? ` · ${a.campus}` : ''}</span></span>
        <span class="pill ${a.status === 'accepted' ? 'good' : 'warn'}">${a.status === 'accepted' ? 'Accepted' : 'Needs a reply'}</span></a>`)
      : html`<p class="w-sub" style="margin:0">Nothing on your schedule this week. Enjoy the rest.</p>`;
  const eventsBlock = events.length ? events.map((e) => html`<a class="tw-row" href="#/events/${e.id}">${icon('calendar')}<span class="grow"><b>${e.title}</b><br><span class="w-sub">${whenText(e)}</span></span></a>`)
    : html`<p class="w-sub" style="margin:0">No events you’re going to this week.</p>`;

  return html`<h2>${title}</h2>
    <div class="tw-sec"><span class="w-sub tw-label">Next service</span>${serviceRows}</div>
    <div class="tw-sec"><span class="w-sub tw-label">You’re serving</span>${servingBlock}</div>
    <div class="tw-sec"><span class="w-sub tw-label">Events you’re going to</span>${eventsBlock}</div>
    ${cta}`;
}
