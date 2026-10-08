// Connect cards guests send from the church app: follow up, add them to People, mark done.
import { get, post, patch, del, html, mount, icon, toast, fail, confirm, fmtDate, pickPerson, displayName } from '../lib.js';
import { setTitle, can, campusQuery, hashQuery } from '../app.js';

export default async function connect(el) {
  let status = 'open';
  // Connect cards, or people who created their own account in the app.
  let tab = hashQuery().get('tab') === 'signups' ? 'signups' : 'cards';
  setTitle('Connect cards', html`<div class="seg" role="tablist"><button data-tab="cards" class="${tab === 'cards' ? 'on' : ''}">Connect cards</button><button data-tab="signups" class="${tab === 'signups' ? 'on' : ''}">App sign-ups</button></div>
    <div class="seg" role="tablist"><button data-status="open" class="on">To follow up</button><button data-status="done">Done</button></div>`);
  const top = document.querySelector('[data-actions]');
  top.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    status = b.dataset.status;
    top.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  top.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    top.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));

  async function draw() {
    if (tab === 'signups') return drawSignups();
    const cards = (await get(`/connect-cards?status=${status}`)).filter((c) => !campusQuery() || !c.campus_id || campusQuery().endsWith(`=${c.campus_id}`));
    mount(el, cards.length ? html`<div class="grid two">${cards.map((c) => html`<div class="card">
        <div class="row"><b style="font-size:16px">${c.first_name} ${c.last_name}</b>${c.first_time ? html`<span class="pill info">First time</span>` : ''}<span class="spacer"></span>
          <span class="muted small">${fmtDate(c.created_at.slice(0, 10))}${c.campus_short || c.campus_name ? ` · ${c.campus_short || c.campus_name}` : ''}</span></div>
        <div class="row small" style="margin-top:6px">${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : ''}${c.phone ? html`<a href="tel:${c.phone}">${c.phone}</a>` : ''}</div>
        ${c.interests.length ? html`<div class="row" style="margin-top:8px">${c.interests.map((x) => html`<span class="pill">${x}</span>`)}</div>` : ''}
        ${c.message ? html`<p class="small" style="white-space:pre-line;margin:10px 0 0">“${c.message}”</p>` : ''}
        <div class="row" style="margin-top:12px">
          ${c.person_id ? html`<a class="btn small ghost" href="#/people/${c.person_id}">${icon('user')} ${c.person_first} ${c.person_last}</a>`
            : html`<button class="btn small" data-add="${c.id}">${icon('plus')} Add to People</button><button class="btn small ghost" data-link="${c.id}">Already in People…</button>`}
          <span class="spacer"></span>
          ${c.done_at ? html`<span class="muted small">Done${c.done_by_name ? ` by ${c.done_by_name}` : ''}</span><button class="btn small ghost" data-reopen="${c.id}">Reopen</button>`
            : html`<button class="btn small primary" data-done="${c.id}">${icon('check')} Followed up</button>`}
          ${can('staff') ? html`<button class="icon-btn danger" data-del="${c.id}" title="Delete">${icon('trash')}</button>` : ''}
        </div></div>`)}</div>`
      : html`<div class="card empty">${status === 'open' ? html`No connect cards waiting. Guests fill them in from the <b>Connect</b> tab of the church app.` : 'Nothing marked done yet.'}</div>`);

    el.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const card = cards.find((c) => c.id === Number(b.dataset.add || b.dataset.link || b.dataset.done || b.dataset.reopen || b.dataset.del));
      try {
        if (b.dataset.add) {
          const body = { first_name: card.first_name, last_name: card.last_name, email: card.email, phone: card.phone, campus_id: card.campus_id, new_household: true };
          let person;
          try {
            person = await post('/people', body);
          } catch (err) {
            if (err.status !== 409) throw err;
            const dup = err.data.duplicate;
            if (await confirm('Already in People?', `${displayName(dup)}${dup.email ? ` (${dup.email})` : ''} looks like the same person. Link this card to them?`, 'Link to them')) person = dup;
            else return;
          }
          await patch(`/connect-cards/${card.id}`, { person_id: person.id });
          toast(`${card.first_name} is in People.`);
        }
        if (b.dataset.link) {
          const p = await pickPerson(`Who is ${card.first_name} ${card.last_name}?`);
          if (!p) return;
          await patch(`/connect-cards/${card.id}`, { person_id: p.id });
        }
        if (b.dataset.done) await patch(`/connect-cards/${card.id}`, { done: true });
        if (b.dataset.reopen) await patch(`/connect-cards/${card.id}`, { done: false });
        if (b.dataset.del) {
          if (!(await confirm('Delete this connect card?', 'This can’t be undone.'))) return;
          await del(`/connect-cards/${card.id}`);
        }
        draw();
      } catch (err) { fail(err); }
    };
  }
  async function drawSignups() {
    const list = (await get(`/signups?status=${status}`)).filter((p) => !campusQuery() || !p.campus_id || campusQuery().endsWith(`=${p.campus_id}`));
    mount(el, html`<p class="muted" style="margin-top:-6px">People who created their own account in the church app. They’re already in People; give them a household and campus, and say hello.</p>
      ${list.length ? html`<div class="card"><table class="list"><tbody>${list.map((p) => html`<tr>
        <td><a href="#/people/${p.id}"><b>${p.first_name} ${p.last_name}</b></a><div class="muted small">${p.email}${p.phone ? ` · ${p.phone}` : ''}</div></td>
        <td class="muted small nowrap">Joined ${fmtDate(p.signed_up_at.slice(0, 10))}${p.campus_short ? ` · ${p.campus_short}` : ''}</td>
        <td style="text-align:right" class="nowrap">${p.welcomed_at ? html`<button class="btn small ghost" data-unwelcome="${p.id}">Reopen</button>` : html`<button class="btn small primary" data-welcome="${p.id}">${icon('check')} Welcomed</button>`}</td></tr>`)}</tbody></table></div>`
        : html`<div class="card empty">${status === 'open' ? 'No new app sign-ups to welcome.' : 'Nothing marked welcomed yet.'}</div>`}`);
    el.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.welcome) await patch(`/signups/${b.dataset.welcome}`, { welcomed: true });
        if (b.dataset.unwelcome) await patch(`/signups/${b.dataset.unwelcome}`, { welcomed: false });
        draw();
      } catch (err) { fail(err); }
    };
  }

  await draw();
}
