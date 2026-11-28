// More → My info: a member updates their own phone and birthday (and, for adults, the household's
// home address), which save straight to People. Email and family changes go to the office through "Tell the office".
import { get, patch, post, html, mount, icon, toast, fieldError, clearFieldErrors, formError } from '../lib.js';

const FIELDS = [['phone', /phone/i], ['birthdate', /birth/i], ['address', /address|street/i], ['city', /city/i], ['state', /state/i], ['zip', /zip/i]];
const TOPICS = { email: 'Change my email', family: 'Update family details', other: 'Something else' };

export async function myInfoPage(el, { app, setTitle, signInHref }) {
  setTitle('My info');
  if (!app.user) return mount(el, html`<div class="card m-big-action">${icon('lock')}<h2 style="margin:0">Sign in to see your info</h2><a class="btn primary" href="${signInHref('/my-info')}">Sign in</a></div>`);
  let me;
  try { me = await get('/me/person'); } catch (e) {
    // Only an account that isn't linked yet asks the office to link it; anything else shows the server's message.
    if (app.user.linked !== false || (e.status !== 409 && !/connected|link/i.test(e.message))) return mount(el, html`<div class="alert bad">${e.message}</div>`);
    post('/me/link-request', {}).catch(() => {});
    return mount(el, html`<div class="card"><p>You’re signed in as <b>${app.user.name}</b>. Your account isn’t connected to your record in the church directory yet.</p>
      <p>We’ve let the church office know. They’ll connect it, and then you can update your info here. There’s nothing else you need to do.</p></div>`);
  }
  const draw = () => mount(el, html`<form class="card m-form" data-info novalidate>
      <h2 style="margin-top:0" tabindex="-1" data-info-title>${me.first_name} ${me.last_name}</h2>
      <p class="muted small" style="margin-top:0">Changes here save straight to your record at ${app.church_name}.</p>
      <div class="form">
        <label class="field">Phone<input type="tel" name="phone" autocomplete="tel" maxlength="40" value="${me.phone}"></label>
        ${me.can_edit_birthdate ? html`<label class="field">Birthday<input type="date" name="birthdate" max="${new Date().toLocaleDateString('en-CA')}" value="${me.birthdate || ''}"></label>` : ''}
      </div>
      <button class="btn primary" style="width:100%;min-height:48px;justify-content:center">Save</button>
    </form>
    ${me.can_edit_address ? html`<form class="card m-form" data-address novalidate>
      <h2 style="margin-top:0">Home address</h2>
      <p class="muted small" style="margin-top:0">This is your household’s address, so changing it updates it for everyone in your family.</p>
      <div class="form">
        <label class="field">Street<input name="address" autocomplete="street-address" maxlength="200" value="${me.home.address}"></label>
        <label class="field">City<input name="city" autocomplete="address-level2" maxlength="100" value="${me.home.city}"></label>
        <div class="row" style="gap:10px">
          <label class="field grow">State<input name="state" autocomplete="address-level1" maxlength="50" value="${me.home.state}"></label>
          <label class="field grow">Zip<input name="zip" autocomplete="postal-code" inputmode="numeric" maxlength="20" value="${me.home.zip}"></label>
        </div>
      </div>
      <button class="btn primary" style="width:100%;min-height:48px;justify-content:center">Save address</button>
    </form>` : ''}
    <div class="card">
      <h2 style="margin-top:0">Handled by the office</h2>
      <div class="row small"><span class="muted">Email</span><span class="spacer"></span><span style="overflow-wrap:anywhere;min-width:0;text-align:right">${me.email || 'None on file'}</span></div>
      ${me.can_edit_address ? '' : html`<div class="row small"><span class="muted">Address</span><span class="spacer"></span><span style="text-align:right">${me.address || 'None on file'}</span></div>`}
      <p class="muted small" style="margin-bottom:0">Your email is how you sign in, so the office changes it. ${me.can_edit_address ? 'For family details, ask the office to update them.' : 'Your address is shared with your household, so an adult in it or the office changes it. For family details, ask the office.'}</p>
    </div>
    <form class="card m-form" data-office novalidate>
      <h2 style="margin-top:0">Tell the office</h2>
      <p class="muted small" style="margin-top:0">Need to change your email or address, or update family details? Let us know and someone will take care of it.</p>
      <div class="form">
        <label class="field">What’s this about?<select name="topic">${Object.entries(TOPICS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
        <label class="field">Message<textarea name="message" rows="4" maxlength="1000" placeholder="For example: my new email is…"></textarea></label>
      </div>
      <button class="btn" style="width:100%;min-height:48px;justify-content:center">${icon('send')} Send to the office</button>
    </form>`);
  draw();
  el.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const go = form.querySelector('button');
    clearFieldErrors(form);
    go.disabled = true;
    try {
      if (form.matches('[data-info]')) {
        const phone = form.elements.phone;
        if (phone.value.trim() && phone.value.replace(/\D/g, '').length < 7) { go.disabled = false; fieldError(phone, 'That phone number doesn’t look right. For example: 555-123-4567.'); return; }
        me = await patch('/me/person', { phone: form.elements.phone.value, ...(form.elements.birthdate ? { birthdate: form.elements.birthdate.value } : {}) });
        toast('Saved. Thank you!');
        draw();
        el.querySelector('[data-info-title]')?.focus({ preventScroll: true });
      } else if (form.matches('[data-address]')) {
        const f = form.elements;
        me = await patch('/me/address', { address: f.address.value, city: f.city.value, state: f.state.value, zip: f.zip.value });
        toast('Address saved for your household.');
        draw();
        el.querySelector('[data-info-title]')?.focus({ preventScroll: true });
      } else {
        const message = form.elements.message.value.trim();
        if (!message) { go.disabled = false; fieldError(form.elements.message, 'Please add a short message first.'); return; }
        await post('/me/office-request', { topic: form.elements.topic.value, message });
        toast('Sent. The office will be in touch.');
        draw();
      }
    } catch (err) { go.disabled = false; formError(form, err.message || String(err), go, FIELDS); }
  };
}
