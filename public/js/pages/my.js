// The signed-in person's own schedule: accept/decline, and dates they're away.
import { get, post, patch, del, html, mount, icon, fmtDate, fmtTime, dialog, formData, toast, fail, today } from '../lib.js';
import { setTitle } from '../app.js';

export default async function my(el) {
  setTitle('My Schedule', html`<button class="btn" data-away>${icon('calendar')} I’ll be away…</button>`);
  const d = await get('/my/schedule');
  if (!d.linked) {
    mount(el, html`<div class="alert info">Your sign-in isn’t linked to a person in the church directory yet, so there’s no schedule to show. Ask a church admin to link your account in Settings → Accounts.</div>`);
    return;
  }
  const status = (a) => ({
    pending: html`<span class="pill warn">Please reply</span>`,
    accepted: html`<span class="pill good">${icon('check')} Accepted</span>`,
    declined: html`<span class="pill bad">Declined</span>`,
  })[a.status];

  mount(el, html`<div class="grid two">
    <div class="stack">
      <h2>Coming up</h2>
      ${d.assignments.length ? d.assignments.map((a) => html`<div class="card">
        <div class="row"><span class="dot" style="background:${a.team_color}"></span><b>${fmtDate(a.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })}</b><span class="spacer"></span>${status(a)}</div>
        <div style="margin-top:6px"><b>${a.position}</b> <span class="muted">· ${a.team}</span></div>
        <div class="muted small">${fmtTime(a.starts_at)} at ${a.campus}${a.title ? ` · ${a.title}` : ''}</div>
        ${a.decline_reason ? html`<div class="muted small">“${a.decline_reason}”</div>` : ''}
        <div class="row" style="margin-top:10px">
          ${a.status !== 'accepted' ? html`<button class="btn small primary" data-accept="${a.id}">Accept</button>` : ''}
          ${a.status !== 'declined' ? html`<button class="btn small" data-decline="${a.id}">Can’t make it</button>` : ''}
          <a class="btn small ghost" href="#/services/${a.service_id}">Order of service</a>
        </div>
      </div>`) : html`<div class="card empty">Nothing scheduled yet.</div>`}
    </div>
    <div class="stack">
      <div class="card"><h2>Dates I’m away</h2>
        ${d.blockouts.length ? html`<table class="list"><tbody>${d.blockouts.map((b) => html`<tr>
          <td>${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date)}` : ''}</td><td class="muted">${b.reason}</td>
          <td style="text-align:right"><button class="icon-btn" data-remove-away="${b.id}" title="Remove">${icon('trash')}</button></td></tr>`)}</tbody></table>`
          : html`<p class="muted">Let your team leaders know when you’re out of town, and you won’t be scheduled.</p>`}
      </div>
      <div class="card"><h2>My teams</h2>
        ${d.teams.length ? d.teams.map((t) => html`<div class="row" style="padding:4px 0"><span class="dot" style="background:${t.color}"></span>${t.name}${t.position ? html`<span class="muted">· ${t.position}</span>` : ''}${t.is_leader ? html`<span class="pill info">Leader</span>` : ''}</div>`)
          : html`<p class="muted">You’re not on a team yet.</p>`}
      </div>
    </div>
  </div>`);

  const reload = () => my(el);
  el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.accept) { await patch(`/assignments/${t.dataset.accept}`, { status: 'accepted' }); toast('Thanks for serving!'); reload(); }
      if (t.dataset.decline) {
        const ok = await dialog({
          title: 'Can’t make it?', submit: 'Let my leader know',
          body: html`<label class="field">Reason (optional)<input type="text" name="reason" placeholder="Out of town"></label>`,
          onSubmit: (f) => patch(`/assignments/${t.dataset.decline}`, { status: 'declined', reason: formData(f).reason }),
        });
        if (ok) reload();
      }
      if (t.dataset.removeAway) { await del(`/blockouts/${t.dataset.removeAway}`); reload(); }
    } catch (err) { fail(err); }
  };
  document.querySelector('[data-away]').onclick = async () => {
    const ok = await dialog({
      title: 'I’ll be away', submit: 'Save',
      body: html`<div class="form"><label class="field">First day<input type="date" name="start_date" required min="${today()}"></label>
        <label class="field">Last day<input type="date" name="end_date"></label>
        <label class="field wide">Reason (optional)<input type="text" name="reason" placeholder="Vacation"></label></div>`,
      onSubmit: (f) => post('/blockouts', formData(f)),
    });
    if (ok) reload();
  };
}
