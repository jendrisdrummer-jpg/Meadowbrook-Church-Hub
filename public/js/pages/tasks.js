// Tasks: mine, ones I gave out, and my teams'.
import { taskList } from '../tasks.js';
import { setTitle, hashQuery, refreshBadges } from '../app.js';

export default function tasks(el) {
  return taskList(el, { setTitle, q: hashQuery(), onChange: refreshBadges });
}
