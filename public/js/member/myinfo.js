// More → My info: a member updates their own phone and birthday, which save straight to their
// record in People. Email and family changes go to the office through "Tell the office".
import { get, patch, post, html, mount, icon, toast, fail } from '../lib.js';

const TOPICS = { email: 'Change my email', family: 'Update family details', other: 'Something else' };

export async function myInfoPage(el, { app, setTitle, signInHref }) {
  setTitle('My info');
  if (!app.user) return mount(el, html`<div class="card m-big-action">${icon('lock')}<h2 style="margin:0">Sign in to see your info</h2><a class="btn primary" href="${signInHref('/my-info')}">Sign in</a></div>`);
  let me;
  try { me = await get('/me/person'); } catch (e) {
    if (e.status !== 409 && !/connected|link/i.test(e.message)) return mount(el, html`<div class="alert bad">${e.message}</div>`);
    post('/me/link-request', {}).catch(() => {});
    return mount(el, html`<div class="card"><p>You’re signed in as <b>${app.user.name}</b>. Your account isn’t connected to your record in the church directory yet.</p>
      <p>We’ve let the church office know. They’ll connect it, and then you can update your info here. There’s nothing else you need to do.</p></div>`);
  }
  const draw = () => mount(el, html`<form class="card m-form" data-info novalidate>
      <h2 style="margin-top:0">${me.first_name} ${me.last_name}</h2>
      <p class="muted small" style="margin-top:0">Changes here save straight to your record at ${app.church_name}.</p>
      <div class="form">
        <label class="field">Phone<input type="tel" name="phone" autocomplete="tel" maxlength="40" value="${me.phone}"></label>
        <label class="field">Birthday<input type="date" name="birthdate" max="${new Date().toLocaleDateString('en-CA')}" value="${me.birthdate || ''}"></label>
      </div>
      <button class="btn primary" style="width:100%;min-height:48px;justify-content:center">Save</button>
    </form>
    <div class="card">
      <h2 style="margin-top:0">Handled by the office</h2>
      <div class="row small"><span class="muted">Email</span><span class="spacer"></span><span>${me.email || 'None on file'}</span></div>
      <div class="row small"><span class="muted">Address</span><span class="spacer"></span><span style="text-align:right">${me.address || 'None on file'}</span></div>
      <p class="muted small" style="margin-bottom:0">Your email is how you sign in, and your address is shared with your household, so the office makes those changes. For family details, ask the office to update them.</p>
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
    go.disabled = true;
    try {
      if (form.matches('[data-info]')) {
        me = await patch('/me/person', { phone: form.elements.phone.value, birthdate: form.elements.birthdate.value });
        toast('Saved. Thank you!');
        draw();
      } else {
        const message = form.elements.message.value.trim();
        if (!message) { go.disabled = false; return toast('Please add a short message first.', 'bad'); }
        await post('/me/office-request', { topic: form.elements.topic.value, message });
        toast('Sent. The office will be in touch.');
        draw();
      }
    } catch (err) { go.disabled = false; fail(err); }
  };
}
