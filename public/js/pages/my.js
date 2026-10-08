// My Schedule in the dashboard: the shared schedule view, plus notifications for this device.
import { html } from '../lib.js';
import { setTitle, hashQuery, state } from '../app.js';
import { drawSchedule } from '../myschedule.js';

export default async function my(el) {
  setTitle('My Schedule', html``);
  const decline = hashQuery().get('decline');
  if (decline) history.replaceState(null, '', '#/my');
  await drawSchedule(el, {
    planHref: (a) => `#/services/${a.service_id}`,
    decline,
    notifyCard: { ui: 'hub', role: state.me.role, appLink: state.settings.app_url?.startsWith('http') ? state.settings.app_url : new URL(state.settings.app_url || '/app/', location.origin).href },
  });
}
