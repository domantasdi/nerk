/** Pattern data model. Pure functions only (no DOM) so they can be unit-tested. */
import { SYMBOLS } from './symbols';

export const FORMAT_VERSION = 2;
export const MIN_SIZE = 5;
export const MAX_SIZE = 200;
export const MAX_ENTRIES = SYMBOLS.length;
export const EMPTY = -1;

export interface Entry {
  color: string; // #rrggbb
  sym: string; // symbol id from symbols.ts
  desc: string;
}

export interface Doc {
  title: string;
  width: number;
  height: number;
  entries: Entry[];
  /** Row-major, EMPTY or an index into entries. */
  cells: Int16Array;
}

export type MirrorMode = 'none' | 'h' | 'v' | 'both';

export const PRESET_COLORS = ['#1565c0', '#2e7d32', '#f9a825', '#212121', '#6a1b9a', '#ef6c00', '#ad1457', '#00838f', '#795548', '#ffffff', '#9e9e9e'];

export function blankDoc(width = 30, height = 30, title = '', firstDesc = ''): Doc {
  return {
    title,
    width,
    height,
    entries: [{ color: '#c62828', sym: 'cross', desc: firstDesc }],
    cells: new Int16Array(width * height).fill(EMPTY),
  };
}

export function samplePattern(title: string, desc: string): Doc {
  const N = 30, d = blankDoc(N, N, title, desc);
  const q: [number, number][] = [];
  for (let c = 5; c < 15; c++) q.push([14, c]);
  for (let r = 5; r < 15; r++) q.push([r, 14]);
  for (let k = 0; k < 9; k++) q.push([14 - k, 14 - k]);
  q.push([13, 8], [12, 7], [8, 13], [7, 12], [6, 8], [8, 6], [13, 5], [12, 5], [5, 13], [5, 12], [12, 13], [13, 12], [11, 12], [12, 11]);
  for (const [r, c] of q)
    for (const [a, b] of [[r, c], [r, N - 1 - c], [N - 1 - r, c], [N - 1 - r, N - 1 - c]]) d.cells[a * N + b] = 0;
  return d;
}

export const cloneDoc = (d: Doc): Doc => ({ ...d, entries: d.entries.map((e) => ({ ...e })), cells: d.cells.slice() });

export function counts(d: Doc): number[] {
  const c = d.entries.map(() => 0);
  for (const v of d.cells) if (v >= 0 && v < c.length) c[v]++;
  return c;
}

export interface Box { c0: number; r0: number; w: number; h: number }

export function bbox(d: Doc): Box | null {
  let r0 = d.height, r1 = -1, c0 = d.width, c1 = -1;
  for (let i = 0; i < d.cells.length; i++) {
    if (d.cells[i] < 0) continue;
    const r = Math.floor(i / d.width), c = i % d.width;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
  }
  return r1 < 0 ? null : { c0, r0, w: c1 - c0 + 1, h: r1 - r0 + 1 };
}

/** Resize keeping the grid centred; returns the new doc and how many stitches fell off. */
export function resizeDoc(d: Doc, width: number, height: number): { doc: Doc; lost: number } {
  const out = { ...cloneDoc(d), width, height, cells: new Int16Array(width * height).fill(EMPTY) };
  const dx = Math.floor((width - d.width) / 2), dy = Math.floor((height - d.height) / 2);
  let lost = 0;
  for (let r = 0; r < d.height; r++)
    for (let c = 0; c < d.width; c++) {
      const v = d.cells[r * d.width + c];
      if (v < 0) continue;
      const nr = r + dy, nc = c + dx;
      if (nr < 0 || nc < 0 || nr >= height || nc >= width) lost++;
      else out.cells[nr * width + nc] = v;
    }
  return { doc: out, lost };
}

/** Remove a palette entry; its stitches are erased and later indices shift down. */
export function removeEntry(d: Doc, i: number): Doc {
  const out = cloneDoc(d);
  out.entries.splice(i, 1);
  out.cells = out.cells.map((v) => (v === i ? EMPTY : v > i ? v - 1 : v));
  return out;
}

export function nextEntry(d: Doc): Entry {
  const used = new Set(d.entries.map((e) => e.sym));
  return {
    color: PRESET_COLORS[(d.entries.length - 1 + PRESET_COLORS.length) % PRESET_COLORS.length],
    sym: SYMBOLS.find((s) => !used.has(s.id))?.id ?? SYMBOLS[0].id,
    desc: '',
  };
}

/** Readable symbol colour on top of a background colour. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

/** Row labels count from the bottom (as in the original layout); column labels from the left. */
export const isMajorLabel = (n: number) => n === 1 || n % 5 === 0;
