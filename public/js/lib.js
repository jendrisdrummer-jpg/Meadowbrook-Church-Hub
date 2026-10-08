// Shared browser helpers: API calls, safe HTML templates, dialogs, toasts, formatting.

export async function api(method, url, body) {
  const opts = { method, headers: { 'x-mb': '1' } };
  if (body instanceof Blob) {
    opts.body = body;
    opts.headers['content-type'] = body.type;
  } else if (typeof body === 'string') {
    opts.body = body;
    opts.headers['content-type'] = 'text/plain';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['content-type'] = 'application/json';
  }
  const res = await fetch('/api' + url, opts);
  if (res.status === 401 && !url.startsWith('/me')) {
    location.href = '/login';
    throw new Error('Please sign in.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
export const get = (url) => api('GET', url);
export const post = (url, body) => api('POST', url, body ?? {});
export const patch = (url, body) => api('PATCH', url, body);
export const put = (url, body) => api('PUT', url, body);
export const del = (url, body) => api('DELETE', url, body);

// ---------------------------------------------------------------- safe HTML
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

// Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v == null) return '';
  return esc(v);
}

export function mount(el, content) {
  el.innerHTML = render(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- icons (inline SVG, Lucide-style)
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.7-.3 4.8 1.4 5.5 4.4"/>',
  teams: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkin: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  wand: '<path d="m4 20 11-11M15 4v2M19 8h2M18 4l-1.5 1.5M14 9l1 1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>',
  printer: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export function icon(name, cls = 'ic') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`);
}

// ---------------------------------------------------------------- people helpers
export const displayName = (p) => `${p.nickname || p.first_name || ''} ${p.last_name || ''}`.trim();
export function avatar(p, cls = '') {
  const initials = `${(p.nickname || p.first_name || '?')[0]}${(p.last_name || '')[0] || ''}`.toUpperCase();
  return p.photo
    ? html`<span class="avatar ${cls}"><img src="${p.photo}" alt="" loading="lazy"></span>`
    : html`<span class="avatar ${cls}">${initials}</span>`;
}

// ---------------------------------------------------------------- dates
// Services store campus-local "YYYY-MM-DDTHH:MM"; format them without time-zone shifts.
const asLocal = (s) => new Date(`${s.length === 10 ? `${s}T12:00` : s}:00`);
export const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => (s ? asLocal(s).toLocaleDateString(undefined, opts) : '');
export const fmtTime = (s) => (s ? asLocal(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
export const fmtDateTime = (s) => `${fmtDate(s)} · ${fmtTime(s)}`;
export const today = () => new Date().toLocaleDateString('en-CA');
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const fmtLength = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
export function parseLength(s) {
  s = String(s || '').trim();
  if (!s) return 0;
  const m = s.match(/^(\d+)(?::(\d{1,2}))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0;
}
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------- toasts
export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3000);
}
export const fail = (e) => toast(e.message || String(e), 'bad');

// ---------------------------------------------------------------- dialogs
// Opens a dialog. `body` is html``; `onSubmit(form, dialog)` may return false to keep it open.
export function dialog({ title, body, submit = 'Save', cancel = 'Cancel', danger = false, onSubmit, wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    if (wide) d.style.width = 'min(820px, calc(100vw - 24px))';
    mount(d, html`<form method="dialog">
      <div class="dlg-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="dlg-body">${body}</div>
      ${submit || cancel ? html`<div class="dlg-foot">
        ${cancel ? html`<button type="button" class="btn" data-close>${cancel}</button>` : ''}
        ${submit ? html`<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submit}</button>` : ''}
      </div>` : ''}
    </form>`);
    document.body.append(d);
    const form = $('form', d);
    let result;
    const close = (v) => { result = v; d.close(); };
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => close(undefined)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', d);
      if (btn) btn.disabled = true;
      try {
        const out = onSubmit ? await onSubmit(form, d) : true;
        if (out !== false) close(out ?? true);
      } catch (err) {
        fail(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    d.showModal();
    onOpen?.(d, close);
    $('input:not([type=hidden]), select, textarea', d)?.focus();
  });
}

export const confirm = (title, message, submit = 'Delete') => dialog({ title, body: html`<p>${message}</p>`, submit, danger: true });

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value;
  }
  return out;
}

export const options = (list, selected, { blank } = {}) => html`${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${list.map((o) => html`<option value="${o.value}" ${String(o.value) === String(selected ?? '') ? raw('selected') : ''}>${o.label}</option>`)}`;

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Search-as-you-type person picker. Resolves to the chosen person or undefined.
export function pickPerson(title = 'Choose a person', { filter } = {}) {
  let chosen;
  return dialog({
    title,
    submit: null,
    body: html`<input type="search" placeholder="Search by name, email or phone" data-q><div class="picker-list" data-list><div class="muted small">Start typing…</div></div>`,
    onOpen: (d, close) => {
      const list = $('[data-list]', d);
      let rows = [];
      const run = debounce(async (q) => {
        if (q.trim().length < 2) return;
        rows = (await get(`/people?q=${encodeURIComponent(q)}&limit=25`)).rows.filter((p) => !filter || filter(p));
        mount(list, rows.length ? rows.map((p, i) => html`<button type="button" data-i="${i}">${avatar(p)}<span>${displayName(p)}<br><small class="muted">${p.email || p.phone || p.household_name || ''}</small></span></button>`) : html`<div class="muted small">No one found.</div>`);
      });
      $('[data-q]', d).addEventListener('input', (e) => run(e.target.value));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]');
        if (b) { chosen = rows[b.dataset.i]; close(chosen); }
      });
    },
  }).then(() => chosen);
}

// Resizes an image file in the browser before upload (photos from phones are huge).
export function shrinkImage(file, max = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))), 'image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}
