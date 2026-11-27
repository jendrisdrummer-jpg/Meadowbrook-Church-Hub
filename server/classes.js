// Classes: the rules that don't need a request, kept pure so they can be tested with fixed dates.
// Defaults live here once; a church can override them in settings (key "classes").
import { getSetting } from './db.js';
import { bad, localNow } from './http.js';
import { churchTz } from './media.js';

export const DEFAULTS = {
  pass_pct: 80, // a quiz is passed at this score
  watch_pct: 90, // a video counts as watched at this share of its length
  quiz_attempts_per_hour: 20,
};
export const classSettings = (db) => ({ ...DEFAULTS, ...getSetting(db, 'classes', {}) });

export const MAX_QUESTIONS = 30;

// The church's date for a class (its campus's time zone, or the first campus's), from the injected clock.
export function classToday(db, cls, now) {
  const tz = (cls.campus_id && db.prepare('SELECT timezone FROM campuses WHERE id = ?').get(cls.campus_id)?.timezone) || churchTz(db);
  return localNow(tz, now()).date;
}

export const parseList = (text) => { try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

// Staff typed these in the quiz builder. Returns a clean list or throws a plain message.
export function cleanQuestions(input, { min = 0 } = {}) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_QUESTIONS) throw bad(`A quiz can have up to ${MAX_QUESTIONS} questions.`);
  const seen = new Set();
  const out = list.map((q, i) => {
    const text = String(q?.text ?? '').trim().slice(0, 300);
    if (!text) throw bad(`Question ${i + 1} needs some words.`);
    const choices = (Array.isArray(q?.choices) ? q.choices : []).map((c) => String(c ?? '').trim().slice(0, 150));
    if (choices.length < 2 || choices.length > 6 || choices.some((c) => !c)) throw bad(`Question ${i + 1} needs between 2 and 6 answers, none left empty.`);
    const correct = [...new Set((Array.isArray(q?.correct) ? q.correct : []).map(Number))].sort((a, b) => a - b);
    if (!correct.length || correct.some((c) => !Number.isInteger(c) || c < 0 || c >= choices.length)) throw bad(`Question ${i + 1}: mark which answer is right.`);
    let id = /^[\w-]{1,20}$/.test(String(q?.id ?? '')) ? String(q.id) : `q${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    return { id, text, choices, correct };
  });
  if (out.length < min) throw bad('Add at least one question.');
  return out;
}

// What a member (or class manager) may see of a quiz: never which answers are right.
export const forMember = (questions) => parseList(questions).map((q) => ({ id: q.id, text: q.text, choices: q.choices, multi: (q.correct || []).length > 1 }));

// Marks answers: { questionId: [choice numbers] }. Reports which questions to look at again by number only.
export function grade(questions, answers, passPct = DEFAULTS.pass_pct) {
  const qs = parseList(questions);
  const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const review = [];
  qs.forEach((q, i) => {
    const a = given[q.id];
    const picked = [...new Set((Array.isArray(a) ? a : a === undefined || a === null ? [] : [a]).map(Number))].filter((n) => Number.isInteger(n)).sort((x, y) => x - y);
    const want = [...(q.correct || [])].sort((x, y) => x - y);
    if (picked.length !== want.length || picked.some((n, k) => n !== want[k])) review.push(i + 1);
  });
  const score = qs.length ? Math.round((100 * (qs.length - review.length)) / qs.length) : 0;
  return { score, passed: qs.length > 0 && score >= passPct, review };
}

// Is a session's make-up open for this person? Only after they were marked absent, or the session
// date has passed without them being marked present. `row` is their progress row for the step.
export const hasMakeup = (step) => Boolean(step.makeup_video_id) || parseList(step.makeup_questions).length > 0;
export function makeupOpen(step, row, today) {
  if (step.kind !== 'session' || !hasMakeup(step)) return false;
  if (row && row.state === 'done' && (row.method === 'attended' || row.method === 'manual')) return false;
  if (row && (row.method === 'absent' || row.method === 'makeup')) return true;
  return Boolean(step.starts_on && step.starts_on < today);
}

// The video behind a step (a video step, or a session's make-up) and the test that goes with it.
export function partsOf(step) {
  const make = step.kind === 'session';
  return {
    videoId: make ? step.makeup_video_id : step.video_id,
    videoSec: make ? step.makeup_video_sec : step.video_sec,
    videoTitle: make ? step.makeup_video_title : step.video_title,
    questions: parseList(make ? step.makeup_questions : step.questions),
  };
}

// Is the step finished, from what's recorded? (Attendance and manual marks decide on their own.)
export function stepSatisfied(step, row) {
  const p = partsOf(step);
  if (step.kind === 'video') return Boolean(row.watched);
  if (step.kind === 'quiz') return Boolean(row.passed);
  if (!hasMakeup(step)) return false;
  return (!p.videoId || Boolean(row.watched)) && (!p.questions.length || Boolean(row.passed));
}

// One progress ping from the player. Returns what to store. The length is the one we know from
// YouTube; if we don't know it, the player's own is used (never lowered once seen). The furthest
// point only moves as fast as time passes (twice real time, plus a little), so skipping ahead
// can't finish a video. "Ended" counts only from near the end after about half was really watched.
export function applyPing(row, { position, reported, ended }, knownSec, nowMs, watchPct = DEFAULTS.watch_pct) {
  const rep = Number.isFinite(Number(reported)) && Number(reported) >= 60 && Number(reported) <= 6 * 3600 ? Math.round(Number(reported)) : 0;
  const duration = knownSec || Math.max(row.duration_sec || 0, rep) || null;
  if (!duration) return null;
  const pos = Math.min(duration, Math.max(0, Math.round(Number(position) || 0)));
  const last = row.last_ping_at ? Date.parse(row.last_ping_at) : NaN;
  const elapsed = Number.isFinite(last) ? Math.max(0, (nowMs - last) / 1000) : 0;
  // The extra allowance grows with time too, so a burst of pings in one moment adds nothing.
  const max = Math.max(row.max_sec || 0, Math.min(pos, (row.max_sec || 0) + 2 * elapsed + Math.min(10, elapsed)));
  const near = pos >= duration - Math.max(5, duration * 0.03);
  const watched = Boolean(row.watched) || max >= (watchPct / 100) * duration || (Boolean(ended) && near && max >= duration * 0.5);
  return { duration, position: pos, max: Math.min(duration, Math.round(max)), watched };
}

// A YouTube link or id → the 11-character id, or null.
export const youtubeId = (input) => {
  const s = String(input ?? '').trim();
  return (/(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})(?![\w-])/.exec(s) || /^([\w-]{11})$/.exec(s) || [])[1] || null;
};
