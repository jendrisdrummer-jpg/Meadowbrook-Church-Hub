// One person's profile: details, household, teams, schedule and check-in history.
import { get, post, patch, del, api, html, mount, icon, avatar, displayName, dialog, formData, options, toast, fail, fmtDate, fmtTime, confirm, pickPerson, shrinkImage } from '../lib.js';
import { state, can, setTitle, go, campusName, visibleCampuses } from '../app.js';
import { gradeLabel, ageLabel } from '../checkin-rules.js';
import { drawProfile } from '../profile.js';

const GRADES = [{ value: -1, label: 'Pre-K' }, { value: 0, label: 'Kindergarten' }, ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: gradeLabel(i + 1) }))];

export default async function person(el, id) {
  const [p, att] = await Promise.all([get(`/people/${id}`), get(`/people/${id}/attendance`)]);
  const staff = can('staff');
  setTitle(displayName(p), html`${staff ? html`<button class="btn" data-edit>${icon('edit')} Edit</button>` : ''}
    ${can('admin') ? html`<button class="btn" data-merge title="Merge a duplicate record into this one">${icon('copy')} Merge duplicate</button>` : ''}`);
  const now = new Date().toLocaleDateString('en-CA');
  const h = p.household;

  mount(el, html`
    ${p.archived ? html`<div class="alert" style="margin-bottom:14px">This person is archived. ${staff ? html`<button class="btn small" data-unarchive>Restore</button>` : ''}</div>` : ''}
    <div class="grid two">
      <div class="stack">
        <div class="card">
          <div class="row" style="align-items:flex-start;gap:16px">
            <label style="cursor:${staff ? 'pointer' : 'default'}" title="${staff ? 'Change photo' : ''}">${avatar(p, 'lg')}
              ${staff ? html`<input type="file" accept="image/*" data-photo hidden>` : ''}</label>
            <div class="stack" style="gap:4px">
              <div class="row"><span class="pill">${p.status}</span>${p.household_role === 'child' ? html`<span class="pill">Child</span>` : ''}
                ${p.campus_id ? html`<span class="campus-tag">${campusName(p.campus_id)}</span>` : ''}</div>
              ${p.email ? html`<a href="mailto:${p.email}">${p.email}</a>` : ''}
              ${p.phone ? html`<a href="tel:${p.phone}">${p.phone}</a>` : ''}
              ${p.birthdate ? html`<span class="muted small">Born ${fmtDate(p.birthdate, { month: 'long', day: 'numeric', year: 'numeric' })} (${ageLabel(p.birthdate, now)})</span>` : ''}
              ${p.grade != null ? html`<span class="muted small">${gradeLabel(p.grade)}</span>` : ''}
            </div>
          </div>
          ${p.allergies ? html`<div class="alert bad" style="margin-top:12px"><span class="allergy">Allergies:</span> ${p.allergies}</div>` : ''}
          ${p.medical_notes ? html`<div class="alert" style="margin-top:8px"><b>Medical:</b> ${p.medical_notes}</div>` : ''}
          ${p.notes ? html`<p class="muted small" style="white-space:pre-wrap">${p.notes}</p>` : ''}
          ${p.account ? html`<p class="muted small">Signs in as ${p.account.email} (${p.account.role})</p>` : ''}
        </div>

        <div class="stack" data-profile></div>

        <div class="card">
          <div class="card-head"><h2>${h ? h.name : 'Household'}</h2>
            ${staff ? html`${h ? html`<button class="btn small" data-edit-household>${icon('edit')}</button>` : ''}
            <button class="btn small" data-add-member>${icon('plus')} ${h ? 'Add to household' : 'Start household'}</button>` : ''}</div>
          ${h ? html`
            ${h.address ? html`<p class="muted small">${h.address}${h.city ? `, ${h.city}` : ''} ${h.state} ${h.zip}</p>` : ''}
            ${h.members.map((m) => html`<a class="row" href="#/people/${m.id}" style="padding:6px 0;color:inherit">${avatar(m)}<span>${displayName(m)}</span>
              <span class="muted small">${m.household_role === 'child' ? `Child${m.birthdate ? ` · ${ageLabel(m.birthdate, now)}` : ''}` : 'Adult'}</span></a>`)}
            <h3 style="margin-top:14px">Also allowed to pick up kids</h3>
            ${h.pickups.length ? h.pickups.map((pu) => html`<div class="row small" style="padding:3px 0"><span>${pu.name}</span><span class="muted">${pu.relationship} ${pu.phone}</span>
              ${staff ? html`<button class="icon-btn" data-del-pickup="${pu.id}" title="Remove">${icon('x')}</button>` : ''}</div>`) : html`<p class="muted small">Only adults in this household.</p>`}
            ${staff ? html`<button class="btn small" data-add-pickup>${icon('plus')} Add pickup person</button>` : ''}
          ` : html`<p class="muted">Not part of a household yet.</p>`}
        </div>
      </div>

      <div class="stack">
        <div class="card"><h2>Teams</h2>
          ${p.teams.length ? p.teams.map((t) => html`<a class="row" href="#/teams/${t.id}" style="padding:4px 0;color:inherit"><span class="dot" style="background:${t.color}"></span>${t.name}
            ${t.position ? html`<span class="muted">· ${t.position}</span>` : ''}${t.is_leader ? html`<span class="pill info">Leader</span>` : ''}</a>`) : html`<p class="muted">Not on a team.</p>`}
        </div>
        <div class="card"><h2>Scheduled to serve</h2>
          ${p.upcoming.length ? html`<table class="list"><tbody>${p.upcoming.map((a) => html`<tr class="click" data-href="#/services/${a.service_id}">
            <td>${fmtDate(a.starts_at)} <span class="muted small">${fmtTime(a.starts_at)} ${a.campus}</span></td><td>${a.position}</td>
            <td><span class="pill ${a.status === 'accepted' ? 'good' : a.status === 'declined' ? 'bad' : ''}">${a.status}</span></td></tr>`)}</tbody></table>`
            : html`<p class="muted">Nothing upcoming.</p>`}
          ${p.blockouts.length ? html`<h3 style="margin-top:12px">Away</h3>${p.blockouts.map((b) => html`<div class="small">${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date)}` : ''} <span class="muted">${b.reason}</span></div>`)}` : ''}
        </div>
        <div class="card"><div class="card-head"><h2>Attendance</h2><span class="muted small">${att.weeks_attended_of_12} of the last 12 weeks</span></div>
          ${att.recent.length ? html`<table class="list"><tbody>${att.recent.slice(0, 8).map((a) => html`<tr class="click" data-href="#/services/${a.service_id}">
            <td>${fmtDate(a.starts_at)}</td><td class="muted small">${fmtTime(a.starts_at)} · ${a.campus_short || a.campus}</td></tr>`)}</tbody></table>`
            : html`<p class="muted">No attendance marked yet.</p>`}
          ${p.checkins.length ? html`<h3 style="margin-top:12px">Kids check-in</h3>${p.checkins.slice(0, 5).map((c) => html`<div class="small">${new Date(c.checked_in_at).toLocaleDateString()} · ${c.room || c.kind}</div>`)}` : ''}
        </div>
        ${staff && !p.archived ? html`<button class="btn danger" data-archive>${icon('trash')} Archive this person</button>` : ''}
      </div>
    </div>`);

  const reload = () => person(el, id);
  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-edit]')?.addEventListener('click', async () => { if (await personDialog(p)) reload(); });
  top.querySelector('[data-merge]')?.addEventListener('click', async () => {
    const dup = await pickPerson('Which record is the duplicate?', { filter: (x) => x.id !== p.id });
    if (!dup) return;
    if (!(await confirm('Merge records?', `${displayName(dup)}’s history, teams and schedule will move to ${displayName(p)}, and the duplicate will be archived.`, 'Merge'))) return;
    try { await post(`/people/${p.id}/merge`, { duplicate_id: dup.id }); toast('Merged.'); reload(); } catch (e) { fail(e); }
  });

  drawProfile(el.querySelector('[data-profile]'), p.id).catch(fail);

  el.querySelector('[data-photo]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await api('POST', `/people/${p.id}/photo`, await shrinkImage(file)); toast('Photo updated.'); reload(); } catch (err) { fail(err); }
  });

  el.onclick = async (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-archive]') && await confirm('Archive this person?', 'They’ll be hidden from lists and check-in. You can restore them later.', 'Archive')) {
        await patch(`/people/${p.id}`, { archived: true }); go('/people');
      }
      if (b.matches('[data-unarchive]')) { await patch(`/people/${p.id}`, { archived: false }); reload(); }
      if (b.matches('[data-add-member]')) {
        if (!h) {
          const hh = await post('/households', { name: `${p.last_name || p.first_name} Household`, campus_id: p.campus_id });
          await patch(`/people/${p.id}`, { household_id: hh.id });
          return reload();
        }
        const choice = await dialog({
          title: `Add to ${h.name}`, submit: null,
          body: html`<div class="stack"><button type="button" class="btn" data-new>Someone new (e.g. a child)</button><button type="button" class="btn" data-existing>Someone already in the directory</button></div>`,
          onOpen: (d, close) => { d.querySelector('[data-new]').onclick = () => close('new'); d.querySelector('[data-existing]').onclick = () => close('existing'); },
        });
        if (choice === 'new' && await personDialog({ household_id: h.id, last_name: p.last_name, campus_id: p.campus_id, household_role: 'child' })) reload();
        if (choice === 'existing') {
          const other = await pickPerson('Who should join this household?');
          if (other) { await patch(`/people/${other.id}`, { household_id: h.id }); reload(); }
        }
      }
      if (b.matches('[data-edit-household]')) {
        const ok = await dialog({
          title: 'Household',
          body: html`<div class="form"><label class="field wide">Name<input type="text" name="name" value="${h.name}" required></label>
            <label class="field wide">Address<input type="text" name="address" value="${h.address}"></label>
            <label class="field">City<input type="text" name="city" value="${h.city}"></label>
            <label class="field">State<input type="text" name="state" value="${h.state}"></label>
            <label class="field">ZIP<input type="text" name="zip" value="${h.zip}"></label>
            <label class="field">Home phone<input type="tel" name="phone" value="${h.phone}"></label>
            <label class="field">Campus<select name="campus_id">${options(visibleCampuses().map((c) => ({ value: c.id, label: c.name })), h.campus_id, { blank: '—' })}</select></label></div>`,
          onSubmit: (f) => patch(`/households/${h.id}`, formData(f)),
        });
        if (ok) reload();
      }
      if (b.matches('[data-add-pickup]')) {
        const ok = await dialog({
          title: 'Also allowed to pick up kids', submit: 'Add',
          body: html`<div class="form"><label class="field wide">Name<input type="text" name="name" required></label>
            <label class="field">Relationship<input type="text" name="relationship" placeholder="Grandmother"></label>
            <label class="field">Phone<input type="tel" name="phone"></label></div>`,
          onSubmit: (f) => post(`/households/${h.id}/pickups`, formData(f)),
        });
        if (ok) reload();
      }
      if (b.dataset.delPickup) { await del(`/pickups/${b.dataset.delPickup}`); reload(); }
    } catch (err) { fail(err); }
  };
}

// Add or edit a person. Resolves to the saved person, or undefined if cancelled.
export async function personDialog(p = {}) {
  const editing = Boolean(p.id);
  const camps = visibleCampuses();
  let saved;
  await dialog({
    title: editing ? `Edit ${displayName(p)}` : 'Add a person',
    wide: true,
    body: html`<div class="form">
      <label class="field">First name<input type="text" name="first_name" value="${p.first_name || ''}" required></label>
      <label class="field">Last name<input type="text" name="last_name" value="${p.last_name || ''}"></label>
      <label class="field">Goes by<input type="text" name="nickname" value="${p.nickname || ''}"></label>
      <label class="field">Email<input type="email" name="email" value="${p.email || ''}"></label>
      <label class="field">Mobile phone<input type="tel" name="phone" value="${p.phone || ''}"></label>
      <label class="field">Birthdate<input type="date" name="birthdate" value="${p.birthdate || ''}"></label>
      <label class="field">Gender<select name="gender">${options([{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }], p.gender, { blank: '—' })}</select></label>
      <label class="field">Status<select name="status">${options([{ value: 'guest', label: 'Guest' }, { value: 'regular', label: 'Regular attender' }, { value: 'member', label: 'Member' }, { value: 'inactive', label: 'Inactive' }], p.status || 'guest')}</select></label>
      <label class="field">Adult or child<select name="household_role">${options([{ value: 'adult', label: 'Adult' }, { value: 'child', label: 'Child' }], p.household_role || 'adult')}</select></label>
      <label class="field">School grade<select name="grade">${options(GRADES, p.grade, { blank: '—' })}</select></label>
      ${camps.length ? html`<label class="field">Campus<select name="campus_id">${options(camps.map((c) => ({ value: c.id, label: c.name })), p.campus_id ?? state.campusId ?? (camps.length === 1 ? camps[0].id : ''), { blank: '—' })}</select></label>` : ''}
      <label class="field wide">Allergies (printed on kids’ name tags)<input type="text" name="allergies" value="${p.allergies || ''}"></label>
      <label class="field wide">Medical notes (shown to kids’ leaders)<input type="text" name="medical_notes" value="${p.medical_notes || ''}"></label>
      <label class="field wide">Notes<textarea name="notes">${p.notes || ''}</textarea></label>
      ${!editing && !p.household_id ? html`<label class="check wide"><input type="checkbox" name="new_household" checked> Start a new household for them</label>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const body = formData(f);
      if (p.household_id && !editing) body.household_id = p.household_id;
      try {
        saved = editing ? await patch(`/people/${p.id}`, body) : await post('/people', body);
      } catch (e) {
        if (e.status !== 409) throw e;
        const dup = e.data.duplicate;
        const goThere = await dialog({
          title: 'Already in the directory?', submit: 'Add anyway', cancel: 'Open existing',
          body: html`<p>${displayName(dup)} is already in the directory${dup.email ? ` (${dup.email})` : ''}. Is this the same person?</p>`,
        });
        if (goThere === undefined) { go(`/people/${dup.id}`); return true; }
        saved = await post('/people', { ...body, force: true });
      }
      toast(editing ? 'Saved.' : 'Added.');
      return true;
    },
  });
  return saved;
}

