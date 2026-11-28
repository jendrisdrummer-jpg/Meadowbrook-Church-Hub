// The Bible studies card on a person's page, for coordinators and staff: studying now, studies
// completed (with a way to undo one and to add past history), and studies taught.
import { get, post, html, mount, icon, dialog, formData, options, toast, fail, confirm, fmtDate } from './lib.js';
import { pickStudyPerson } from './pages/studies.js';

export async function drawStudiesCard(box, p) {
  const d = await get(`/people/${p.id}/studies`);
  const draw = () => {
    mount(box, html`<div class="card"><div class="card-head"><h2>Bible studies</h2>
        ${d.can_edit ? html`<button class="btn small" data-add-done>${icon('plus')} Add a completed study</button>` : ''}</div>
      <h3 style="margin:0 0 6px">Studying now</h3>
      ${d.studying.length ? d.studying.map((s) => html`<div class="small" style="padding:3px 0">${s.material_title || 'Material not chosen yet'} <span class="muted">· ${s.status === 'paused' ? 'paused · ' : ''}since ${fmtDate(s.started_on)}</span></div>`) : html`<p class="muted small" style="margin:0">Not in a study right now.</p>`}
      <h3 style="margin:14px 0 6px">Studies completed</h3>
      ${d.completed.length ? d.completed.map((c) => html`<div class="row small" style="padding:3px 0"><span><b>${c.material_title}</b> <span class="muted">· ${fmtDate(c.completed_on, { month: 'short', day: 'numeric', year: 'numeric' })}${c.teacher_names ? ` · with ${c.teacher_names}` : ''}</span></span>
        <span class="spacer"></span>${c.can_revoke ? html`<button class="btn small ghost" data-undo="${c.id}" aria-label="Undo ${c.material_title}">Undo</button>` : ''}</div>`) : html`<p class="muted small" style="margin:0">Nothing recorded yet.</p>`}
      <h3 style="margin:14px 0 6px">Studies taught</h3>
      ${d.taught.length ? d.taught.map((t) => html`<div class="small" style="padding:3px 0">${t.material_title || 'Material not chosen yet'} <span class="muted">· ${t.study_id
        ? `${t.status}${t.current ? '' : ' · no longer teaching'} · ${t.students} ${t.students === 1 ? 'student' : 'students'}`
        : `${t.student_name}, ${fmtDate(t.completed_on, { month: 'short', year: 'numeric' })}`}</span></div>`) : html`<p class="muted small" style="margin:0">Hasn’t taught a study.</p>`}</div>`);
  };
  draw();
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.undo) {
        const c = d.completed.find((x) => x.id === Number(b.dataset.undo));
        if (!(await confirm(`Undo ${c.material_title}?`, `It will come off ${p.first_name}’s record. We keep a note of who undid it and when.`, 'Undo', { danger: false }))) return;
        await post(`/study-completions/${c.id}/revoke`);
        toast('Undone.');
        return drawStudiesCard(box, p);
      }
      if (b.matches('[data-add-done]')) {
        const { materials } = await get('/studies/materials');
        let teacher = null;
        const ok = await dialog({
          title: 'Add a completed study',
          body: html`<div class="form">
            <label class="field wide">Material<select name="material_id" required>${options(materials.map((m) => ({ value: m.id, label: m.active ? m.title : `${m.title} (retired)` })), '', { blank: 'Choose…' })}</select>
              <small class="muted">Not on the list? Add it under Bible studies, Materials, then retire it if it’s no longer used.</small></label>
            <label class="field">Finished on<input type="date" name="completed_on" required></label>
            <div class="field"><span>Teacher</span><div class="row"><span data-teacher class="muted small">Not chosen</span><button type="button" class="btn small" data-pick>Choose from People…</button></div></div>
            <label class="field wide">Or type a name (for someone not in People)<input type="text" name="teacher_name" maxlength="120"></label></div>`,
          onOpen: (dlg) => {
            dlg.querySelector('[data-pick]').onclick = async () => { const t = await pickStudyPerson('Who taught it?'); if (t) { teacher = t; dlg.querySelector('[data-teacher]').textContent = t.name; } };
          },
          onSubmit: (f) => { const v = formData(f); return post('/study-completions', { person_id: p.id, material_id: Number(v.material_id), completed_on: v.completed_on, teacher_ids: teacher ? [teacher.id] : [], teacher_name: v.teacher_name }); },
        });
        if (ok) { toast('Added.'); drawStudiesCard(box, p); }
      }
    } catch (err) { fail(err); }
  };
}
