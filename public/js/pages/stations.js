// Check-in stations: iPads (or any tablet) paired with a code, so kids check in without anyone
// signed in on them. Each station belongs to one campus and can only do check-in.
import { get, post, patch, del, html, mount, icon, dialog, formData, options, toast, fail, confirm, fmtDate } from '../lib.js';
import { state, setTitle, visibleCampuses } from '../app.js';
import { CHECKIN_APP_VERSION } from '../checkin-rules.js';

const seen = (t) => {
  if (!t) return 'Not yet';
  const d = new Date(`${t.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - d) / 60e3);
  if (mins < 10) return 'Just now';
  if (mins < 60 * 20) return `${Math.round(mins / 60) || 1} hr ago`;
  return fmtDate(d.toLocaleDateString('en-CA'), { month: 'short', day: 'numeric' });
};

// Which check-in app an iPad last reported, in words (not only colour).
const versionPill = (d) => {
  if (!d.app_version) return html`<span class="pill">Not reported yet</span>`;
  if (Number(d.app_version) >= CHECKIN_APP_VERSION) return html`<span class="pill good">Up to date</span>`;
  return html`<span class="pill warn">Older check-in, reload this iPad</span>`;
};
const ALL_CAMPUSES_MESSAGE = 'That’s for admins who cover every campus. Ask one of them to make this change.';

export default async function stations(el) {
  setTitle('Check-in iPads', html`<button class="btn primary" data-add>${icon('plus')} Add a station</button>`);
  const list = (await get('/checkin/devices')).filter((d) => !state.campusId || d.campus_id === state.campusId);
  const url = `${location.origin}/checkin`;
  // The safety switch is for admins only; an admin limited to some campuses can read it but not change it.
  const safety = state.me.role === 'admin' ? await get('/checkin/safety') : null;
  const allCampuses = !state.me.campusIds;
  mount(el, html`<div class="card st-how"><h2>Set up an iPad</h2>
      <ol class="small"><li>On the iPad, open <b>${url.replace(/^https?:\/\//, '')}</b> in Safari. (Tip: Share → Add to Home Screen for a full-screen app.)</li>
        <li>It shows a 6-letter code. Choose <b>Add a station</b> here and type it in.</li>
        <li>That’s it: the iPad checks kids in at that campus with no one signed in. Remove it here anytime.</li></ol></div>
    <div class="card"><h2>Check-in iPads</h2>
      ${list.length ? html`<div class="table-wrap"><table class="list"><thead><tr><th scope="col">Station</th><th scope="col">Campus</th><th scope="col">Device</th><th scope="col">Name tags</th><th scope="col">Last used</th><th scope="col"></th></tr></thead><tbody>
        ${list.map((d) => html`<tr><td><b>${d.name}</b>${d.added_by ? html`<div class="muted small">Added by ${d.added_by}</div>` : ''}<div style="margin-top:4px">${versionPill(d)}</div></td><td>${d.campus_name}</td>
          <td class="small">${d.device || '—'}</td><td>${d.print ? html`<span class="pill good">Prints</span>` : html`<span class="pill">Off</span>`}</td>
          <td class="small nowrap">${seen(d.last_seen)}</td>
          <td style="text-align:right" class="nowrap"><button class="btn small ghost" data-edit="${d.id}">Edit</button><button class="btn small ghost danger" data-remove="${d.id}">Remove</button></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted" style="margin:0">No stations yet. Add one with the code from an iPad.</p>`}</div>
    ${safety ? html`<div class="card st-safety"><h2>Check-in safety</h2>
      <label class="check st-switch"><input type="checkbox" data-safety ${safety.require_current_app ? 'checked' : ''} ${allCampuses ? '' : 'disabled'}> Only let iPads with the latest check-in sync</label>
      <p class="muted small" style="margin:6px 0 0">Turn this on once every iPad above says Up to date. Older iPads keep what they’ve recorded and sync after they’re reopened.</p>
      ${allCampuses ? '' : html`<p class="muted small" style="margin:6px 0 0">${ALL_CAMPUSES_MESSAGE}</p>`}</div>` : ''}`);

  const sw = el.querySelector('[data-safety]');
  if (sw) sw.onchange = async () => {
    try {
      const r = await patch('/checkin/safety', { require_current_app: sw.checked });
      toast(r.require_current_app ? 'Older iPads will be asked to reload.' : 'Older iPads can sync again.');
    } catch (err) { sw.checked = !sw.checked; fail(err); }
  };

  const campusSelect = (selected) => html`<select name="campus_id" aria-label="Campus">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), selected ?? state.campusId ?? visibleCampuses()[0]?.id)}</select>`;
  document.querySelector('[data-actions] [data-add]').onclick = async () => {
    const ok = await dialog({
      title: 'Add a station', submit: 'Add station',
      body: html`<div class="form">
        <label class="field wide">Code on the iPad<input type="text" name="code" class="st-code" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" required></label>
        <label class="field">Station name<input type="text" name="name" value="Welcome desk" maxlength="60" required><span class="muted small">Printed on name tags.</span></label>
        <label class="field">Campus${campusSelect()}</label>
        <label class="check wide"><input type="checkbox" name="print" checked> Print name tags (a label printer connected to the iPad)</label></div>`,
      onSubmit: (f) => post('/checkin/devices', { ...formData(f), print: f.print.checked }),
    });
    if (ok) { toast('Paired. The iPad is ready for check-in.'); stations(el); }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = list.find((x) => x.id === Number(b.dataset.edit || b.dataset.remove));
    if (b.dataset.edit) {
      const ok = await dialog({
        title: 'Edit station',
        body: html`<div class="form"><label class="field">Station name<input type="text" name="name" value="${d.name}" maxlength="60" required></label>
          <label class="field">Campus${campusSelect(d.campus_id)}</label>
          <label class="check wide"><input type="checkbox" name="print" ${d.print ? 'checked' : ''}> Print name tags</label>
          <p class="muted small wide" style="margin:0">The iPad picks up changes the next time it opens check-in.</p></div>`,
        onSubmit: (f) => patch(`/checkin/devices/${d.id}`, { ...formData(f), print: f.print.checked }),
      });
      if (ok) { toast('Saved.'); stations(el); }
    }
    if (b.dataset.remove) {
      if (!(await confirm(`Remove ${d.name}?`, 'That iPad stops working for check-in right away. You can pair it again with a new code.', 'Remove'))) return;
      try { await del(`/checkin/devices/${d.id}`); toast('Removed.'); stations(el); } catch (err) { fail(err); }
    }
  };
}
