// My classes in the member app: the steps of a class in order, the video player (YouTube, with
// progress reported as it plays), quizzes, and the make-up for a session someone missed.
import { get, post, html, mount, icon, fail, fmtDate } from '../lib.js';
import { mountPlayer } from '../video.js';

const KIND_ICON = { session: 'calendar', video: 'play', quiz: 'check' };

// What a step says about itself, in plain words.
const stateWords = (s) => ({
  done: 'Done',
  makeup: 'Make-up ready',
  absent: 'Your leader will be in touch',
  missed: 'Your leader will be in touch',
  upcoming: s.starts_on ? `Coming up · ${fmtDate(s.starts_on, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Coming up',
  started: 'Started',
  todo: 'To do',
}[s.state] || '');

export async function myClassesList(el, { setTitle }) {
  setTitle('My classes');
  const list = await get('/me/classes');
  mount(el, list.length ? html`<div class="card m-list">${list.map((c) => html`<a href="#/classes/${c.id}">${icon('book')}<span class="grow"><b>${c.title}</b><br>
      <span class="muted small">${c.completed_at ? 'Finished' : `${c.done} of ${c.total} steps done`}</span>${c.total && !c.completed_at ? html`<span class="meter"><span style="width:${Math.round((100 * c.done) / c.total)}%"></span></span>` : ''}</span>${c.completed_at ? html`<span class="pill good">${icon('check')} Finished</span>` : ''}</a>`)}</div>`
    : html`<div class="m-empty">${icon('book')}<p>You aren’t in any classes yet. When someone adds you, they’ll show here.</p></div>`);
}

const gone = (el) => mount(el, html`<div class="m-empty">${icon('book')}<p>We couldn’t find that class. It may not be one you’re in.</p><a class="btn" href="#/classes">My classes</a></div>`);

export async function classPage(el, id, { setTitle }) {
  let c;
  try { c = await get(`/me/classes/${id}`); } catch { return gone(el); }
  setTitle(c.title);
  const done = c.steps.filter((s) => s.state === 'done').length;
  mount(el, html`<div class="card stack">${c.description ? html`<p style="margin:0;white-space:pre-line">${c.description}</p>` : ''}
      ${c.completed_at ? html`<div class="alert good">${icon('check')} You finished this class. Thank you!</div>`
        : html`<div><b>${done} of ${c.steps.length} steps done</b><div class="meter"><span style="width:${c.steps.length ? Math.round((100 * done) / c.steps.length) : 0}%"></span></div></div>`}</div>
    <div class="card m-list">${c.steps.map((s) => html`<a href="#/classes/${id}/${s.id}">${icon(s.state === 'done' ? 'check' : KIND_ICON[s.kind])}<span class="grow"><b>${s.title}</b><br><span class="muted small">${stateWords(s)}</span></span>
      ${s.state === 'makeup' ? html`<span class="pill warn">Make-up</span>` : s.state === 'done' ? html`<span class="pill good">Done</span>` : ''}</a>`)}</div>`);
}

let player = null;
let timer = null;
const stopPlayer = () => { clearInterval(timer); timer = null; player?.destroy(); player = null; };
window.addEventListener('hashchange', stopPlayer);

export async function stepPage(el, classId, stepId, { setTitle }) {
  stopPlayer();
  let s;
  try { s = await get(`/me/classes/${classId}/steps/${stepId}`); } catch { return gone(el); }
  setTitle(s.title);
  const note = s.kind === 'session' ? sessionNote(s) : '';
  mount(el, html`<div class="card stack">
      ${s.body ? html`<p style="margin:0;white-space:pre-line">${s.body}</p>` : ''}${note}
      ${s.state === 'done' ? html`<div class="alert good">${icon('check')} This step is done.</div>` : ''}
      ${s.video ? html`<div class="m-video" data-video></div><p class="muted small" data-video-note style="margin:0">${s.video.watched ? 'You’ve watched this.' : 'Watch it through to the end. We’ll remember where you got to.'}</p>` : ''}
    </div>
    ${s.quiz ? html`<form class="card stack" data-quiz novalidate>
      <h2 style="margin:0">${s.kind === 'session' ? 'Make-up test' : 'Quiz'}</h2>
      <p class="muted small" style="margin:0">Choose your answers, then tap Check. You need ${s.quiz.pass_pct}% to pass, and you can try as many times as you like.</p>
      ${s.quiz.questions.map((q, i) => html`<fieldset class="q" data-qid="${q.id}"><legend><b>${i + 1}. ${q.text}</b>${q.multi ? html` <span class="muted small">(choose all that apply)</span>` : ''}</legend>
        ${q.choices.map((ch, k) => html`<label class="check q-opt"><input type="${q.multi ? 'checkbox' : 'radio'}" name="q_${q.id}" value="${k}"> <span>${ch}</span></label>`)}</fieldset>`)}
      <div data-result></div>
      <button class="btn primary" style="width:100%;min-height:48px;justify-content:center" data-check>Check my answers</button></form>` : ''}`);
  if (s.video && !s.closed) startVideo(el, classId, s);
  const form = el.querySelector('[data-quiz]');
  if (form && !s.closed) form.onsubmit = (e) => { e.preventDefault(); check(el, form, classId, s); };
}

function sessionNote(s) {
  const when = s.starts_on ? fmtDate(s.starts_on, { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  if (s.state === 'done') return '';
  if (s.makeup.open) return html`<div class="alert">${icon('info')} <span>We missed you${when ? ` on ${when}` : ''}. <b>Watch the recording and take the test</b> to catch up.</span></div>`;
  if (s.state === 'upcoming') return html`<p style="margin:0"><b>${when ? `We’ll see you on ${when}.` : 'We’ll see you there.'}</b> Nothing to do here until then.</p>`;
  return html`<p style="margin:0">We missed you${when ? ` on ${when}` : ''}. Your leader will be in touch about how to catch up.</p>`;
}

// The player reports where it is every 15 seconds and when it ends; the server decides what counts.
async function startVideo(el, classId, s) {
  const box = el.querySelector('[data-video]');
  const note = el.querySelector('[data-video-note]');
  let last = -1;
  const ping = async (ended) => {
    const t = player?.time();
    if (t == null || (!ended && Math.floor(t) === last)) return;
    last = Math.floor(t);
    try {
      const r = await post(`/me/classes/${classId}/steps/${s.id}/progress`, { position: last, duration: Math.round(player.duration() || 0) || undefined, ended: Boolean(ended) });
      if (r.watched && note) note.textContent = 'You’ve watched this.';
      if (r.done) { stopPlayer(); mount(el.querySelector('.card'), html`<div class="alert good">${icon('check')} This step is done. Well done!</div>`); }
    } catch { /* a missed report is fine; the next one carries on */ }
  };
  player = await mountPlayer(box, { videoId: s.video.id, start: s.video.position || 0, onEnd: () => ping(true) });
  if (player.time() === null && !s.video.watched) note.textContent = 'The video player didn’t load. Please check your connection and try again.';
  timer = setInterval(() => { if (!document.hidden) ping(false); }, 15000);
}

async function check(el, form, classId, s) {
  const answers = {};
  for (const q of s.quiz.questions) answers[q.id] = [...form.querySelectorAll(`[name="q_${q.id}"]:checked`)].map((x) => Number(x.value));
  const btn = form.querySelector('[data-check]');
  btn.disabled = true;
  const out = form.querySelector('[data-result]');
  try {
    const r = await post(`/me/classes/${classId}/steps/${s.id}/quiz`, { answers });
    if (r.passed) {
      mount(out, html`<div class="alert good" role="status">${icon('check')} <span><b>Passed!</b> You got ${r.score}%.${r.done ? ' This step is done.' : s.kind === 'session' && s.video && !s.video.watched ? ' Now watch the recording to finish.' : ''}</span></div>`);
      btn.textContent = 'Passed';
    } else {
      mount(out, html`<div class="alert" role="status"><span><b>Not quite — try again.</b> You got ${r.score}%. Have another look at question${r.review.length === 1 ? '' : 's'} ${r.review.join(', ')}.</span></div>`);
      btn.disabled = false;
      btn.textContent = 'Check my answers again';
    }
  } catch (err) { btn.disabled = false; fail(err); }
}
