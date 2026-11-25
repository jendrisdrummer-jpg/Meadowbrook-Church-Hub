// Help: short how-to guides for the things leaders and volunteers do most. Only the guides that
// match the signed-in person's role are shown. The words live in js/help-content.js (the member
// app's Help uses the same list).
import { html, mount } from '../lib.js';
import { setTitle, state } from '../app.js';
import { helpList } from '../help-content.js';

export default async function help(el) {
  setTitle('Help');
  mount(el, html`<div class="help-page">
    <p class="muted" style="margin-top:0">Quick steps for the things you’ll do most. Tap a heading to open it. Stuck? Ask the church office.</p>
    ${helpList('hub', state.me.role)}
  </div>`);
}
