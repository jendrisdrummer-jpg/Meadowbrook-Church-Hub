// The app's Events: a month calendar with everything coming up (events, and service times if you
// like), and each event's page with its sign-up form. Paid sign-ups use Stripe's card form inside
// the page. ctx: { app, setTitle, signInHref }
import { get, post, html, mount, icon, fmtDate, fmtTime, toast, fail } from '../lib.js';
import { loadStripe } from '../give.js';

const money = (c) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const clock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const iso = (d) => d.toLocaleDateString('en-CA');
const remembered = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

// Guests' sign-ups are remembered on this phone, so the event page can show them again.
const mySignups = () => { try { return JSON.parse(localStorage.getItem('mb.signups') || '{}'); } catch { return {}; } };
const keepSignup = (eventId, s) => remember('mb.signups', JSON.stringify({ ...mySignups(), [eventId]: { id: s.id, key: s.key } }));
const forgetSignup = (eventId) => { const all = mySignups(); delete all[eventId]; remember('mb.signups', JSON.stringify(all)); };

export function whenText(e, { long = false } = {}) {
  const opts = long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' };
  const day = fmtDate(e.starts_at.slice(0, 10), opts);
  if (e.all_day) {
    const endDay = e.ends_at?.slice(0, 10);
    return endDay && endDay !== e.starts_at.slice(0, 10) ? `${day} – ${fmtDate(endDay, opts)}` : day;
  }
  const end = e.ends_at ? (e.ends_at.slice(0, 10) === e.starts_at.slice(0, 10) ? ` – ${fmtTime(e.ends_at)}` : ` – ${fmtDate(e.ends_at.slice(0, 10), opts)} ${fmtTime(e.ends_at)}`) : '';
  return `${day} · ${fmtTime(e.starts_at)}${end}`;
}

export function badge(e) {
  const s = e.sign_ups || {};
  if (e.mine) return html`<span class="pill good">You’re going</span>`;
  if (!e.signup) return '';
  if (!s.open) return html`<span class="pill">${s.closed?.includes('full') ? 'Full' : 'Closed'}</span>`;
  return html`<span class="pill info">${e.price_cents ? money(e.price_cents) : 'Sign up'}</span>`;
}

const dateTile = (d) => html`<span class="ev-date"><small>${fmtDate(d, { month: 'short' })}</small><b>${Number(d.slice(8, 10))}</b></span>`;

// ---------------------------------------------------------------- the calendar
export async function eventsPage(el, tab, ctx) {
  const { app } = ctx;
  ctx.setTitle(tab.label);
  let month = remembered('mb.app.evMonth', '') || iso(new Date()).slice(0, 7);
  if (month < iso(new Date()).slice(0, 7)) month = iso(new Date()).slice(0, 7);
  let services = remembered('mb.app.evServices', '1') === '1';
  let campus = Number(remembered('mb.app.evCampus', '')) || null;
  const today = iso(new Date());

  async function draw() {
    const first = `${month}-01`;
    const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const last = `${month}-${String(days).padStart(2, '0')}`;
    const events = (await get(`/events?from=${first < today && month === today.slice(0, 7) ? today : first}&to=${last}`))
      .filter((e) => !campus || !e.campus_id || e.campus_id === campus);
    // Each event shows on every day it spans; repeating services fill in by weekday.
    const items = [];
    for (const e of events) {
      const endDay = (e.ends_at || e.starts_at).slice(0, 10);
      for (let d = e.starts_at.slice(0, 10); d <= endDay && d <= last; d = iso(new Date(new Date(`${d}T12:00`).getTime() + 864e5))) {
        if (d >= first && d >= (month === today.slice(0, 7) ? today : first)) items.push({ day: d, kind: 'event', e, sort: d === e.starts_at.slice(0, 10) && !e.all_day ? e.starts_at.slice(11) : '00:00' });
      }
    }
    if (services) {
      for (let i = 1; i <= days; i++) {
        const d = `${month}-${String(i).padStart(2, '0')}`;
        if (d < today) continue;
        const dow = new Date(`${d}T12:00`).getDay();
        for (const t of app.times.filter((x) => x.day_of_week === dow && (!campus || x.campus_id === campus))) items.push({ day: d, kind: 'service', t, sort: t.start_time });
      }
    }
    items.sort((a, b) => a.day.localeCompare(b.day) || (a.kind === 'event' && a.e.all_day ? -1 : 0) || a.sort.localeCompare(b.sort));
    const byDay = Map.groupBy(items, (x) => x.day);
    const label = new Date(`${first}T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const lead = new Date(`${first}T12:00`).getDay();
    const canBack = month > today.slice(0, 7);
    mount(el, html`<div class="card m-cal-card">
        <div class="row"><button class="btn small ghost" data-shift="-1" ${canBack ? '' : 'disabled'} aria-label="Previous month">‹</button><b class="m-cal-title">${label}</b><button class="btn small ghost" data-shift="1" aria-label="Next month">›</button></div>
        <div class="m-chips"><button class="chip ${services ? 'on' : ''}" data-services>${icon(services ? 'check' : 'plus', 'ic small-ic')} Service times</button>
          ${app.campuses.length > 1 ? [{ id: null, short_name: 'All campuses' }, ...app.campuses].map((c) => html`<button class="chip ${campus === c.id ? 'on' : ''}" data-campus="${c.id ?? ''}">${c.short_name || c.name}</button>`) : ''}</div>
        <div class="m-cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => html`<span class="dow">${d}</span>`)}
          ${Array.from({ length: lead }, () => html`<span></span>`)}
          ${Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, '0')}`;
            const list = byDay.get(day);
            const hasEvent = list?.some((x) => x.kind === 'event');
            return html`<button class="day ${list ? 'has' : ''} ${hasEvent ? 'mine' : ''} ${day === today ? 'today' : ''}" ${list ? '' : 'disabled'} data-day="${day}">${i + 1}</button>`;
          })}</div>
      </div>
      ${items.length ? [...byDay].map(([day, list]) => html`<div class="m-day" id="d-${day}"><h3>${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}${day === today ? ' · Today' : ''}</h3>
        <div class="card m-list ev-list">${list.map((x) => (x.kind === 'event'
          ? html`<a href="#/events/${x.e.id}" class="ev-row">${x.e.image ? html`<img src="${x.e.image}" alt="" class="ev-thumb">` : dateTile(day)}
              <span class="grow"><b>${x.e.title}</b><br><span class="muted small">${x.e.all_day ? 'All day' : day === x.e.starts_at.slice(0, 10) ? fmtTime(x.e.starts_at) : 'Continues'}${x.e.location ? ` · ${x.e.location}` : ''}</span></span>${badge(x.e)}</a>`
          : html`<div class="ev-row ev-svc"><span class="m-svc-time">${clock(x.t.start_time)}</span><span class="grow">${app.campuses.length > 1 ? x.t.campus_name : 'Service'}<br><span class="muted small">${app.campuses.length > 1 ? 'Service' : x.t.campus_name}</span></span></div>`))}</div></div>`)
        : html`<div class="m-empty">${icon('calendar')}<p>Nothing on the calendar in ${label} yet.</p></div>`}`);
  }

  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.shift) {
      const [y, m] = month.split('-').map(Number);
      month = iso(new Date(y, m - 1 + Number(b.dataset.shift), 1)).slice(0, 7);
      remember('mb.app.evMonth', month);
      draw().catch(fail);
    } else if (b.matches('[data-services]')) {
      services = !services;
      remember('mb.app.evServices', services ? '1' : '0');
      draw().catch(fail);
    } else if (b.dataset.campus !== undefined) {
      campus = Number(b.dataset.campus) || null;
      remember('mb.app.evCampus', campus ?? '');
      draw().catch(fail);
    } else if (b.dataset.day) {
      el.querySelector(`#d-${b.dataset.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  await draw();
}

// ---------------------------------------------------------------- one event
export async function eventPage(el, id, q, ctx) {
  const { app } = ctx;
  const back = app.config.tabs.find((t) => t.type === 'events');
  ctx.setTitle('Event', html`<a class="btn small ghost" href="#/${back?.id || 'events'}">Back</a>`);
  const e = await get(`/events/${id}`);
  // A sign-up to show: from the link in the email, this phone, or the signed-in account.
  let ref = q.get('signup') && q.get('key') ? { id: q.get('signup'), key: q.get('key') } : mySignups()[e.id] || (e.mine ? { id: e.mine.id, key: e.mine.key } : null);
  if (q.get('signup')) { keepSignup(e.id, ref); history.replaceState(null, '', `#/events/${e.id}`); }
  let signup = ref ? await get(`/event-signups/${ref.id}?key=${ref.key}`).catch(() => null) : null;
  if (signup && ['canceled', 'refunded'].includes(signup.status)) { forgetSignup(e.id); signup = null; }

  const mapLink = e.address ? `https://maps.google.com/?q=${encodeURIComponent(e.address)}` : '';
  mount(el, html`${e.image ? html`<img src="${e.image}" alt="" class="ev-hero">` : ''}
    <div class="card ev-head"><h2>${e.title}</h2>
      <div class="ev-fact">${icon('clock')}<span>${whenText(e, { long: true })}</span></div>
      ${e.location || e.address ? html`<div class="ev-fact">${icon('map')}<span>${e.location}${e.location && e.address ? html`<br>` : ''}${mapLink ? html`<a href="${mapLink}" target="_blank" rel="noopener">${e.address}</a>` : ''}</span></div>` : ''}
      ${e.campus_name ? html`<div class="ev-fact">${icon('home')}<span>${e.campus_name}</span></div>` : ''}
      ${e.price_cents ? html`<div class="ev-fact">${icon('heart')}<span>${money(e.price_cents)} per person</span></div>` : ''}
      ${e.description ? html`<p class="ev-desc">${e.description}</p>` : ''}</div>
    <div data-signup></div>`);
  const box = el.querySelector('[data-signup]');

  function drawSignedUp(s) {
    const pending = s.status === 'pending';
    mount(box, html`<div class="card ev-done">${icon(pending ? 'clock' : 'check')}
      <h2>${pending ? 'Finishing your payment…' : 'You’re signed up!'}</h2>
      <p class="muted" style="margin:0">${s.count} ${s.count === 1 ? 'person' : 'people'}${s.amount_cents ? ` · ${money(s.amount_cents)}${pending ? '' : ' paid'}` : ''}${s.email ? ` · confirmation sent to ${s.email}` : ''}</p>
      ${!pending && !s.amount_cents ? html`<button class="btn small ghost danger" data-cancel>Can’t make it? Cancel</button>` : ''}
      ${!pending && s.amount_cents ? html`<p class="muted small" style="margin:0">Need to cancel? Contact the church office for a refund.</p>` : ''}</div>`);
    if (pending) setTimeout(async () => {
      const again = await get(`/event-signups/${s.id}?key=${ref.key}`).catch(() => null);
      if (again && el.isConnected) drawSignedUp(again);
    }, 2500);
  }

  function drawForm() {
    const st = e.sign_ups;
    if (!e.signup) return mount(box, '');
    if (!st.open) return mount(box, html`<div class="card"><p style="margin:0"><b>${st.closed}</b></p></div>`);
    const max = Math.min(e.max_per, st.spots_left ?? e.max_per);
    let count = 1;
    mount(box, html`<form class="card m-form ev-form" novalidate><h2 style="margin:0 0 10px">Sign up</h2>
      ${st.spots_left !== null ? html`<p class="muted small" style="margin:-4px 0 12px">${st.spots_left} spot${st.spots_left === 1 ? '' : 's'} left</p>` : ''}
      ${app.user ? html`<p class="small" style="margin:0 0 12px">Signing up as <b>${app.user.name}</b></p>`
        : html`<label class="field">Your name<input type="text" name="name" autocomplete="name" required></label>
          <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
          <label class="field">Phone (optional)<input type="tel" name="phone" autocomplete="tel"></label>`}
      ${max > 1 ? html`<div class="field"><span>How many people?</span><div class="ev-count"><button type="button" class="btn" data-step="-1" aria-label="Fewer">−</button><b data-count>1</b><button type="button" class="btn" data-step="1" aria-label="More">+</button></div></div>` : ''}
      ${e.questions.map((qq) => html`<div class="field"><span>${qq.label}${qq.required ? ' *' : ''}</span>
        ${qq.type === 'choice' ? html`<select name="q_${qq.id}"><option value="">Choose…</option>${qq.options.map((o) => html`<option>${o}</option>`)}</select>`
          : qq.type === 'yesno' ? html`<div class="row" style="gap:16px"><label class="check"><input type="radio" name="q_${qq.id}" value="yes"> Yes</label><label class="check"><input type="radio" name="q_${qq.id}" value="no"> No</label></div>`
          : html`<input type="text" name="q_${qq.id}" maxlength="1000">`}</div>`)}
      <button class="btn primary ev-go">${e.price_cents ? `Pay ${money(e.price_cents)} and sign up` : 'Sign up'}</button>
      ${e.price_cents ? html`<p class="muted small" style="margin:8px 0 0;text-align:center">${icon('lock', 'ic small-ic')} Secure card payment by Stripe</p>` : ''}
    </form><div data-pay></div>`);
    const form = box.querySelector('form');
    const go = form.querySelector('.ev-go');
    const label = () => (e.price_cents ? `Pay ${money(e.price_cents * count)} and sign up` : count > 1 ? `Sign up ${count} people` : 'Sign up');
    form.onclick = (ev) => {
      const b = ev.target.closest('[data-step]');
      if (!b) return;
      count = Math.max(1, Math.min(max, count + Number(b.dataset.step)));
      form.querySelector('[data-count]').textContent = count;
      go.textContent = label();
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const answers = Object.fromEntries(e.questions.map((qq) => [qq.id, qq.type === 'yesno' ? form.querySelector(`[name="q_${qq.id}"]:checked`)?.value || '' : form.elements[`q_${qq.id}`].value]));
      go.disabled = true;
      go.textContent = e.price_cents ? 'Opening secure payment…' : 'Signing you up…';
      try {
        const res = await post(`/events/${e.id}/signups`, { name: form.elements.name?.value, email: form.elements.email?.value, phone: form.elements.phone?.value, count, answers });
        keepSignup(e.id, res);
        ref = { id: res.id, key: res.key };
        if (!res.client_secret) {
          toast('You’re signed up!');
          return drawSignedUp(await get(`/event-signups/${res.id}?key=${res.key}`));
        }
        const stripe = await loadStripe(e.publishable_key);
        form.classList.add('hidden');
        const pay = box.querySelector('[data-pay]');
        mount(pay, html`<div class="give-checkout" data-mount></div>`);
        const checkout = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => res.client_secret,
          onComplete: async () => { checkout.destroy(); window.scrollTo(0, 0); drawSignedUp(await get(`/event-signups/${res.id}?key=${res.key}`)); },
        });
        checkout.mount(pay.querySelector('[data-mount]'));
        pay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        fail(err);
        go.disabled = false;
        go.textContent = label();
      }
    };
  }

  box.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-cancel]')) return;
    try {
      await post(`/event-signups/${ref.id}/cancel?key=${ref.key}`, {});
      forgetSignup(e.id);
      toast('Canceled. Thanks for letting us know.');
      eventPage(el, id, new URLSearchParams(), ctx);
    } catch (err) { fail(err); }
  });
  if (signup) drawSignedUp(signup); else drawForm();
}
