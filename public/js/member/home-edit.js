// Editing the home screen inside the App Builder's phone preview: tap a widget to pick it, drag
// it to move it, drag its corner to resize it. Changes go back to the App Builder page, which
// holds the unsaved layout and redraws the preview.
import { WIDGETS, SIZES } from '../app-widgets.js';

const send = (msg) => parent.postMessage(msg, location.origin);

// The allowed size closest to a dragged-out width × height (in grid cells).
function nearestSize(type, w, h) {
  const score = (k) => {
    const s = SIZES[k];
    const sh = s.h || 3; // "Full" counts as taller than any fixed size
    return Math.abs(s.w - w) * 2 + Math.abs(sh - h);
  };
  return [...WIDGETS[type].sizes].sort((a, b) => score(a) - score(b))[0];
}

export function editHome(grid, home, selected) {
  const byId = (id) => home.find((w) => w.id === id);
  const order = () => [...grid.querySelectorAll('[data-wid]')].map((el) => el.dataset.wid);
  grid.querySelectorAll('[data-wid]').forEach((el) => {
    el.classList.toggle('selected', el.dataset.wid === selected);
    if (WIDGETS[byId(el.dataset.wid)?.type]?.sizes.length > 1) el.insertAdjacentHTML('beforeend', '<span class="w-resize" aria-hidden="true"></span>');
  });
  // Nothing in the preview navigates while editing.
  grid.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }, true);

  let drag = null;
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-wid]');
    if (!el || e.button > 0) return;
    e.preventDefault();
    const resizing = e.target.classList.contains('w-resize');
    drag = { el, id: el.dataset.wid, x: e.clientX, y: e.clientY, moved: false, resizing, rect: el.getBoundingClientRect(), size: byId(el.dataset.wid)?.size };
    el.setPointerCapture(e.pointerId);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add(drag.resizing ? 'resizing' : 'dragging');
      grid.classList.add('busy');
    }
    if (drag.resizing) {
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.columnGap) || 12;
      const col = (grid.clientWidth - gap * 3) / 4;
      const w = Math.max(1, Math.min(4, Math.round((drag.rect.width + dx + gap) / (col + gap))));
      const h = Math.max(1, Math.round((drag.rect.height + dy + gap) / (col + gap)));
      const size = nearestSize(byId(drag.id).type, w, h);
      if (size !== drag.size) {
        drag.size = size;
        const s = SIZES[size];
        drag.el.className = drag.el.className.replace(/\bsz-\w\b/, `sz-${size}`);
        drag.el.style.gridColumn = `span ${s.w}`;
        drag.el.style.gridRow = s.h ? `span ${s.h}` : '';
        drag.el.dataset.size = SIZES[size].label;
      }
      return;
    }
    // Moving: the widget slots in before or after whichever one is under the finger.
    drag.el.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-wid]');
    drag.el.style.pointerEvents = '';
    if (!under || under === drag.el || !grid.contains(under)) return;
    const r = under.getBoundingClientRect();
    const after = (e.clientY - r.top) / r.height > 0.5 || ((e.clientX - r.left) / r.width > 0.5 && r.width < grid.clientWidth * 0.9);
    grid.insertBefore(drag.el, after ? under.nextSibling : under);
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    grid.classList.remove('busy');
    d.el.classList.remove('dragging', 'resizing');
    if (!d.moved) return send({ type: 'app-select', id: d.id });
    if (d.resizing) {
      const next = home.map((w) => (w.id === d.id ? { ...w, size: d.size } : w));
      return send({ type: 'app-home', home: next, select: d.id });
    }
    // Widgets hidden in the preview keep their place after the one before them.
    const shown = order();
    const hidden = home.filter((w) => !shown.includes(w.id));
    const next = shown.map(byId);
    for (const w of hidden) {
      const before = home[home.indexOf(w) - 1];
      next.splice(before ? next.indexOf(before) + 1 : 0, 0, w);
    }
    send({ type: 'app-home', home: next, select: d.id });
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
}
