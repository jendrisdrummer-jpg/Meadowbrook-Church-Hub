// Questions a church asks on a form (event sign-ups, Forms): the shape staff save and the
// checking of what people answer. Shared so every form behaves the same way.
// A question: { id, label, type, options?, required }.
import { bad, str, required, oneOf, isDate } from './http.js';

export const EVENT_TYPES = ['text', 'choice', 'yesno'];
export const FORM_TYPES = ['text', 'longtext', 'choice', 'multichoice', 'yesno', 'date'];
const RESERVED = ['__proto__', 'constructor', 'prototype'];
const HAS_OPTIONS = ['choice', 'multichoice'];

// Cleans the list staff send; returns plain objects ready to store as JSON.
export function cleanQuestions(list, types, max = 12) {
  if (!Array.isArray(list)) throw bad('Questions must be a list.');
  const out = list.slice(0, max).map((q, i) => {
    const type = oneOf(q.type, types, 'text');
    let id = str(q.id, 20).replace(/[^\w-]/g, '') || `q${i + 1}`;
    if (RESERVED.includes(id)) id = `q${i + 1}`; // would read inherited object properties
    const clean = { id, label: required(q.label, 'Question').slice(0, 200), type, required: Boolean(q.required) };
    if (HAS_OPTIONS.includes(type)) {
      clean.options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => str(o, 80)).filter(Boolean))].slice(0, 20);
      if (!clean.options.length) throw bad(`Add choices for “${clean.label}”.`);
    }
    return clean;
  });
  if (new Set(out.map((q) => q.id)).size !== out.length) throw bad('Two questions have the same id.');
  return out;
}

// Checks what someone answered against the questions; returns { [question id]: value } with only
// answered questions. Values are strings (multichoice: a list of strings).
export function cleanAnswers(questions, given) {
  const out = {};
  for (const q of questions) {
    let v = Object.hasOwn(given, q.id) ? given[q.id] : undefined;
    if (q.type === 'multichoice') {
      v = [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 80)).filter(Boolean))];
      if (v.some((x) => !q.options.includes(x))) throw bad(`Pick only from the choices for “${q.label}”.`);
      if (q.required && !v.length) throw bad(`Please answer “${q.label}”.`);
      if (v.length) out[q.id] = v;
      continue;
    }
    if (q.type === 'yesno') v = v === true || v === 'yes' ? 'Yes' : v === false || v === 'no' ? 'No' : '';
    else v = str(v, q.type === 'longtext' ? 4000 : 1000);
    if (q.type === 'choice' && v && !q.options.includes(v)) throw bad(`Pick one of the choices for “${q.label}”.`);
    if (q.type === 'date' && v && !isDate(v)) throw bad(`Please pick a date for “${q.label}”.`);
    if (q.required && !v) throw bad(`Please answer “${q.label}”.`);
    if (v) out[q.id] = v;
  }
  return out;
}

// How an answer reads in a list or a spreadsheet.
export const answerText = (v) => (Array.isArray(v) ? v.join('; ') : v ?? '');
