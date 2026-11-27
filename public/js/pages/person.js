// One person's profile: details, household, teams, schedule and check-in history.
import { get, post, patch, del, api, html, mount, icon, avatar, displayName, dialog, formData, exclusiveCampusBoxes, options, toast, fail, fmtDate, fmtTime, confirm, pickPerson, pickFamily, shrinkImage, fmtUtcDate, familyName } from '../lib.js';
import { state, can, setTitle, go, campusName, visibleCampuses } from '../app.js';
import { gradeLabel, ageLabel } from '../checkin-rules.js';
import { drawProfile } from '../profile.js';
import { drawStudiesCard } from '../studies-card.js';

// Households are called families in the interface; the data keeps its name ("Diaz Household" reads "Diaz family").

const ROLE_LABEL = { volunteer: 'Volunteer', leader: 'Leader', staff: 'Staff', admin: 'Admin' };
const ROLE_HELP = {
  volunteer: 'Their own schedule and the services they serve at',
  leader: 'Also people, teams, scheduling their teams, check-in',
  staff: 'Also edits people, services, rooms and all scheduling',
  admin: 'Everything, including settings and accounts',
};

const GRADES = [{ value: -1, label: 'Pre-K' }, { value: 0, label: 'Kindergarten' }, ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: gradeLabel(i + 1) }))];

// Plain wording for where someone can serve (see server/eligibility.js for the rules).
function servesText(p) {
  if (p.serving_campuses.length) return p.serving_campuses.map(campusName).join(', ');
  return p.campus_id != null ? `Home campus only (${campusName(p.campus_id)})` : 'Any campus (campus not set)';
}

export default async function person(el, id) {
  const [p, att] = await Promise.all([get(`/people/${id}`), get(`/people/${id}/attendance`)]);
  const staff = can('staff');
  // Back to the People list, which reopens at the same search, filters and place.
  setTitle(displayName(p), html`<a class="btn ghost" href="#/people" data-back-people>${icon('back')} People</a>${staff ? html`<button class="btn" data-edit>${icon('edit')} Edit</button>` : ''}
    ${can('admin') ? html`<span class="kebab"><button class="icon-btn" data-kebab aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${icon('dots')}</button>
      <div class="kebab-menu hidden" role="menu"><button type="button" role="menuitem" data-merge title="Merge a duplicate record into this one">${icon('copy')} Merge duplicate</button></div></span>` : ''}`);
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
          ${p.account || can('admin') ? html`<div class="row small" style="margin-top:10px">
            <span class="muted">${p.account
              ? html`Account: <b>${ROLE_LABEL[p.account.role]}</b>${p.account.finance ? ' + Finance' : ''}${p.account.announce ? ' + Announcements' : ''}${p.account.attendance ? ' + Attendance' : ''}${p.account.app_editor ? ' + Edit the app' : ''}${p.account.studies ? ' + Bible studies' : ''}${p.account.role_auto ? ' (team leader)' : ''} · ${p.account.email}${p.account.active ? '' : ' · can’t sign in'} · ${p.account.last_login ? `last signed in ${fmtDate(p.account.last_login.slice(0, 10))}` : 'hasn’t signed in yet'}`
              : p.email ? 'No account yet; they get a volunteer account by signing in.' : 'No account (needs an email to sign in).'}</span>
            ${can('admin') && p.account && p.account.editable === false ? html`<span class="muted small">${p.account.id === state.me?.id ? 'You can’t change your own access. Ask an admin who covers every campus.' : 'Only an admin who covers every campus can change this account.'}</span>` : ''}
            ${can('admin') && (p.account ? p.account.editable !== false : p.email) ? html`<button class="btn small ghost" data-access>${p.account ? 'Change access' : 'Give more access'}</button>` : ''}</div>` : ''}
        </div>

        <div class="card">
          <div class="card-head"><h2>${h ? familyName(h.name) : 'Family'}</h2>
            ${staff ? html`${h ? html`<button class="btn small" data-edit-household aria-label="Edit family" title="Edit family">${icon('edit')}</button>` : ''}
            <button class="btn small" data-add-member>${icon('plus')} ${h ? 'Add to family' : 'Add to a family'}</button>` : ''}</div>
          ${h ? html`
            ${h.address ? html`<p class="muted small">${h.address}${h.city ? `, ${h.city}` : ''} ${h.state} ${h.zip}</p>` : ''}
            ${h.members.map((m) => html`<a class="row" href="#/people/${m.id}" style="padding:6px 0;color:inherit">${avatar(m)}<span>${displayName(m)}</span>
              <span class="muted small">${m.household_role === 'child' ? `Child${m.birthdate ? ` · ${ageLabel(m.birthdate, now)}` : ''}` : 'Adult'}</span></a>`)}
            ${h.pickups ? html`<h3 style="margin-top:14px">Also allowed to pick up kids</h3>
            ${h.pickups.length ? h.pickups.map((pu) => html`<div class="row small" style="padding:3px 0"><span>${pu.name}</span><span class="muted">${pu.relationship} ${pu.phone}</span>
              ${staff ? html`<button class="icon-btn" data-del-pickup="${pu.id}" title="Remove">${icon('x')}</button>` : ''}</div>`) : html`<p class="muted small">Only adults in this family.</p>`}` : ''}
            ${staff ? html`<button class="btn small" data-add-pickup>${icon('plus')} Add pickup person</button>` : ''}
          ` : html`<p class="muted">Not part of a family yet.</p>`}
        </div>
        <div class="stack" data-profile></div>
      </div>

      <div class="stack">
        <div class="card"><div class="card-head"><h2>Teams and serving</h2>${staff ? html`<button class="btn small" data-serves>${icon('edit')} Edit</button>` : ''}</div>
          ${p.teams.length ? p.teams.map((t) => html`<a class="row" href="#/teams/${t.id}" style="padding:4px 0;color:inherit"><span class="dot" style="background:${t.color}"></span>${t.name}
            ${t.position ? html`<span class="muted">· ${t.position}</span>` : ''}${t.is_leader ? html`<span class="pill info">Leader</span>` : ''}</a>`) : html`<p class="muted">Not on a team.</p>`}
          <h3 style="margin-top:12px">Scheduled to serve</h3>
          ${p.upcoming.length ? html`<table class="list"><tbody>${p.upcoming.map((a) => html`<tr class="click" data-href="#/services/${a.service_id}">
            <td>${fmtDate(a.starts_at)} <span class="muted small">${fmtTime(a.starts_at)} ${a.campus}</span></td><td>${a.position}</td>
            <td><span class="pill ${a.status === 'accepted' ? 'good' : a.status === 'declined' ? 'bad' : ''}">${a.status}</span></td></tr>`)}</tbody></table>`
            : html`<p class="muted" style="margin:0">Nothing upcoming.</p>`}
          ${p.blockouts.length ? html`<h3 style="margin-top:12px">Away</h3>${p.blockouts.map((b) => html`<div class="small">${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` – ${fmtDate(b.end_date)}` : ''} <span class="muted">${b.reason}</span></div>`)}` : ''}
          <p class="small" style="margin:12px 0 0"><span class="muted">Can serve at:</span> ${servesText(p)}</p>
          ${!p.serving_campuses.length && p.campus_id == null ? html`<p class="muted small" style="margin-bottom:0">${staff ? 'Set a home campus or pick campuses so scheduling knows where they can serve.' : 'No campus is set yet.'}</p>` : ''}
        </div>
        <div class="card"><div class="card-head"><h2>Attendance</h2><span class="muted small">${att.weeks_attended_of_12} of the last 12 weeks</span></div>
          ${att.recent.length ? html`<table class="list"><tbody>${att.recent.slice(0, 8).map((a, i) => html`<tr class="click ${i >= 3 ? 'att-extra hidden' : ''}" data-href="#/services/${a.service_id}">
            <td>${fmtDate(a.starts_at)}</td><td class="muted small">${fmtTime(a.starts_at)} · ${a.campus_short || a.campus}</td></tr>`)}</tbody></table>
            ${att.recent.length > 3 ? html`<button class="btn small ghost" data-att-all style="margin-top:6px">Show all</button>` : ''}`
            : html`<p class="muted">No attendance marked yet.</p>`}
          ${p.checkins.length ? html`<h3 style="margin-top:12px">Kids check-in</h3>${p.checkins.slice(0, 5).map((c) => html`<div class="small">${fmtUtcDate(c.checked_in_at)} · ${c.room || c.kind}</div>`)}` : ''}
        </div>
        <div data-studies></div>
        ${staff && !p.archived ? html`<button class="btn danger" data-archive>${icon('trash')} Archive this person</button>` : ''}
      </div>
    </div>`);

  const reload = () => person(el, id);
  const top = document.querySelector('[data-actions]');
  top.querySelector('[data-edit]')?.addEventListener('click', async () => { if (await personDialog(p)) reload(); });
  const kebab = top.querySelector('[data-kebab]');
  if (kebab) {
    const menu = kebab.parentElement.querySelector('.kebab-menu');
    const setOpen = (o) => { menu.classList.toggle('hidden', !o); kebab.setAttribute('aria-expanded', o); };
    kebab.onclick = (e) => { e.stopPropagation(); setOpen(menu.classList.contains('hidden')); };
    menu.onclick = () => setOpen(false);
    const away = () => { if (!menu.isConnected) document.removeEventListener('click', away); else setOpen(false); };
    document.addEventListener('click', away);
  }
  top.querySelector('[data-merge]')?.addEventListener('click', async () => {
    const dup = await pickPerson('Which record is the duplicate?', { filter: (x) => x.id !== p.id });
    if (!dup) return;
    if (!(await confirm('Merge records?', `${displayName(dup)}’s history, teams and schedule will move to ${displayName(p)}, and the duplicate will be archived.`, 'Merge'))) return;
    try { await post(`/people/${p.id}/merge`, { duplicate_id: dup.id }); toast('Merged.'); reload(); } catch (e) { fail(e); }
  });

  el.querySelector('[data-serves]')?.addEventListener('click', async () => {
    const camps = visibleCampuses();
    // Campuses this person serves at that this staff member can't see stay as they are.
    const hidden = p.serving_campuses.filter((id) => !camps.some((c) => c.id === id));
    let saved;
    await dialog({
      title: 'Can serve at', submit: 'Save',
      body: html`<p class="muted small" style="margin-top:0">Pick the campuses ${displayName(p)} can be scheduled at. Leave all unticked for ${p.campus_id ? `${campusName(p.campus_id)} only (their home campus)` : 'any campus, since no home campus is set'}.</p>
        ${camps.map((c) => html`<label class="check"><input type="checkbox" data-serve="${c.id}" ${p.serving_campuses.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}`,
      onSubmit: async (f) => {
        const ids = [...f.querySelectorAll('[data-serve]:checked')].map((c) => Number(c.dataset.serve));
        saved = await api('PUT', `/people/${p.id}/serving-campuses`, { campus_ids: [...hidden, ...ids] });
      },
    });
    if (saved) { toast('Saved.'); reload(); }
  });

  drawProfile(el.querySelector('[data-profile]'), p.id).catch(fail);
  // Bible studies are private to coordinators and staff (the server checks too).
  if (staff || state.me.studies) drawStudiesCard(el.querySelector('[data-studies]'), p).catch(fail);

  el.querySelector('[data-photo]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await api('POST', `/people/${p.id}/photo`, await shrinkImage(file)); toast('Photo updated.'); reload(); } catch (err) { fail(err); }
  });

  el.querySelector('[data-access]')?.addEventListener('click', () => accessDialog(p).then((ok) => ok && person(el, id)).catch(fail));
  el.onclick = async (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-att-all]')) { el.querySelectorAll('.att-extra').forEach((r) => r.classList.remove('hidden')); b.remove(); }
      if (b.matches('[data-archive]') && await confirm('Archive this person?', 'They’ll be hidden from lists and check-in. You can restore them later.', 'Archive')) {
        await patch(`/people/${p.id}`, { archived: true }); go('/people');
      }
      if (b.matches('[data-unarchive]')) { await patch(`/people/${p.id}`, { archived: false }); reload(); }
      if (b.matches('[data-add-member]')) {
        const who = displayName(p);
        // Joining someone else's family and bringing someone into this one are separate choices,
        // so picking "Mom" never quietly moves Mom out of her own family.
        const choice = await dialog({
          title: h ? `Add to ${familyName(h.name)}` : `${who}’s family`, submit: null,
          body: html`<div class="stack">
            ${h ? html`<button type="button" class="btn" data-c="new">Someone new (e.g. a child)</button>
              <button type="button" class="btn" data-c="existing">Someone already in the directory</button>` : ''}
            <button type="button" class="btn" data-c="join">${h ? `Move ${who} to a different family` : `Add ${who} to an existing family`}</button>
            ${h ? '' : html`<button type="button" class="btn" data-c="start">Start a new family for ${who}</button>`}</div>`,
          onOpen: (d, close) => { d.querySelectorAll('[data-c]').forEach((x) => { x.onclick = () => close(x.dataset.c); }); },
        });
        if (choice === 'start') {
          const hh = await post('/households', { name: `${p.last_name || p.first_name} family`, campus_id: p.campus_id });
          await patch(`/people/${p.id}`, { household_id: hh.id });
          return reload();
        }
        if (choice === 'join') {
          const fam = await pickFamily(`Which family is ${who} joining?`, { exclude: h?.id });
          if (fam && await joinFamily(p, h, fam)) reload();
        }
        if (choice === 'new' && await personDialog({ household_id: h.id, household_name: familyName(h.name), last_name: p.last_name, campus_id: p.campus_id, household_role: 'child' })) reload();
        if (choice === 'existing') {
          const other = await pickPerson('Who should join this family?');
          if (!other) return;
          if (other.household_id === h.id) { toast(`${displayName(other)} is already in this family.`); return; }
          if (!other.household_id) { await patch(`/people/${other.id}`, { household_id: h.id }); toast(`${displayName(other)} added.`); return reload(); }
          // They already have a family: ask which way round it should go.
          const way = await dialog({
            title: `${displayName(other)} already has a family`, submit: null,
            body: html`<div class="stack">
              <button type="button" class="btn primary" data-w="join">Add ${who} to ${displayName(other)}’s family</button>
              <button type="button" class="btn" data-w="move">Move ${displayName(other)} into ${who}’s family (they leave their current family)</button></div>`,
            onOpen: (d, close) => { d.querySelectorAll('[data-w]').forEach((x) => { x.onclick = () => close(x.dataset.w); }); },
          });
          if (way === 'join' && await joinFamily(p, h, { id: other.household_id, name: `${displayName(other)}’s family` })) reload();
          if (way === 'move') { await patch(`/people/${other.id}`, { household_id: h.id }); toast(`${displayName(other)} moved into ${who}’s family.`); reload(); }
        }
      }
      if (b.matches('[data-edit-household]')) {
        const ok = await dialog({
          title: 'Family',
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

// Moves this person into another family, after saying who's there and what they leave.
async function joinFamily(p, current, fam) {
  const others = current ? current.members.filter((m) => m.id !== p.id) : [];
  const ok = await confirm(`Add ${displayName(p)} to ${fam.name}?`,
    `${fam.people?.length ? `In this family: ${fam.people.map((m) => m.name).join(', ')}. ` : ''}${others.length ? `They’ll leave ${familyName(current.name)}.` : ''}`, 'Add to family', { danger: false });
  if (!ok) return false;
  await patch(`/people/${p.id}`, { household_id: fam.id });
  toast(`${displayName(p)} is now in ${fam.name}.`);
  return true;
}

// Add or edit a person. Resolves to the saved person (the last one saved), or undefined if cancelled.
// Adding starts with a short screen (name, contact, status, campus, family); the rest sits under
// "More details". "Save and add another" keeps the family, campus and status for the next person.
export async function personDialog(p = {}) {
  const editing = Boolean(p.id);
  const camps = visibleCampuses();
  let saved;
  // The family this person joins: { id, name, hasAdult }. Null means a new family is started for them.
  let fam = p.household_id ? { id: p.household_id, name: p.household_name || `${p.last_name || 'this'} family`, hasAdult: null } : null;
  let another = false;
  let roleTouched = Boolean(p.household_role);
  // Below staff only a child can join an existing family (the server's rule), so that's their default.
  const defaultRole = () => (fam && fam.hasAdult === false && can('staff') ? 'adult' : p.household_role || (fam ? 'child' : 'adult'));
  await dialog({
    title: editing ? `Edit ${displayName(p)}` : 'Add a person',
    wide: true,
    body: html`<div class="form">
      <label class="field">First name<input type="text" name="first_name" value="${p.first_name || ''}" required></label>
      <label class="field">Last name<input type="text" name="last_name" value="${p.last_name || ''}"></label>
      <label class="field">Mobile phone<input type="tel" name="phone" value="${p.phone || ''}"></label>
      <label class="field">Email<input type="email" name="email" value="${p.email || ''}"></label>
      <label class="field">Status<select name="status">${options([{ value: 'guest', label: 'Guest' }, { value: 'regular', label: 'Regular attender' }, { value: 'member', label: 'Member' }, { value: 'inactive', label: 'Inactive' }], p.status || 'guest')}</select></label>
      ${camps.length ? html`<label class="field">Campus<select name="campus_id">${options(camps.map((c) => ({ value: c.id, label: c.name })), p.campus_id ?? state.campusId ?? (camps.length === 1 ? camps[0].id : ''), { blank: '—' })}</select></label>` : ''}
      ${!editing ? html`<div class="field wide" data-family></div>` : ''}
      <details class="more-details wide" ${editing ? 'open' : ''}><summary>More details</summary>
        <div class="form">
          <label class="field">Goes by<input type="text" name="nickname" value="${p.nickname || ''}"></label>
          <label class="field">Birthdate<input type="date" name="birthdate" value="${p.birthdate || ''}"></label>
          <label class="field">Gender<select name="gender">${options([{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }], p.gender, { blank: '—' })}</select></label>
          <label class="field">Adult or child<select name="household_role">${options([{ value: 'adult', label: 'Adult' }, { value: 'child', label: 'Child' }], p.household_role || (editing ? 'adult' : defaultRole()))}</select></label>
          <label class="field">School grade<select name="grade">${options(GRADES, p.grade, { blank: '—' })}</select></label>
          <label class="field wide">Allergies (printed on kids’ name tags)<input type="text" name="allergies" value="${p.allergies || ''}"></label>
          <label class="field wide">Medical notes (shown to kids’ leaders)<input type="text" name="medical_notes" value="${p.medical_notes || ''}"></label>
          <label class="field wide">Notes<textarea name="notes">${p.notes || ''}</textarea></label>
        </div>
      </details>
    </div>`,
    onOpen: (d) => {
      const role = d.querySelector('[name=household_role]');
      role.addEventListener('change', () => { roleTouched = true; });
      if (editing) return;
      const slot = d.querySelector('[data-family]');
      const setRole = () => { if (!roleTouched) role.value = defaultRole(); };
      const draw = () => {
        mount(slot, fam
          ? html`<span>Family</span><div class="row"><span class="pill">${fam.name}</span>
              ${p.household_id && fam.id === p.household_id ? '' : html`<button type="button" class="btn small" data-clear>Start a new family instead</button>`}</div>
              <small class="muted">${role.value === 'child' ? 'They’ll be added as a child' : 'They’ll be added as an adult'} (change under More details).</small>`
          : html`<span>Family</span><div class="row"><span class="muted small">A new family will be started for them.</span>
              <button type="button" class="btn small" data-pick>Add to a family…</button></div>`);
      };
      slot.addEventListener('click', async (e) => {
        if (e.target.closest('[data-clear]')) { fam = null; setRole(); draw(); }
        if (!e.target.closest('[data-pick]')) return;
        const chosen = await pickFamily('Which family are they joining?');
        if (!chosen) return;
        fam = { id: chosen.id, name: chosen.name, hasAdult: chosen.people.some((m) => m.role === 'adult') };
        setRole(); draw();
      });
      role.addEventListener('change', draw);
      // Save and add another sits beside Save in the footer.
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = 'Save and add another';
      b.addEventListener('click', () => { another = true; d.querySelector('form').requestSubmit(); });
      d.querySelector('.dlg-foot button[type=submit]').before(b);
      draw();
    },
    onSubmit: async (f, d) => {
      const body = formData(f);
      const wantsAnother = another;
      another = false;
      if (!editing) { if (fam) body.household_id = fam.id; else body.new_household = true; }
      const create = async (extra = {}) => {
        const r = await post('/people', { ...body, ...extra });
        return r;
      };
      try {
        saved = editing ? await patch(`/people/${p.id}`, body) : await create();
      } catch (e) {
        if (e.status !== 409) throw e;
        const dup = e.data.duplicate;
        const goThere = await dialog({
          title: 'Already in the directory?', submit: 'Add anyway', cancel: 'Open existing',
          body: html`<p>${displayName(dup)} is already in the directory${dup.email ? ` (${dup.email})` : ''}. Is this the same person?</p>`,
        });
        if (goThere === undefined) { go(`/people/${dup.id}`); return true; }
        saved = await create({ force: true });
      }
      if (!wantsAnother || editing) { toast(editing ? 'Saved.' : 'Added.'); return true; }
      // Stay open for the next person: they join the same family (the one just started, if new).
      toast(`Added ${displayName(saved)}. Add the next person.`);
      fam = { id: saved.household_id, name: `${saved.last_name || saved.first_name} family`, hasAdult: saved.household_role === 'adult' ? true : (fam ? fam.hasAdult : false) };
      for (const n of ['first_name', 'email', 'phone', 'nickname', 'birthdate', 'gender', 'grade', 'allergies', 'medical_notes', 'notes']) f.elements[n].value = '';
      roleTouched = false;
      f.elements.household_role.value = defaultRole();
      f.elements.household_role.dispatchEvent(new Event('change'));
      roleTouched = false;
      f.elements.first_name.focus();
      return false;
    },
  });
  return saved;
}

// An admin changes what this person can do (or sets up an account before they first sign in).
async function accessDialog(p) {
  const a = p.account || { role: 'volunteer', active: 1, campus_ids: null };
  const camps = a.campus_ids ? JSON.parse(a.campus_ids) : null;
  const limited = Boolean(state.me.campusIds);
  const mine = state.me.campusIds || [];
  let touched = false; // a limited admin sends the campus list only if they changed it
  return dialog({
    onOpen: (d) => exclusiveCampusBoxes(d, () => { touched = true; }),
    title: `${displayName(p)}’s access`,
    body: html`<div class="stack">
      ${p.account ? html`<p class="muted small" style="margin:0">Signs in as ${a.email}${a.has_password ? ' (email and password, or Google)' : ''}.</p>`
        : html`<label class="field">Email they’ll sign in with<input type="email" name="email" value="${p.email}" required></label>`}
      <label class="field">Access<select name="role">${options(Object.keys(ROLE_HELP).filter((r) => !limited || r !== 'admin').map((r) => ({ value: r, label: `${ROLE_LABEL[r]}: ${ROLE_HELP[r]}` })), a.role)}</select></label>
      ${a.role_auto ? html`<p class="muted small" style="margin:0">They have leader access because they lead a team, so it ends if they stop leading or the account is unlinked. To keep it regardless, choose another access level, save, then choose Leader and save again.</p>` : ''}
      <div class="field"><span>Campuses</span>
        <label class="check"><input type="checkbox" name="all" ${!camps && !(limited && !p.account) ? 'checked' : ''} ${limited ? 'disabled' : ''}> All campuses</label>
        ${state.campuses.map((c) => html`<label class="check"><input type="checkbox" data-campus="${c.id}" ${camps?.includes(c.id) || (limited && !p.account && mine.includes(c.id)) ? 'checked' : ''} ${limited && !mine.includes(c.id) ? 'disabled' : ''}> ${c.name}</label>`)}</div>
      ${limited ? html`<p class="muted small" style="margin:0">Some options are for admins who cover every campus.</p>` : ''}
      <label class="check"><input type="checkbox" name="finance" ${a.finance ? 'checked' : ''} ${limited ? 'disabled' : ''}> <span><b>Finance</b>: sees giving (who gave and how much), records gifts, sends statements. Separate from Access above: admins don’t see giving without it.</span></label>
      <label class="check"><input type="checkbox" name="announce" ${a.announce ? 'checked' : ''} ${limited ? 'disabled' : ''}> <span><b>Announcements</b>: sends notifications to the congregation from the hub (everyone, a campus or a team). Admins can always.</span></label>
      <label class="check"><input type="checkbox" name="attendance" ${a.attendance ? 'checked' : ''}> <span><b>Attendance</b>: can take attendance (roll call, families, new guests, headcounts) at the campuses ticked above, and nothing else. Leaders and above already can. Needs a campus ticked.</span></label>
      <label class="check"><input type="checkbox" name="studies" ${a.studies ? 'checked' : ''} ${limited ? 'disabled' : ''}> <span><b>Bible studies coordinator</b>: sees every Bible study, who is waiting for a teacher and the approved materials, and matches people with teachers. Staff and admins already can.</span></label>
      ${p.account ? html`<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Can sign in</label>` : ''}
    </div>`,
    onSubmit: (f) => {
      const b = formData(f);
      const body = { role: b.role, person_id: p.id, finance: b.finance, announce: b.announce, attendance: b.attendance, studies: b.studies, campus_ids: b.all ? 'all' : [...f.querySelectorAll('[data-campus]:checked')].map((c) => Number(c.dataset.campus)) };
      if (limited) { delete body.finance; delete body.announce; delete body.studies; if (p.account && !camps && !touched) delete body.campus_ids; } // the server refuses those changes for them
      if (p.account) return patch(`/users/${a.id}`, { ...body, active: b.active });
      return post('/users', { ...body, email: b.email });
    },
  });
}
