// Feedback: anyone signed in sends a bug, frustration or idea; admins triage it and write what was
// done. "You said, we did" lists those notes for everyone. Deliberately small: not a project tracker.
import { get, post, patch, html, mount, toast, fail, fmtDate, formData, options } from '../lib.js';
import { setTitle, state, can } from '../app.js';

const CATEGORIES = [['bug', 'Something isn’t working'], ['frustration', 'It works, but it’s hard or slow'], ['missing', 'I can’t do something I need'],
  ['workflow', 'A better way to do something'], ['request', 'A new feature'], ['idea', 'An idea for my ministry']];
const SEVERITIES = [['nice_to_have', 'Nice to have'], ['slows_me_down', 'Slows me down'], ['blocks_sunday', 'Blocks Sunday']];
const STATUS = { received: 'Received', looking: 'Looking into it', planned: 'Planned', done: 'Done', not_now: 'Not now' };
const label = (list, v) => list.find(([k]) => k === v)?.[1] || v;

export default async function feedback(el) {
  setTitle('Feedback');
  const admin = can('admin');
  let filter = admin ? 'open' : 'all';
  const from = state.lastPath || '';

  async function draw() {
    const [mine, done] = await Promise.all([get('/feedback'), get('/feedback/done')]);
    const shown = admin && filter === 'open' ? mine.filter((f) => !['done', 'not_now'].includes(f.status)) : mine;
    mount(el, html`<div class="grid two">
      <div class="stack">
        <form class="card stack" data-send>
          <h2>Send feedback</h2>
          <p class="muted small" style="margin:0">Tell us what isn’t working, what slows you down or what you’d like. Everything here is read by the people building the Hub.</p>
          <label class="field">What kind<select name="category">${options(CATEGORIES.map(([value, l]) => ({ value, label: l })), 'bug')}</select></label>
          <label class="field">How much does it matter?<select name="severity">${options(SEVERITIES.map(([value, l]) => ({ value, label: l })), 'slows_me_down')}</select></label>
          <label class="field">What happened, or what would help?<textarea name="body" rows="5" maxlength="2000" required></textarea></label>
          ${from ? html`<p class="muted small" style="margin:0">We’ll note you were on <code>${from}</code>.</p>` : ''}
          <p class="muted small" style="margin:0">If something is stopping you on a Sunday morning, also tell your contact in person.</p>
          <div class="row end"><button class="btn primary">Send</button></div>
        </form>
        <div class="card"><h2>You said, we did</h2>
          ${done.length ? done.map((d) => html`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="pill">${STATUS[d.status]}</span>
            <span class="muted small">${d.done_at ? fmtDate(d.done_at.slice(0, 10)) : ''}</span><p style="margin:4px 0 0">${d.done_note}</p></div>`)
            : html`<p class="muted">Nothing yet. When we act on feedback, it shows up here.</p>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${admin ? 'All feedback' : 'Your feedback'}</h2>
          ${admin ? html`<div class="seg"><button data-filter="open" class="${filter === 'open' ? 'on' : ''}">Open</button><button data-filter="all" class="${filter === 'all' ? 'on' : ''}">All</button></div>` : ''}</div>
        ${shown.length ? shown.map((f) => html`<div class="stack" style="padding:10px 0;border-bottom:1px solid var(--line);gap:6px" data-id="${f.id}">
          <div class="row"><span class="pill ${f.severity === 'blocks_sunday' ? 'bad' : ''}">${label(SEVERITIES, f.severity)}</span><span class="pill">${label(CATEGORIES, f.category)}</span>
            <span class="pill info">${STATUS[f.status]}</span><span class="spacer"></span><span class="muted small">${fmtDate(f.created_at.slice(0, 10))}</span></div>
          <p style="margin:0;white-space:pre-line">${f.body}</p>
          <p class="muted small" style="margin:0">${admin ? html`${f.sender_first ? `${f.sender_first} ${f.sender_last || ''}` : f.sender_email || 'Someone'} · ${f.role}` : ''}${f.page ? html` · on <code>${f.page}</code>` : ''}</p>
          ${!admin && f.done_note ? html`<p class="small" style="margin:0"><b>What happened:</b> ${f.done_note}</p>` : ''}
          ${admin ? html`<form class="stack" data-triage="${f.id}" style="gap:6px">
            <label class="field">Status<select name="status">${options(Object.entries(STATUS).map(([value, l]) => ({ value, label: l })), f.status)}</select></label>
            <label class="field">Note for admins<input type="text" name="admin_note" value="${f.admin_note}" maxlength="2000"></label>
            <label class="field">What we did (shown to everyone)<input type="text" name="done_note" value="${f.done_note}" maxlength="1000" placeholder="e.g. Reminders now go to everyone who hasn’t replied"></label>
            <div class="row end"><button class="btn small">Save</button></div></form>` : ''}
        </div>`) : html`<p class="muted">${admin ? 'Nothing here.' : 'You haven’t sent any feedback yet.'}</p>`}
      </div></div>`);
    el.querySelector('[data-send]').onsubmit = async (e) => {
      e.preventDefault();
      try { await post('/feedback', { ...formData(e.target), page: from, campus_id: state.campusId || null }); toast('Thank you, we’ve got it.'); draw(); } catch (err) { fail(err); }
    };
    el.querySelectorAll('[data-triage]').forEach((f) => { f.onsubmit = async (e) => {
      e.preventDefault();
      try { await patch(`/feedback/${f.dataset.triage}`, formData(f)); toast('Saved.'); draw(); } catch (err) { fail(err); }
    }; });
    el.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { filter = b.dataset.filter; draw(); }; });
  }
  await draw();
}
