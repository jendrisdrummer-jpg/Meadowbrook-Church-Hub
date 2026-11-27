// Check-in stations: iPads (or any tablet) paired with a code, so kids check in without anyone
// signed in on them. Each station belongs to one campus and can only do check-in.
import { get, post, patch, del, api, html, mount, icon, dialog, formData, options, toast, fail, confirm, fmtDate, fmtUtcDate } from '../lib.js';
import { state, setTitle, visibleCampuses } from '../app.js';
import { CHECKIN_APP_VERSION, STATION_LETTERS, leadRows } from '../checkin-rules.js';

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
const holdBlock = (h) => {
  if (h.on) return html`<div class="alert warn small">${icon('info', 'ic small-ic')} A legal hold has been on since ${fmtUtcDate(h.set_at)}${h.set_by_name ? ` (put on by ${h.set_by_name})` : ''}: ${h.reason}.
    Check-ins can’t be voided, people can’t be merged and no backup copy is deleted.</div>`;
  const cooling = h.released_at && Date.now() - Date.parse(h.released_at) < h.cooling_off_days * 864e5;
  return html`<p class="muted small" style="margin:0 0 8px">${cooling ? `The last hold was released on ${fmtUtcDate(h.released_at)}. Backup copies are still kept for ${h.cooling_off_days} days after that. ` : ''}If an allegation, claim or subpoena arrives, put a hold on first, before anything else.</p>`;
};
const ALL_CAMPUSES_MESSAGE = 'That’s for admins who cover every campus. Ask one of them to make this change.';

export default async function stations(el) {
  setTitle('Check-in iPads', html`<button class="btn primary" data-add>${icon('plus')} Add a station</button>`);
  const list = (await get('/checkin/devices')).filter((d) => !state.campusId || d.campus_id === state.campusId);
  const url = `${location.origin}/checkin`;
  // The safety switch is for admins only; an admin limited to some campuses can read it but not change it.
  const safety = state.me.role === 'admin' ? await get('/checkin/safety') : null;
  // Who is told about check-in holds (admins name them; every admin is told until then).
  const lead = safety ? await get('/checkin/safeguarding') : null;
  const accounts = lead ? (await get('/users')).users.filter((u) => u.active) : [];
  const leadList = lead ? leadRows(accounts, lead) : [];
  const allCampuses = !state.me.campusIds;
  // Children whose allergy and medical details haven't been sorted into the check-in levels yet (see the person's page).
  const review = await get('/checkin/medical/review');
  // How this church runs check-in. Anyone here can read it; changing it is for an admin who covers every campus.
  const feats = await get('/checkin/settings');
  const canEdit = state.me.role === 'admin' && allCampuses;
  const teamList = canEdit ? await get('/teams') : [];
  const radio = (name, value, label, hint, current, off = false) => html`<label class="check st-choice"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''} ${canEdit && !off ? '' : 'disabled'}>
    <span><b>${label}</b><br><span class="muted small">${hint}</span></span></label>`;
  const campusLabel = (id) => visibleCampuses().find((c) => c.id === id)?.name || 'No campus set';
  mount(el, html`<div class="card st-how"><h2>Set up an iPad</h2>
      <ol class="small"><li>On the iPad, open <b>${url.replace(/^https?:\/\//, '')}</b> in Safari. (Tip: Share → Add to Home Screen for a full-screen app.)</li>
        <li>It shows a 6-letter code. Choose <b>Add a station</b> here and type it in.</li>
        <li>Each iPad gets a letter (shown in the table). Its pickup codes start with that letter, so two iPads never make the same code.</li>
        <li>That’s it: the iPad checks kids in at that campus with no one signed in. Remove it here anytime.</li></ol></div>
    <div class="card"><h2>Check-in iPads</h2>
      ${list.length ? html`<div class="table-wrap"><table class="list"><thead><tr><th>Station</th><th>Code letter</th><th>Campus</th><th>Device</th><th>Name tags</th><th>Last used</th><th></th></tr></thead><tbody>
        ${list.map((d) => html`<tr><td><b>${d.name}</b>${d.added_by ? html`<div class="muted small">Added by ${d.added_by}</div>` : ''}<div style="margin-top:4px">${versionPill(d)}</div></td><td>${d.station_letter ? html`<b class="st-code">${d.station_letter}</b>` : html`<span class="muted small">Random</span>`}</td><td>${d.campus_name}</td>
          <td class="small">${d.device || '—'}</td><td>${d.print ? html`<span class="pill good">Prints</span>` : html`<span class="pill">Off</span>`}</td>
          <td class="small nowrap">${seen(d.last_seen)}</td>
          <td style="text-align:right" class="nowrap"><button class="btn small ghost" data-edit="${d.id}">Edit</button><button class="btn small ghost danger" data-remove="${d.id}">Remove</button></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted" style="margin:0">No stations yet. Add one with the code from an iPad.</p>`}</div>
    <div class="card st-settings" data-settings><h2>Check-in settings</h2>
      <p class="muted small" style="margin:0 0 10px">How this church runs check-in. The iPads pick up a change the next time they refresh (about every ten minutes) or are reopened.</p>
      <fieldset class="st-set"><legend>How do children go home?</legend>
        ${radio('checkout', 'tag', 'Parents show their matching tag', 'Nobody checks children out on the iPad, and the iPad has no Check out screen. Staff can still check a child out in the Hub.', feats.checkout)}
        ${radio('checkout', 'ipad', 'Check out on the iPad', 'A volunteer types the code from the parent’s tag, then chooses who is collecting and the ID they showed.', feats.checkout)}</fieldset>
      <fieldset class="st-set"><legend>Pickup holds</legend>
        ${radio('holds', 'off', 'Off', 'Hold cards and buttons are hidden in the Hub, and iPads know nothing about holds. Any holds already placed are kept.', feats.holds)}
        ${radio('holds', 'alert', 'Warn at check-in', 'A child with a hold can still be checked in. The volunteer is asked to bring the children’s ministry leader or a staff member to the desk, and the safeguarding lead is told straight away.', feats.holds)}
        ${radio('holds', 'block', 'Block check-out', 'An iPad won’t check a held child out until staff release them in the Hub. This needs check-out on the iPad.', feats.holds, feats.checkout === 'tag')}</fieldset>
      <fieldset class="st-set"><legend>Care notes on the iPad</legend>
        <label class="check st-choice"><input type="checkbox" name="medical_tap" ${feats.medical_tap ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
          <span><b>Show the Care note button on the Rooms screen</b><br><span class="muted small">Volunteers can tap to read a child’s longer medical note while the child is checked in. Each look is recorded. Staff in the Hub can always read it.</span></span></label></fieldset>
      <fieldset class="st-set"><legend>When allergy details are too long for a name tag</legend>
        ${radio('label_overflow', 'leader', '“SEE ROOM LEADER”', 'Good when every room has a leader to ask.', feats.label_overflow)}
        ${radio('label_overflow', 'desk', '“SEE CHECK-IN DESK”', 'Good when allergy details are sorted out at the check-in desk.', feats.label_overflow)}
        ${radio('label_overflow', 'smaller', 'Print it smaller', 'The allergy words are printed in smaller type so they all fit. Only when even small type can’t fit does it say “SEE CHECK-IN DESK”.', feats.label_overflow)}
        <p class="muted small" style="margin:6px 0 0">“EPI: YES” always prints, whichever you choose.</p></fieldset>
      <fieldset class="st-set"><legend>Kids’ check-in for team leaders</legend>
        <p class="muted small" style="margin:0 0 8px">Leaders of the teams you tick can open Kids’ check-in at their own campuses (the family list, each child’s allergy line, and care notes on tap) while they lead the team, as if you had switched it on for their account. It stops when they stop leading it. Leave every team unticked to give check-in only account by account.</p>
        ${canEdit ? (teamList.length ? html`<div class="stack" data-auto-teams>${teamList.map((t) => html`<label class="check"><input type="checkbox" value="${t.id}" ${feats.auto_team_ids.includes(t.id) ? 'checked' : ''}> ${t.name} ${t.campus_id ? html`<span class="muted small">${campusLabel(t.campus_id)}</span>` : ''}</label>`)}</div>` : html`<p class="muted small" style="margin:0">There are no teams yet.</p>`)
          : html`<p class="small" style="margin:0">${feats.auto_teams.length ? feats.auto_teams.map((t) => t.name).join(', ') : 'No teams chosen.'}</p>`}</fieldset>
      ${canEdit ? html`<button class="btn primary" data-save-settings>Save check-in settings</button>` : html`<p class="muted small" style="margin:0">${ALL_CAMPUSES_MESSAGE}</p>`}</div>
    <div class="card"><h2>Medical details to sort</h2>
      ${review.remaining ? html`<p class="small" style="margin:0 0 8px"><b>${review.remaining}</b> ${review.remaining === 1 ? 'child has' : 'children have'} allergy or medical details nobody has sorted yet:
          ${review.by_campus.map((x) => `${campusLabel(x.campus_id)} ${x.remaining}`).join(' · ')}. Open each child, put allergens and EpiPen in the safety line, private matters in care notes, leave the rest as the medical note, then tick “Sorted”.</p>
        <table class="list"><tbody>${review.rows.slice(0, 15).map((c) => html`<tr><td><a href="#/people/${c.id}"><b>${c.first_name} ${c.last_name}</b></a></td>
          <td class="small">${c.allergy_epi ? html`<span class="allergy">EPI</span> ` : ''}${c.allergies || ''}${c.medical_notes ? html` <span class="muted">${c.medical_notes.slice(0, 80)}${c.medical_notes.length > 80 ? '…' : ''}</span>` : ''}</td></tr>`)}</tbody></table>
        ${review.rows.length > 15 ? html`<p class="muted small" style="margin:6px 0 0">Showing 15 of ${review.rows.length}. Sort these and the rest appear.</p>` : ''}`
        : html`<p class="muted" style="margin:0">Nothing left to sort. Every child’s allergy and medical details have been looked at.</p>`}</div>
    ${safety ? html`<div class="card st-safety"><h2>Check-in safety</h2>
      <label class="check st-switch"><input type="checkbox" data-safety ${safety.require_current_app ? 'checked' : ''} ${allCampuses ? '' : 'disabled'}> Only let iPads with the latest check-in sync</label>
      <p class="muted small" style="margin:6px 0 0">Turn this on once every iPad above says Up to date. Older iPads keep what they’ve recorded and sync after they’re reopened.</p>
      ${allCampuses ? '' : html`<p class="muted small" style="margin:6px 0 0">${ALL_CAMPUSES_MESSAGE}</p>`}
      <h3 style="margin:16px 0 6px">Safeguarding lead</h3>
      <p class="muted small" style="margin:0 0 8px">Told in the Hub, and by email if it’s set up, every time someone puts a hold on a child, changes it or lifts it, and if a child with a hold is released. ${lead.fallback ? 'Nobody is named yet, so every admin is told.' : ''}</p>
      ${leadList.length ? html`<div class="stack" data-leads>${leadList.map((u) => html`<label class="check"><input type="checkbox" value="${u.id}" ${u.checked ? 'checked' : ''} ${allCampuses ? '' : 'disabled'}> ${u.name} ${u.role ? html`<span class="muted small">${u.role}</span>` : ''}</label>`)}</div>
        <button class="btn small" style="margin-top:8px" data-save-leads ${allCampuses ? '' : 'disabled'}>Save</button>` : ''}
      <h3 style="margin:16px 0 6px">Legal hold</h3>
      ${holdBlock(safety.legal_hold)}
      <button class="btn ${safety.legal_hold.on ? '' : 'danger'} small" data-hold="${safety.legal_hold.on ? 'release' : 'set'}" ${allCampuses ? '' : 'disabled'}>${safety.legal_hold.on ? 'Release the hold' : 'Put a legal hold on'}</button></div>` : ''}`);

  // With matching tags there is nothing for a hold to block, so that choice is unavailable (and moves to "Warn" if it was picked).
  const settings = el.querySelector('[data-settings]');
  const picked = (name) => settings.querySelector(`input[name=${name}]:checked`)?.value;
  const syncBlock = () => {
    const block = settings.querySelector('input[name=holds][value=block]');
    const tag = picked('checkout') === 'tag';
    block.disabled = tag || !canEdit;
    if (tag && block.checked) settings.querySelector('input[name=holds][value=alert]').checked = true;
  };
  settings.querySelectorAll('input[name=checkout]').forEach((i) => { i.onchange = syncBlock; });
  settings.querySelector('[data-save-settings]')?.addEventListener('click', async () => {
    const body = { checkout: picked('checkout'), holds: picked('holds'), medical_tap: settings.querySelector('input[name=medical_tap]').checked, label_overflow: picked('label_overflow'),
      auto_team_ids: [...settings.querySelectorAll('[data-auto-teams] input:checked')].map((i) => Number(i.value)) };
    try { await api('PUT', '/checkin/settings', body); toast('Saved. iPads pick this up the next time they refresh.'); stations(el); } catch (err) { fail(err); }
  });

  const sw = el.querySelector('[data-safety]');
  if (sw) sw.onchange = async () => {
    try {
      const r = await patch('/checkin/safety', { require_current_app: sw.checked });
      toast(r.require_current_app ? 'Older iPads will be asked to reload.' : 'Older iPads can sync again.');
    } catch (err) { sw.checked = !sw.checked; fail(err); }
  };

  el.querySelector('[data-save-leads]')?.addEventListener('click', async () => {
    const ids = [...el.querySelectorAll('[data-leads] input:checked')].map((i) => Number(i.value));
    try { await api('PUT', '/checkin/safeguarding', { lead_ids: ids }); toast(ids.length ? 'Saved.' : 'Saved. Every admin will be told about holds.'); } catch (err) { fail(err); }
  });

  // A legal hold keeps everything as it is: nothing is voided or merged and no backup copy is deleted. Say why, both ways.
  const hold = el.querySelector('[data-hold]');
  if (hold) hold.onclick = async () => {
    const setting = hold.dataset.hold === 'set';
    const ok = await dialog({
      title: setting ? 'Put a legal hold on?' : 'Release the legal hold?', submit: setting ? 'Put the hold on' : 'Release the hold', danger: setting,
      body: html`<p>${setting
        ? 'While it’s on, check-ins can’t be voided, people can’t be merged and no backup copy is deleted. Do this first when an allegation, claim or subpoena arrives. If Google Drive isn’t connected, backup copies pile up on this server until it’s released.'
        : 'Check-ins and merges work again. Backup copies made during the hold are still kept for 7 more days.'}</p>
        <label class="field">Why?<textarea name="reason" maxlength="300" required></textarea></label>`,
      onSubmit: (f) => post(setting ? '/checkin/legal-hold' : '/checkin/legal-hold/release', { reason: f.reason.value }),
    });
    if (ok) { toast(setting ? 'The legal hold is on. Every admin has been told.' : 'The legal hold is released.'); stations(el); }
  };

  const campusSelect = (selected) => html`<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), selected ?? state.campusId ?? visibleCampuses()[0]?.id)}</select>`;
  document.querySelector('[data-actions] [data-add]').onclick = async () => {
    const ok = await dialog({
      title: 'Add a station', submit: 'Add station',
      body: html`<div class="form">
        <label class="field wide">Code on the iPad<input type="text" name="code" class="st-code" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" required></label>
        <label class="field">Station name<input type="text" name="name" value="Welcome desk" maxlength="60" required><span class="muted small">Printed on name tags.</span></label>
        <label class="field">Campus${campusSelect()}</label>
        <label class="field">Code letter<select name="station_letter">${options([...STATION_LETTERS].map((l) => ({ value: l, label: l })), '', { blank: 'The next free letter' })}</select><span class="muted small">Replacing an iPad? Remove the old one first, then pick its letter so codes on tags still make sense.</span></label>
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
