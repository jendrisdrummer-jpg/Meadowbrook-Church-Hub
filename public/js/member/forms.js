// A form people fill in on their phone (opened from a link the church shares, or from More).
// Guests can fill in public forms; signed-in forms ask people to sign in first.
import { get, post, html, mount, icon, fieldError, clearFieldErrors, formError } from '../lib.js';

export async function formPage(el, slug, { app, setTitle, signInHref }) {
  setTitle('Form');
  let f;
  try { f = await get(`/public/forms/${encodeURIComponent(slug)}`); } catch {
    return mount(el, html`<div class="card m-big-action">${icon('info')}<h2 style="margin:0">This form isn’t open right now</h2><p class="muted" style="margin:0">It may have closed. Please ask the church office if you need it.</p><a class="btn" href="#/">Back home</a></div>`);
  }
  setTitle(f.title);
  if (f.needs_sign_in) {
    return mount(el, html`<div class="card m-big-action">${icon('lock')}<h2 style="margin:0">${f.title}</h2><p class="muted" style="margin:0">Please sign in to fill this in.</p><a class="btn primary" href="${signInHref(`/form/${f.slug}`)}">Sign in</a></div>`);
  }
  const c = f.ask_contact;
  const mark = (mode) => (mode === 'required' ? ' *' : mode === 'optional' ? ' (optional)' : '');
  // Single boxes are wrapped in their label; groups of choices (tick boxes, yes/no) are a fieldset with a legend.
  const field = (q) => (q.type === 'multichoice' || q.type === 'yesno'
    ? html`<fieldset class="field" data-q="${q.id}"><legend>${q.label}${q.required ? ' *' : ''}</legend>${q.type === 'multichoice'
      ? html`<div class="checks">${q.options.map((o) => html`<label class="check"><input type="checkbox" name="q_${q.id}" value="${o}"> ${o}</label>`)}</div>`
      : html`<div class="row" style="gap:8px 16px"><label class="check"><input type="radio" name="q_${q.id}" value="yes"> Yes</label><label class="check"><input type="radio" name="q_${q.id}" value="no"> No</label></div>`}</fieldset>`
    : html`<label class="field" data-q="${q.id}"><span>${q.label}${q.required ? ' *' : ''}</span>
    ${q.type === 'longtext' ? html`<textarea name="q_${q.id}" rows="4" maxlength="4000"></textarea>`
      : q.type === 'choice' ? html`<select name="q_${q.id}"><option value="">Choose…</option>${q.options.map((o) => html`<option>${o}</option>`)}</select>`
      : q.type === 'date' ? html`<input type="date" name="q_${q.id}">`
      : html`<input type="text" name="q_${q.id}" maxlength="1000">`}</label>`);
  mount(el, html`<form class="card m-form" novalidate>
    ${f.intro ? html`<p class="muted" style="margin:0 0 14px;white-space:pre-line">${f.intro}</p>` : ''}
    <div class="form">
      ${c.name !== 'off' ? html`<label class="field">Your name${mark(c.name)}<input type="text" name="name" autocomplete="name" maxlength="120"></label>` : ''}
      ${c.email !== 'off' ? html`<label class="field">Email${mark(c.email)}<input type="email" name="email" autocomplete="email" maxlength="200"></label>` : ''}
      ${c.phone !== 'off' ? html`<label class="field">Phone${mark(c.phone)}<input type="tel" name="phone" autocomplete="tel" maxlength="40"></label>` : ''}
    </div>
    ${f.questions.map(field)}
    <input class="m-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn primary" style="width:100%;min-height:48px;justify-content:center">Send</button>
  </form>`);
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const missing = [];
    for (const [key, label] of [['name', 'your name'], ['email', 'your email'], ['phone', 'your phone number']]) {
      if (c[key] === 'required' && !form.elements[key].value.trim()) missing.push([form.elements[key], `Please enter ${label}.`]);
    }
    for (const q of f.questions) {
      if (!q.required) continue;
      const ctl = form.querySelector(`[name="q_${q.id}"]`);
      const done = q.type === 'multichoice' || q.type === 'yesno' ? form.querySelector(`[name="q_${q.id}"]:checked`) : form.elements[`q_${q.id}`].value.trim();
      if (!done) missing.push([ctl, q.type === 'choice' || q.type === 'multichoice' || q.type === 'yesno' ? 'Please choose an answer.' : 'Please answer this question.']);
    }
    if (missing.length) { missing.forEach(([ctl, msg], i) => fieldError(ctl, msg, { focus: i === 0 })); return; }
    const answers = Object.fromEntries(f.questions.map((q) => [q.id,
      q.type === 'multichoice' ? [...form.querySelectorAll(`[name="q_${q.id}"]:checked`)].map((x) => x.value)
        : q.type === 'yesno' ? form.querySelector(`[name="q_${q.id}"]:checked`)?.value || '' : form.elements[`q_${q.id}`].value]));
    const go = form.querySelector('.btn.primary');
    go.disabled = true;
    try {
      await post(`/public/forms/${encodeURIComponent(f.slug)}`, { name: form.elements.name?.value, email: form.elements.email?.value, phone: form.elements.phone?.value, website: form.elements.website.value, answers });
      mount(el, html`<div class="card m-big-action">${icon('check')}<h2 style="margin:0">Thank you!</h2><p class="muted" style="margin:0">We got your response, and someone from ${app.church_name} will be in touch if needed.</p><a class="btn" href="#/">Back home</a></div>`);
    } catch (err) { go.disabled = false; formError(form, err.message || String(err), go); }
  };
}
