// One task (or a new one).
import { taskPage } from '../tasks.js';
import { setTitle, hashQuery, refreshBadges, state } from '../app.js';

export default function task(el, id) {
  return taskPage(el, id, { setTitle, q: hashQuery(), me: state.me.personId ?? null, onChange: refreshBadges });
}
