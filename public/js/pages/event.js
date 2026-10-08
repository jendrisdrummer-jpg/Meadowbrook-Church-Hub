// One event: its details (what shows in the app) and, with sign-ups on, who's coming.
import { get, post, patch, del, api, html, mount, icon, options, toast, fail, confirm, dialog, formData, pickPerson, shrinkImage, displayName, fmtDate } from '../lib.js';
import { state, setTitle, go, visibleCampuses } from '../app.js';
import { eventWhen } from './events.js';

const money = (c) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QTYPES = { text: 'Short answer', choice: 'Pick one', yesno: 'Yes / No' };

export default async function eventPage(el, id, tab) {
  if (id === 'new') return editor(el, null);
  const e = await get(`/admin/events/${id}`);
  return tab === 'signups' ? signups(el, e) : editor(el, e);
}

function tabs(e, on) {
  return html`<div class="tabs"><button class="${on === 'details' ? 'on' : ''}" data-go="/events/${e.id}">Details</button>
    <button class="${on === 'signups' ? 'on' : ''}" data-go="/events/${e.id}/signups" ${e.signup ? '' : 'disabled title="Turn on sign-ups first"'}>Sign-ups</button></div>`;
}

// ---------------------------------------------------------------- details
function editor(el, e) {
  const today = new Date().toLocaleDateString('en-CA');
  const ev = e ? structuredClone(e) : {
    title: '', description: '', image: '', location: '', address: '', campus_id: state.me.campusIds ? state.campusId || state.me.campusIds[0] : null,
    starts_at: `${today}T18:00`, ends_at: null, all_day: false, visibility: 'public', published: false,
    signup: false, capacity: null, max_per: 10, signup_closes: null, price_cents: 0, questions: [],
  };
  let dirty = false;
  setTitle(e ? e.title : 'New event', html`${e ? html`<button class="btn ghost danger" data-delete>${icon('trash')} Delete</button>` : ''}<button class="btn primary" data-save>${e ? 'Save' : 'Create event'}</button>`);

  function draw() {
    const [sd, st] = ev.starts_at.split('T');
    const [ed, et] = (ev.ends_at || '').split('T');
    const [cd, ct] = (ev.signup_closes || '').split('T');
    mount(el, html`${e ? tabs(e, 'details') : ''}
      <form class="grid two event-form" data-form novalidate>
        <div class="card stack"><h2 style="margin:0">Details</h2>
          <label class="field">Title<input type="text" name="title" value="${ev.title}" maxlength="140" required placeholder="Fall Revival"></label>
          <div class="field"><span>Picture</span><div class="row" style="gap:10px">
            ${ev.image ? html`<img src="${ev.image}" alt="" class="ev-pic"><button type="button" class="btn small ghost" data-unimage>Remove</button>` : ''}
            <label class="btn small">${icon('upload')} ${ev.image ? 'Replace' : 'Upload'}<input type="file" accept="image/*" data-image hidden></label></div>
            <span class="muted small">Shows at the top of the event in the app. A wide picture (16:9) looks best.</span></div>
          <label class="check"><input type="checkbox" name="all_day" ${ev.all_day ? 'checked' : ''}> All day</label>
          <div class="form">
            <label class="field">Starts<input type="date" name="sd" value="${sd}" required></label>
            ${ev.all_day ? '' : html`<label class="field">at<input type="time" name="st" value="${st}" required></label>`}
            <label class="field">Ends (optional)<input type="date" name="ed" value="${ed || ''}"></label>
            ${ev.all_day ? '' : html`<label class="field">at<input type="time" name="et" value="${et || ''}"></label>`}
          </div>
          <div class="form">
            <label class="field">Place<input type="text" name="location" value="${ev.location}" placeholder="Main sanctuary"></label>
            <label class="field">Address (for maps)<input type="text" name="address" value="${ev.address}" placeholder="100 Meadow Ln"></label>
          </div>
          <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), ev.campus_id, state.me.campusIds ? {} : { blank: 'All campuses' })}</select></label>
          <label class="field">Description<textarea name="description" rows="6" placeholder="What to expect, what to bring, who it’s for…">${ev.description}</textarea></label>
        </div>
        <div class="stack" style="gap:14px">
          <div class="card stack"><h2 style="margin:0">Who sees it</h2>
            <label class="toggle-row"><span><b>Published</b><br><span class="muted small">Drafts only show here in the hub.</span></span><input type="checkbox" class="switch" name="published" ${ev.published ? 'checked' : ''}></label>
            <label class="field">Visible to<select name="visibility">${options([{ value: 'public', label: 'Everyone, even guests' }, { value: 'members', label: 'Only people signed in' }], ev.visibility)}</select></label>
          </div>
          <div class="card stack"><h2 style="margin:0">Sign-ups</h2>
            <label class="toggle-row"><span><b>Take sign-ups</b><br><span class="muted small">People RSVP in the app and get a confirmation email.</span></span><input type="checkbox" class="switch" name="signup" ${ev.signup ? 'checked' : ''}></label>
            ${ev.signup ? html`<div class="form">
                <label class="field">Spots (people)<input type="number" name="capacity" min="1" value="${ev.capacity ?? ''}" placeholder="No limit"></label>
                <label class="field">Most per sign-up<input type="number" name="max_per" min="1" max="50" value="${ev.max_per}"></label>
                <label class="field">Price per person<input type="text" inputmode="decimal" name="price" value="${ev.price_cents ? (ev.price_cents / 100).toFixed(2) : ''}" placeholder="Free"></label>
                <label class="field">Sign-ups close<input type="date" name="cd" value="${cd || ''}"></label>
                ${cd ? html`<label class="field">at<input type="time" name="ct" value="${ct || '23:59'}"></label>` : ''}
              </div>
              <p class="muted small" style="margin:0">${ev.price_cents ? 'Paid by card through your Stripe account, and refundable from the Sign-ups tab.' : 'Leave the price blank for a free event.'} Without a closing date, sign-ups close when the event starts.</p>
              <div class="field"><span>Questions to ask</span>
                <div class="q-list">${ev.questions.map((q, i) => html`<div class="q-row" data-q="${i}">
                  <input type="text" data-qk="label" value="${q.label}" placeholder="Question, e.g. T-shirt size" maxlength="200">
                  <select data-qk="type">${options(Object.entries(QTYPES).map(([value, label]) => ({ value, label })), q.type)}</select>
                  <label class="check small"><input type="checkbox" data-qk="required" ${q.required ? 'checked' : ''}> Required</label>
                  <button type="button" class="icon-btn danger" data-qdel="${i}" title="Remove">${icon('x')}</button>
                  ${q.type === 'choice' ? html`<input type="text" data-qk="options" class="q-opts" value="${(q.options || []).join(', ')}" placeholder="Choices, separated by commas: Small, Medium, Large">` : ''}
                </div>`)}</div>
                ${ev.questions.length < 12 ? html`<button type="button" class="btn small ghost" data-qadd>${icon('plus')} Add a question</button>` : ''}</div>` : ''}
          </div>
        </div>
      </form>`);
  }

  // Keep the form's values in ev, so redraws (all day, sign-ups on…) don't lose typing.
  function read() {
    const f = el.querySelector('[data-form]');
    const d = formData(f);
    const t = (date, time, fallback) => (date ? `${date}T${ev.all_day ? fallback : time || fallback}` : null);
    Object.assign(ev, {
      title: d.title, description: d.description, location: d.location, address: d.address,
      campus_id: d.campus_id ? Number(d.campus_id) : null, all_day: d.all_day, published: d.published, visibility: d.visibility, signup: d.signup,
      starts_at: t(d.sd, d.st, '00:00') || ev.starts_at,
      ends_at: t(d.ed, d.et, '23:59'),
    });
    if ('capacity' in d) {
      Object.assign(ev, {
        capacity: d.capacity ? Number(d.capacity) : null, max_per: Number(d.max_per) || 10, price: d.price,
        price_cents: Math.round(Number(String(d.price || 0).replace(/[$,\s]/g, '')) * 100) || 0,
        signup_closes: d.cd ? `${d.cd}T${d.ct || '23:59'}` : null,
      });
    }
    f.querySelectorAll('[data-q]').forEach((row) => {
      const q = ev.questions[row.dataset.q];
      q.label = row.querySelector('[data-qk=label]').value;
      q.type = row.querySelector('[data-qk=type]').value;
      q.required = row.querySelector('[data-qk=required]').checked;
      const opts = row.querySelector('[data-qk=options]');
      if (opts) q.options = opts.value.split(',').map((x) => x.trim()).filter(Boolean);
    });
  }

  el.oninput = () => { dirty = true; };
  el.onchange = async (x) => {
    dirty = true;
    const t = x.target;
    if (t.matches('[data-image]') && t.files[0]) {
      read();
      try { toast('Uploading…'); ev.image = (await api('POST', '/app/images', await shrinkImage(t.files[0], 1600))).url; } catch (err) { fail(err); }
      return draw();
    }
    if (['all_day', 'signup', 'cd'].includes(t.name) || t.dataset.qk === 'type') { read(); draw(); }
  };
  el.onclick = (x) => {
    const b = x.target.closest('button');
    if (!b) return;
    if (b.dataset.go) return go(b.dataset.go);
    if (b.matches('[data-unimage]')) { read(); ev.image = ''; dirty = true; return draw(); }
    if (b.matches('[data-qadd]')) { read(); ev.questions.push({ id: `q${Date.now().toString(36)}`, label: '', type: 'text', required: false }); return draw(); }
    if (b.dataset.qdel) { read(); ev.questions.splice(Number(b.dataset.qdel), 1); dirty = true; return draw(); }
  };

  document.querySelector('[data-actions] [data-save]').onclick = async () => {
    read();
    // With sign-ups off the price is left as it was (it can't change once people have paid).
    const body = { ...ev, price: ev.signup ? (ev.price_cents / 100).toFixed(2) : undefined, questions: ev.questions };
    try {
      const saved = e ? await patch(`/admin/events/${e.id}`, body) : await post('/admin/events', body);
      dirty = false;
      toast(saved.published ? 'Saved. It’s on the app’s calendar.' : 'Saved as a draft.');
      if (!e) go(`/events/${saved.id}`); else editor(el, saved);
    } catch (err) { fail(err); }
  };
  document.querySelector('[data-actions] [data-delete]')?.addEventListener('click', async () => {
    if (!(await confirm('Delete this event?', 'It comes off the app’s calendar. If anyone paid, it’s hidden instead so the payments stay on record.', 'Delete'))) return;
    try { await del(`/admin/events/${e.id}`); dirty = false; toast('Deleted.'); go('/events'); } catch (err) { fail(err); }
  });
  window.onbeforeunload = (x) => { if (dirty) { x.preventDefault(); x.returnValue = ''; } };
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });
  draw();
}

// ---------------------------------------------------------------- sign-ups
async function signups(el, e) {
  const d = await get(`/admin/events/${e.id}/signups`);
  const ev = d.event;
  const live = d.rows.filter((s) => s.status === 'confirmed');
  const people = live.reduce((n, s) => n + s.count, 0);
  const paid = live.reduce((n, s) => n + s.amount_cents, 0);
  const STATUS = { pending: html`<span class="pill warn">Paying…</span>`, canceled: html`<span class="pill">Canceled</span>`, refunded: html`<span class="pill">Refunded</span>` };
  setTitle(ev.title, html`<a class="btn ghost" href="/api/admin/events/${ev.id}/signups.csv">${icon('download')} Export CSV</a><button class="btn primary" data-add>${icon('plus')} Add someone</button>`);
  mount(el, html`${tabs(ev, 'signups')}
    <div class="stats">
      <div class="stat"><b>${people}</b><span>${people === 1 ? 'person' : 'people'} coming</span></div>
      <div class="stat"><b>${live.length}</b><span>sign-ups</span></div>
      <div class="stat"><b>${ev.capacity ? Math.max(0, ev.capacity - d.sign_ups.taken) : '∞'}</b><span>spots left</span></div>
      ${ev.price_cents ? html`<div class="stat"><b>${money(paid)}</b><span>paid</span></div>` : ''}
    </div>
    <p class="muted small" style="margin:-4px 0 12px">${eventWhen(ev)} · ${d.sign_ups.open ? 'Sign-ups are open' : d.sign_ups.closed || 'Sign-ups are closed'}</p>
    <div class="card table-scroll"><table class="list"><thead><tr><th>Name</th><th>People</th>${ev.questions.map((q) => html`<th>${q.label}</th>`)}${ev.price_cents ? html`<th>Paid</th>` : ''}<th>Signed up</th><th></th></tr></thead><tbody>
      ${d.rows.map((s) => html`<tr class="${s.status === 'confirmed' ? '' : 'muted'}">
        <td>${s.person_id ? html`<a href="#/people/${s.person_id}"><b>${s.name}</b></a>` : html`<b>${s.name}</b>`}${s.email || s.phone ? html`<div class="muted small">${[s.email, s.phone].filter(Boolean).join(' · ')}</div>` : ''}</td>
        <td>${s.count}</td>${ev.questions.map((q) => html`<td>${s.answers[q.id] || html`<span class="muted">—</span>`}</td>`)}
        ${ev.price_cents ? html`<td class="nowrap">${s.amount_cents ? money(s.amount_cents) : s.added_by ? html`<span class="muted small">Added by staff</span>` : '—'}</td>` : ''}
        <td class="nowrap small">${fmtDate(s.created_at.slice(0, 10))} ${STATUS[s.status] || ''}</td>
        <td style="text-align:right">${['confirmed', 'pending'].includes(s.status) ? html`<button class="btn small ghost danger" data-cancel="${s.id}" data-paid="${s.status === 'confirmed' && s.stripe_pi ? 1 : ''}">${s.status === 'confirmed' && s.stripe_pi ? 'Cancel & refund' : 'Cancel'}</button>` : ''}</td></tr>`)}
      ${d.rows.length ? '' : html`<tr><td colspan="9" class="muted">No sign-ups yet.</td></tr>`}</tbody></table></div>`);

  el.onclick = async (x) => {
    const b = x.target.closest('button');
    if (!b) return;
    if (b.dataset.go) return go(b.dataset.go);
    if (b.dataset.cancel) {
      const refund = Boolean(b.dataset.paid);
      if (!(await confirm(refund ? 'Cancel and refund?' : 'Cancel this sign-up?', refund ? 'Their card is refunded in full through Stripe. It can take 5–10 days to show up.' : 'Their spot opens up for someone else.', refund ? 'Refund' : 'Cancel sign-up'))) return;
      try { await post(`/admin/event-signups/${b.dataset.cancel}/cancel`, { refund }); toast(refund ? 'Refunded.' : 'Canceled.'); signups(el, ev); } catch (err) { fail(err); }
    }
  };
  document.querySelector('[data-actions] [data-add]').onclick = async () => {
    let person = null;
    const ok = await dialog({
      title: 'Add someone',
      body: html`<div class="form">
        <div class="field wide"><span>From People (optional)</span><button type="button" class="btn small" data-pick>${icon('search')} Choose a person</button> <b data-picked></b></div>
        <label class="field">Name<input type="text" name="name"></label>
        <label class="field">How many people<input type="number" name="count" min="1" value="1"></label>
        <label class="field">Email<input type="email" name="email"></label>
        <label class="field">Phone<input type="tel" name="phone"></label>
        ${ev.questions.map((q) => html`<label class="field wide">${q.label}${q.type === 'choice' ? html`<select name="q_${q.id}"><option value=""></option>${q.options.map((o) => html`<option>${o}</option>`)}</select>`
          : q.type === 'yesno' ? html`<select name="q_${q.id}"><option value=""></option><option>Yes</option><option>No</option></select>` : html`<input type="text" name="q_${q.id}">`}</label>`)}
        <p class="muted small wide" style="margin:0">For people who signed up in person or by phone. ${ev.price_cents ? 'They’re marked as added by staff (collect payment at the door).' : ''}</p></div>`,
      submit: 'Add',
      onOpen: (dlg) => {
        dlg.querySelector('[data-pick]').onclick = async () => {
          const p = await pickPerson('Who’s coming?');
          if (!p) return;
          person = p;
          dlg.querySelector('[data-picked]').textContent = displayName(p);
          dlg.querySelector('[name=name]').value = displayName(p);
          if (p.email) dlg.querySelector('[name=email]').value = p.email;
        };
      },
      onSubmit: (f) => {
        const v = formData(f);
        return post(`/admin/events/${ev.id}/signups`, { person_id: person?.id, name: v.name, count: v.count, email: v.email, phone: v.phone, answers: Object.fromEntries(ev.questions.map((q) => [q.id, v[`q_${q.id}`]])) });
      },
    });
    if (ok) { toast('Added.'); signups(el, ev); }
  };
}
