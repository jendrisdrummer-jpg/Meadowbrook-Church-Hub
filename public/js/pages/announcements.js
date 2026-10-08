// Announcements: a notification to the church's phones (and everyone's inbox in the app), now or
// at a set time. Only accounts with the Announcements permission see this page.
import { get, post, patch, html, mount, icon, options, toast, fail, confirm, fmtDate } from '../lib.js';
import { state, setTitle, visibleCampuses } from '../app.js';

const AUDIENCES = [['everyone', 'Everyone'], ['campus', 'A campus'], ['team', 'A team'], ['volunteers', 'Volunteers'], ['staff', 'Staff']];
const STATUS = { scheduled: html`<span class="pill warn">Scheduled</span>`, sent: html`<span class="pill good">Sent</span>`, canceled: html`<span class="pill">Canceled</span>` };

const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
const whenLabel = (utc) => {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return `${fmtDate(d.toLocaleDateString('en-CA'), { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export default async function announcements(el) {
  setTitle('Announcements');
  const [list, cfg, teams, events] = await Promise.all([
    get('/announcements'), get('/app/config'), get('/teams').catch(() => []), get('/events?limit=30').catch(() => []),
  ]);
  const tabs = cfg.config.tabs.filter((t) => !['link', 'more'].includes(t.type));
  const draft = { title: '', body: '', link: '', type: 'everyone', ids: [], later: false, send_at: localInput(new Date(Date.now() + 3600e3)) };
  let reachTimer;

  function draw() {
    const linkKind = !draft.link ? '' : draft.link.startsWith('#/events/') ? 'event' : draft.link.startsWith('#/') ? 'tab' : 'url';
    mount(el, html`<div class="grid two ann-grid">
      <form class="card stack" data-form novalidate><h2 style="margin:0">New announcement</h2>
        <label class="field">Title<input type="text" name="title" maxlength="80" value="${draft.title}" placeholder="Service moved to 11am" required><span class="muted small count" data-count="title">${draft.title.length}/80</span></label>
        <label class="field">Message<textarea name="body" maxlength="400" rows="3" placeholder="Because of the weather, we’ll meet at 11 this Sunday. See you there!">${draft.body}</textarea><span class="muted small count" data-count="body">${draft.body.length}/400</span></label>
        <div class="field"><span>When someone taps it, open</span>
          <select name="link_kind">${options([{ value: '', label: 'Their notifications in the app' }, { value: 'tab', label: 'A tab in the app' }, ...(events.length ? [{ value: 'event', label: 'An event' }] : []), { value: 'url', label: 'A website' }], linkKind)}</select>
          ${linkKind === 'tab' ? html`<select name="link_tab">${options(tabs.map((t) => ({ value: `#/${t.id}`, label: t.label })), draft.link)}</select>` : ''}
          ${linkKind === 'event' ? html`<select name="link_event">${options(events.map((e) => ({ value: `#/events/${e.id}`, label: `${e.title} · ${fmtDate(e.starts_at.slice(0, 10), { month: 'short', day: 'numeric' })}` })), draft.link)}</select>` : ''}
          ${linkKind === 'url' ? html`<input type="url" name="link_url" value="${draft.link}" placeholder="https://…">` : ''}</div>
        <div class="field"><span>Send to</span><div class="seg ann-aud">${AUDIENCES.map(([k, label]) => html`<button type="button" class="${draft.type === k ? 'on' : ''}" data-aud="${k}">${label}</button>`)}</div>
          ${draft.type === 'campus' ? html`<div class="row ann-picks">${visibleCampuses().map((c) => html`<label class="check"><input type="checkbox" data-pick="${c.id}" ${draft.ids.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}</div>` : ''}
          ${draft.type === 'team' ? html`<div class="row ann-picks">${teams.map((t) => html`<label class="check"><input type="checkbox" data-pick="${t.id}" ${draft.ids.includes(t.id) ? 'checked' : ''}> ${t.name}</label>`)}</div>` : ''}
          <p class="muted small" style="margin:6px 0 0" data-reach>…</p></div>
        <div class="field"><span>When</span><div class="row" style="gap:16px"><label class="check"><input type="radio" name="when" value="now" ${draft.later ? '' : 'checked'}> Now</label>
          <label class="check"><input type="radio" name="when" value="later" ${draft.later ? 'checked' : ''}> Later</label>
          ${draft.later ? html`<input type="datetime-local" name="send_at" value="${draft.send_at}" style="width:auto">` : ''}</div></div>
        <div class="row end"><button class="btn primary" data-send>${icon('send')} ${draft.later ? 'Schedule' : 'Send now'}</button></div>
      </form>
      <div class="stack" style="gap:14px">
        <div class="card"><h2>Preview</h2><div class="ann-preview">
          <div class="ann-note"><span class="ann-icon">${(state.settings.church_name || 'C').trim()[0]}</span>
            <div class="grow"><div class="ann-app"><span>${state.settings.church_name || 'Church'}</span><span>now</span></div>
              <b data-pv="title">${draft.title || 'Your title'}</b><div data-pv="body">${draft.body || 'Your message shows here.'}</div></div></div></div>
          <p class="muted small" style="margin:10px 0 0">Phones with notifications on get this right away. It’s also in everyone’s notifications in the app (the bell), so people without notifications still see it.</p></div>
        <div class="card"><h2>Reaching more people</h2><p class="small" style="margin:0">Anyone can turn on announcements from the app’s <b>More</b> tab, even without an account. On iPhones, the app has to be added to the home screen first.</p></div>
      </div></div>
    <div class="card" style="margin-top:14px"><h2>Sent and scheduled</h2>
      ${list.length ? html`<table class="list"><thead><tr><th>Announcement</th><th>To</th><th>When</th><th>Reached</th><th></th></tr></thead><tbody>
        ${list.map((a) => html`<tr class="${a.status === 'canceled' ? 'muted' : ''}"><td><b>${a.title}</b>${a.body ? html`<div class="muted small ann-body">${a.body}</div>` : ''}</td>
          <td class="small">${a.audience_label}</td><td class="nowrap small">${whenLabel(a.sent_at || a.send_at)}<br>${STATUS[a.status]}</td>
          <td class="small">${a.status === 'sent' ? html`${a.people} ${a.people === 1 ? 'person' : 'people'}<br><span class="muted">${a.devices} ${a.devices === 1 ? 'phone' : 'phones'}</span>` : html`<span class="muted">—</span>`}</td>
          <td style="text-align:right">${a.status === 'scheduled' ? html`<button class="btn small ghost danger" data-cancel="${a.id}">Cancel</button>` : html`<span class="muted small">${a.sender}</span>`}</td></tr>`)}
      </tbody></table>` : html`<p class="muted" style="margin:0">Nothing sent yet.</p>`}</div>`);
    updateReach();
  }

  function read() {
    const f = el.querySelector('[data-form]');
    draft.title = f.title.value;
    draft.body = f.body.value;
    const kind = f.link_kind.value;
    draft.link = kind === 'tab' ? f.link_tab?.value || `#/${tabs[0]?.id}` : kind === 'event' ? f.link_event?.value || `#/events/${events[0]?.id}` : kind === 'url' ? f.link_url?.value ?? 'https://' : '';
    if (kind === 'url' && !draft.link) draft.link = 'https://';
    draft.later = f.when.value === 'later';
    if (f.send_at) draft.send_at = f.send_at.value;
    draft.ids = [...f.querySelectorAll('[data-pick]:checked')].map((x) => Number(x.dataset.pick));
  }

  function updateReach() {
    clearTimeout(reachTimer);
    reachTimer = setTimeout(async () => {
      const box = el.querySelector('[data-reach]');
      if (!box) return;
      if (['campus', 'team'].includes(draft.type) && !draft.ids.length) { box.textContent = `Pick at least one ${draft.type}.`; return; }
      const r = await post('/announcements/reach', { audience: { type: draft.type, ids: draft.ids } }).catch(() => null);
      if (r) box.textContent = `Reaches ${r.people} ${r.people === 1 ? 'person' : 'people'} in the app, on ${r.devices} ${r.devices === 1 ? 'phone' : 'phones'} with notifications on.`;
    }, 200);
  }

  el.oninput = (e) => {
    const t = e.target;
    if (t.name === 'title' || t.name === 'body') {
      el.querySelector(`[data-pv="${t.name}"]`).textContent = t.value || (t.name === 'title' ? 'Your title' : 'Your message shows here.');
      el.querySelector(`[data-count="${t.name}"]`).textContent = `${t.value.length}/${t.name === 'title' ? 80 : 400}`;
    }
  };
  el.onchange = (e) => {
    const t = e.target;
    if (['link_kind', 'when'].includes(t.name)) { read(); if (t.name === 'link_kind') draft.link = t.value === 'tab' ? `#/${tabs[0]?.id}` : t.value === 'event' ? `#/events/${events[0]?.id}` : t.value === 'url' ? 'https://' : ''; draw(); }
    if (t.dataset.pick) { read(); updateReach(); }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aud) { read(); draft.type = b.dataset.aud; draft.ids = []; return draw(); }
    if (b.dataset.cancel) {
      if (!(await confirm('Cancel this announcement?', 'It won’t be sent.', 'Cancel it'))) return;
      try { await patch(`/announcements/${b.dataset.cancel}`, { canceled: true }); toast('Canceled.'); announcements(el); } catch (err) { fail(err); }
      return;
    }
    if (b.matches('[data-send]')) {
      e.preventDefault();
      read();
      if (!draft.title.trim()) return toast('Give it a title first.', 'bad');
      const r = await post('/announcements/reach', { audience: { type: draft.type, ids: draft.ids } }).catch(() => ({ people: 0, devices: 0 }));
      const when = draft.later ? new Date(draft.send_at) : null;
      const ok = await confirm(draft.later ? 'Schedule this announcement?' : 'Send this announcement now?',
        `“${draft.title}” goes to ${r.people} ${r.people === 1 ? 'person' : 'people'} (${r.devices} ${r.devices === 1 ? 'phone' : 'phones'})${when ? ` on ${when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`,
        draft.later ? 'Schedule' : 'Send');
      if (!ok) return;
      try {
        await post('/announcements', { title: draft.title, body: draft.body, link: draft.link === 'https://' ? '' : draft.link, audience: { type: draft.type, ids: draft.ids }, send_at: when ? when.toISOString() : null });
        toast(draft.later ? 'Scheduled.' : 'Sent!');
        announcements(el);
      } catch (err) { fail(err); }
    }
  };
  draw();
}
