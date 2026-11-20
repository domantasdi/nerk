/**
 * Everything the user does on the grid canvas:
 *  - draw / erase / fill / eyedropper (Alt+click picks with any tool)
 *  - two-finger pan + pinch zoom on touch screens (a second finger cancels the stroke)
 *  - middle-button drag to pan, Ctrl+wheel / trackpad pinch to zoom around the pointer
 *  - keyboard cursor (arrows, Space/Enter, Delete, F)
 */
import { line } from '../geometry';
import { EMPTY } from '../model';
import type { Store } from '../store';
import type { GridView } from '../view';

interface Opts {
  canvas: HTMLCanvasElement;
  wrap: HTMLElement;
  view: GridView;
  store: Store;
}
/** Cell under the pointer / keyboard cursor changed (-1 = none). */
type OnCell = (i: number, fromKeyboard: boolean) => void;

export function zoomAt(view: GridView, wrap: HTMLElement, clientX: number, clientY: number, cell: number) {
  const r = view.canvas.getBoundingClientRect(), g = view.gutter, c = view.cell;
  const fx = (clientX - r.left - g) / c, fy = (clientY - r.top - g) / c;
  view.setZoom(cell);
  view.draw(); // resize synchronously so the scroll correction below is exact
  const r2 = view.canvas.getBoundingClientRect();
  wrap.scrollLeft += r2.left + view.gutter + fx * view.cell - clientX;
  wrap.scrollTop += r2.top + view.gutter + fy * view.cell - clientY;
}

/** Zoom around the centre of the visible area (toolbar buttons, +/- keys). */
export function zoomCentre(view: GridView, wrap: HTMLElement, factor: number) {
  const r = wrap.getBoundingClientRect();
  zoomAt(view, wrap, r.left + r.width / 2, r.top + r.height / 2, view.cell * factor);
}

export function attachCanvasInput({ canvas, wrap, view, store }: Opts, onCell: OnCell) {
  const pointers = new Map<number, { x: number; y: number }>();
  let painting = false, last = -1, paintVal = 0;
  let pan: { x: number; y: number; sl: number; st: number } | null = null;
  let pinch: { dist: number; cell: number; mx: number; my: number } | null = null;

  const pickAt = (i: number) => {
    const v = store.doc.cells[i];
    if (v >= 0) store.select(v); // select() also switches back to the pen
  };
  const two = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);

    if (pointers.size === 2) { // second finger: this is a gesture, not a stroke
      if (painting) { store.cancelStroke(); painting = false; }
      pinch = { ...two(), cell: view.cell };
      return;
    }
    if (pointers.size > 2) return;

    if (e.button === 1) { // middle button: pan
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      canvas.classList.add('panning');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const i = view.cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    view.cursor = i;

    if (e.button === 0 && (e.altKey || store.tool === 'pick')) { pickAt(i); return; }
    paintVal = e.button === 2 || store.tool === 'erase' ? EMPTY : store.sel;
    if (store.tool === 'fill' && e.button === 0) { store.fillAt(i, paintVal); return; }
    painting = true;
    last = i;
    store.beginStroke();
    store.paint(i, paintVal);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const now = two();
      zoomAt(view, wrap, now.mx, now.my, pinch.cell * (now.dist / pinch.dist));
      wrap.scrollLeft -= now.mx - pinch.mx;
      wrap.scrollTop -= now.my - pinch.my;
      pinch.mx = now.mx;
      pinch.my = now.my;
      return;
    }
    if (pan) {
      wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
      wrap.scrollTop = pan.st - (e.clientY - pan.y);
      return;
    }
    const i = view.cellAt(e.clientX, e.clientY);
    if (i !== view.hover) { view.hover = i; view.invalidate(); onCell(i, false); }
    if (!painting || i < 0 || i === last) return;
    store.paintMany(last >= 0 ? line(last, i, store.doc.width) : [i], paintVal);
    last = i;
  });

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; } // don't resume drawing after a gesture
    if (pan) { pan = null; canvas.classList.remove('panning'); }
    if (painting) { painting = false; store.endStroke(); }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => {
    if (painting) { store.cancelStroke(); painting = false; }
    up(e);
  });
  canvas.addEventListener('pointerleave', () => {
    if (view.hover >= 0 && !painting) { view.hover = -1; view.invalidate(); onCell(-1, false); }
  });

  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the grid
    e.preventDefault();
    const f = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.01)));
    zoomAt(view, wrap, e.clientX, e.clientY, view.cell * f);
  }, { passive: false });

  /* ---------- keyboard cursor ---------- */
  const scrollIntoView = (i: number) => {
    const d = store.doc, r = canvas.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const x = r.left + view.gutter + (i % d.width) * view.cell, y = r.top + view.gutter + Math.floor(i / d.width) * view.cell, m = view.cell * 2;
    if (x < w.left + m) wrap.scrollLeft -= w.left + m - x;
    else if (x + view.cell > w.right - m) wrap.scrollLeft += x + view.cell - (w.right - m);
    if (y < w.top + m) wrap.scrollTop -= w.top + m - y;
    else if (y + view.cell > w.bottom - m) wrap.scrollTop += y + view.cell - (w.bottom - m);
  };
  canvas.addEventListener('focus', () => { view.showCursor = true; view.invalidate(); onCell(view.cursor, true); });
  canvas.addEventListener('blur', () => { view.showCursor = false; view.invalidate(); });
  canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = store.doc, r = Math.floor(view.cursor / d.width), c = view.cursor % d.width;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const drawVal = store.tool === 'erase' ? EMPTY : store.sel;
    if (moves[e.key]) {
      const [dr, dc] = moves[e.key];
      view.cursor = Math.min(d.height - 1, Math.max(0, r + dr)) * d.width + Math.min(d.width - 1, Math.max(0, c + dc));
      if (e.shiftKey) store.paint(view.cursor, drawVal);
      scrollIntoView(view.cursor);
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (store.tool === 'pick') pickAt(view.cursor);
      else if (store.tool === 'fill') store.fillAt(view.cursor, drawVal);
      else store.paint(view.cursor, drawVal);
    } else if (e.key === 'Delete' || e.key === 'Backspace') store.paint(view.cursor, EMPTY);
    else if (e.key.toLowerCase() === 'f') store.fillAt(view.cursor, drawVal);
    else return;
    e.preventDefault();
    view.invalidate();
    onCell(view.cursor, true);
  });
}
