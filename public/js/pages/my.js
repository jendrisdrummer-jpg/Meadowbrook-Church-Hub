// The signed-in person's own schedule: accept/decline, and dates they're away.
import { get, post, patch, del, html, raw, mount, icon, fmtDate, fmtTime, dialog, formData, toast, fail, today } from '../lib.js';
import { setTitle, hashQuery, can } from '../app.js';
import { isIOS, isMobile, isInstalled, pushSupported, canPromptInstall, promptInstall, currentSubscription, enablePush, disablePush } from '../push.js';

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

  mount(el, html`<div class="card app-card" data-app-card style="margin-bottom:16px"></div>
  <div class="grid two">
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

  drawAppCard(el.querySelector('[data-app-card]')).catch(fail);

  const reload = () => my(el);
  const decline = async (id) => {
    const ok = await dialog({
      title: 'Can’t make it?', submit: 'Let my leader know',
      body: html`<label class="field">Reason (optional)<input type="text" name="reason" placeholder="Out of town"></label>`,
      onSubmit: (f) => patch(`/assignments/${id}`, { status: 'declined', reason: formData(f).reason }),
    });
    if (ok) reload();
  };
  el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.accept) { await patch(`/assignments/${t.dataset.accept}`, { status: 'accepted' }); toast('Thanks for serving!'); reload(); }
      if (t.dataset.decline) await decline(t.dataset.decline);
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

  // Opened from a notification's "Can't make it" button.
  const q = hashQuery();
  if (q.get('decline') && d.assignments.some((a) => a.id === Number(q.get('decline')) && a.status !== 'declined')) {
    history.replaceState(null, '', '#/my');
    decline(q.get('decline')).catch(fail);
  }
}

// Installing the app and turning notifications on for this phone or computer.
async function drawAppCard(box) {
  const [info, sub] = await Promise.all([get('/me/notify'), currentSubscription().catch(() => null)]);
  const installed = isInstalled();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const on = Boolean(sub) && perm === 'granted';
  const share = html`<svg class="share-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
  const labels = { scheduled: 'When I’m scheduled', reminder: 'Reminders before I serve', declined: 'When someone on my team can’t make it' };
  const kinds = Object.keys(labels).filter((k) => k !== 'declined' || can('leader') || info.prefs.declined === false);

  let install = '';
  if (!installed && isIOS) {
    install = html`<p class="small" style="margin:0">Add this app to your home screen to get notifications on your iPhone:</p>
      <ol class="steps-inline small"><li>Open this page in <b>Safari</b>.</li><li>Tap the Share button ${share}.</li><li>Choose <b>Add to Home Screen</b>, then open the app from there.</li></ol>`;
  } else if (!installed && canPromptInstall()) {
    install = html`<p class="small" style="margin:0 0 8px">Put this app on your ${isMobile ? 'home screen' : 'computer'} for one-tap access.</p><button class="btn small" data-install>${icon('phone')} Install the app</button>`;
  } else if (!installed && isMobile) {
    install = html`<p class="small" style="margin:0">To install: open your browser’s menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`;
  }

  let push;
  if (!pushSupported()) {
    push = html`<p class="muted small">${isIOS && !installed ? 'Notifications work once the app is on your home screen.' : 'This browser can’t show notifications. Your notices still appear under the bell.'}</p>`;
  } else if (perm === 'denied') {
    push = html`<p class="small">Notifications are blocked for this app. Allow them in your ${isMobile ? 'phone’s settings' : 'browser’s site settings'}, then come back here.</p>`;
  } else if (on) {
    push = html`<div class="row"><span class="pill good">${icon('check')} On for this device</span><button class="btn small ghost" data-test>Send a test</button><button class="btn small ghost" data-off>Turn off</button></div>`;
  } else {
    push = html`<button class="btn primary" data-on>${icon('bell')} Turn on notifications</button>
      <p class="muted small" style="margin:6px 0 0">Get a notice when you’re scheduled, and accept right from it.</p>`;
  }

  mount(box, html`<div class="card-head"><h2>App &amp; notifications</h2></div>
    ${install ? html`<div style="margin-bottom:14px">${install}</div>` : ''}
    ${push}
    <details style="margin-top:10px" ${on ? '' : raw('open')}><summary class="small">Which notifications</summary>
      ${kinds.map((k) => html`<label class="toggle-row small"><span>${labels[k]}</span><input type="checkbox" data-pref="${k}" ${info.prefs[k] ? raw('checked') : ''}></label>`)}</details>
    ${info.devices.length > (on ? 1 : 0) ? html`<p class="muted small" style="margin:8px 0 0">Also on: ${info.devices.filter((x) => x.endpoint !== sub?.endpoint).map((x) => x.device || 'another device').join(', ')}</p>` : ''}`);

  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-install]')) await promptInstall();
      if (b.matches('[data-on]')) {
        const r = await enablePush();
        if (r === 'on') { await post('/push/test'); toast('Notifications are on.'); }
        else if (r === 'denied') toast('Notifications weren’t allowed.', 'bad');
      }
      if (b.matches('[data-off]')) { await disablePush(); toast('Notifications are off for this device.'); }
      if (b.matches('[data-test]')) { await post('/push/test'); toast('Sent. It should arrive in a few seconds.'); }
      drawAppCard(box);
    } catch (err) { fail(err); }
  };
  box.onchange = (e) => {
    const k = e.target.dataset.pref;
    if (k) patch('/me/notify', { [k]: e.target.checked }).catch(fail);
  };
}
