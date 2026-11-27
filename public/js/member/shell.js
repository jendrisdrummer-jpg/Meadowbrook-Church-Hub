// Links inside the iPhone app (a Capacitor shell: a web view around this site). Outside the app nothing here runs.
// Why: the web view hands every target="_blank" link to Safari, and Safari isn't signed in, so a song sheet,
// chat picture or giving statement would say "sign in". So own-site file links open in a small viewer on top
// of the app (with a Back button) instead. Links to other sites still go to Safari, which is what people expect.
import { html, mount, icon } from '../lib.js';
import { inShell } from '../push.js';

let box = null;
const close = () => { box?.remove(); box = null; };

async function kindOf(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
    if (!r.ok) return { error: r.status === 401 || r.status === 403 ? 'Sign in again to open this file.' : 'This file couldn’t be opened.' };
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const attach = /^\s*attachment/i.test(r.headers.get('content-disposition') || '');
    if (type.startsWith('image/') && type !== 'image/heic') return { type: 'image' };
    if (type.startsWith('audio/')) return { type: 'audio' };
    if (!attach && (type === 'application/pdf' || type === 'text/html' || type === 'text/plain')) return { type: 'frame' };
    return { error: 'This kind of file can’t be shown in the app yet. Open the church website in Safari to download it.' };
  } catch { return { error: 'This file couldn’t be opened. Check your connection.' }; }
}

export async function openViewer(url, title = '') {
  close();
  box = document.createElement('div');
  box.className = 'file-viewer';
  mount(box, html`<div class="file-bar"><button type="button" class="btn small" data-back>${icon('back')} Back</button><b class="grow">${title}</b></div><div class="file-body muted" style="padding:18px">Opening…</div>`);
  box.querySelector('[data-back]').onclick = close;
  document.body.append(box);
  const k = await kindOf(url);
  if (!box) return;
  const body = box.querySelector('.file-body');
  body.classList.remove('muted');
  body.style.padding = '0';
  if (k.error) { body.style.padding = '18px'; mount(body, html`<p>${k.error}</p>`); }
  else if (k.type === 'image') mount(body, html`<img src="${url}" alt="${title}">`);
  else if (k.type === 'audio') { body.style.padding = '18px'; mount(body, html`<audio controls autoplay src="${url}" style="width:100%"></audio>`); }
  else mount(body, html`<iframe src="${url}" title="${title || 'File'}"></iframe>`);
}

// Same-site links that would open a new window (files and statements under /api/) open in the viewer.
export function wireShellLinks() {
  if (!inShell) return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[target="_blank"]');
    if (!a || e.defaultPrevented) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin) return; // other sites: left to the app, which opens Safari
    e.preventDefault();
    if (u.pathname.startsWith('/api/')) openViewer(u.pathname + u.search, (a.title || a.textContent || '').trim().slice(0, 60));
    else location.href = u.href; // another page on this site: open it in place (swipe back returns)
  }, true);
}
