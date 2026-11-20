/** Grid algorithms (pure, unit-tested). */
import type { MirrorMode } from './model';

export function mirrored(i: number, w: number, h: number, mode: MirrorMode): number[] {
  const r = Math.floor(i / w), c = i % w, out = new Set([i]);
  if (mode === 'h' || mode === 'both') out.add(r * w + (w - 1 - c));
  if (mode === 'v' || mode === 'both') out.add((h - 1 - r) * w + c);
  if (mode === 'both') out.add((h - 1 - r) * w + (w - 1 - c));
  return [...out];
}

/** Cells on the straight line between two cells (Bresenham), inclusive. Fills gaps of fast strokes. */
export function line(a: number, b: number, w: number): number[] {
  let x0 = a % w, y0 = Math.floor(a / w);
  const x1 = b % w, y1 = Math.floor(b / w);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (;;) {
    out.push(y0 * w + x0);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** 4-connected flood fill region starting at `start` (indices whose value equals the start value). */
export function floodRegion(cells: ArrayLike<number>, w: number, h: number, start: number): number[] {
  const from = cells[start], seen = new Uint8Array(w * h), out: number[] = [], st = [start];
  seen[start] = 1;
  while (st.length) {
    const k = st.pop()!;
    out.push(k);
    const r = Math.floor(k / w), c = k % w;
    const nb = [r > 0 ? k - w : -1, r < h - 1 ? k + w : -1, c > 0 ? k - 1 : -1, c < w - 1 ? k + 1 : -1];
    for (const n of nb) if (n >= 0 && !seen[n] && cells[n] === from) { seen[n] = 1; st.push(n); }
  }
  return out;
}

export interface FitRow { n: number; gap: number; left: number; right: number }

/** How many copies of a design of `size` fit in `total` with at least `minGap` between them. */
export function fitRows(total: number, size: number, minGap: number): FitRow[] {
  const out: FitRow[] = [];
  if (size <= 0) return out;
  for (let n = 1; n * size + (n - 1) * minGap <= total; n++) {
    const free = total - n * size;
    let g = n > 1 ? Math.max(minGap, Math.floor(free / (n + 1))) : 0;
    if (n > 1 && (n - 1) * g > free) g = Math.floor(free / (n - 1));
    const edges = free - (n - 1) * g, a = Math.floor(edges / 2);
    out.push({ n, gap: g, left: a, right: edges - a });
  }
  return out;
}
