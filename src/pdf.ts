/**
 * Vector PDF export (A4). Replaces window.print(): no "background graphics"
 * setting needed, identical output in every browser, and large grids are split
 * across pages with a 2-cell overlap plus an overview page.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { fontBytes } from './fonts';
import { t, type Lang } from './i18n';
import { counts, isMajorLabel, textOn, type Doc } from './model';
import { STROKE_WIDTH, SYMBOL_BY_ID, SYMBOLS } from './symbols';

export type PrintMode = 'both' | 'sym' | 'col';

/* ---------- page geometry (mm) ---------- */
const PW = 210, PH = 297, MX = 14, MY = 12, HEADER = 14, LAB = 7, FOOTER = 6;
const MAX_CELL = 5.4, MIN_CELL = 2.8, TILE_CELL = 3.8, OVERLAP = 2;
const GRID_MAX_W = PW - 2 * MX - 2 * LAB;
const GRID_TOP = MY + HEADER + LAB;
const GRID_MAX_H = PH - MY - FOOTER - LAB - GRID_TOP;
const LEGEND_ROW = 6;

export const legendHeight = (n: number) => 7 + LEGEND_ROW + Math.ceil(n / 3) * LEGEND_ROW + 4;

export interface Tile { c0: number; c1: number; r0: number; r1: number } // inclusive start, exclusive end
export interface Plan { cell: number; tiles: Tile[]; legendWithGrid: boolean; cover: boolean }

/** Split `total` cells into balanced spans of at most `per`, overlapping by OVERLAP. */
export function spans(total: number, per: number, overlap = OVERLAP): [number, number][] {
  if (total <= per) return [[0, total]];
  const n = Math.ceil((total - overlap) / (per - overlap));
  const size = Math.ceil((total + (n - 1) * overlap) / n);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * (size - overlap), total - size);
    out.push([s, s + size]);
  }
  return out;
}

export function planPages(w: number, h: number, nEntries: number): Plan {
  const lh = legendHeight(nEntries);
  const withLegend = Math.min(MAX_CELL, GRID_MAX_W / w, (GRID_MAX_H - lh) / h);
  if (withLegend >= MIN_CELL) return { cell: withLegend, tiles: [{ c0: 0, c1: w, r0: 0, r1: h }], legendWithGrid: true, cover: false };
  const alone = Math.min(MAX_CELL, GRID_MAX_W / w, GRID_MAX_H / h);
  if (alone >= MIN_CELL) return { cell: alone, tiles: [{ c0: 0, c1: w, r0: 0, r1: h }], legendWithGrid: false, cover: true };
  const cols = spans(w, Math.floor(GRID_MAX_W / TILE_CELL)), rows = spans(h, Math.floor(GRID_MAX_H / TILE_CELL));
  const tiles = rows.flatMap(([r0, r1]) => cols.map(([c0, c1]) => ({ c0, c1, r0, r1 })));
  return { cell: TILE_CELL, tiles, legendWithGrid: false, cover: true };
}

/* ---------- drawing helpers ---------- */
const PT = 72 / 25.4;
const hex = (c: string): RGB => { const n = parseInt(c.slice(1), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const LINE = hex('#6b6b94'), THICK = hex('#45456e'), GREY = hex('#777777'), INK = hex('#222222'), LIGHT = hex('#b5b5cc'), RED = hex('#d0103a');

/** Text drawing with glyph fallback ('?' for characters the font lacks) and fitting. */
class TextFont {
  private sets: Set<number>[];
  constructor(private fonts: PDFFont[]) { this.sets = fonts.map((f) => new Set(f.getCharacterSet())); }
  private runs(s: string): [PDFFont, string][] {
    const out: [PDFFont, string][] = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const k = this.sets.findIndex((set) => set.has(cp));
      const [f, c] = k < 0 ? [this.fonts[0], '?'] : [this.fonts[k], ch];
      if (out.length && out[out.length - 1][0] === f) out[out.length - 1][1] += c;
      else out.push([f, c]);
    }
    return out;
  }
  width(s: string, size: number) { return this.runs(s).reduce((a, [f, txt]) => a + f.widthOfTextAtSize(txt, size), 0); }
  fit(s: string, size: number, maxPt: number): string {
    if (this.width(s, size) <= maxPt) return s;
    const chars = [...s];
    while (chars.length && this.width(chars.join('') + '…', size) > maxPt) chars.pop();
    return chars.join('') + '…';
  }
  draw(page: PDFPage, s: string, x: number, y: number, size: number, color: RGB) {
    for (const [font, txt] of this.runs(s)) {
      page.drawText(txt, { x, y, size, font, color });
      x += font.widthOfTextAtSize(txt, size);
    }
  }
}

interface Ctx { doc: Doc; mode: PrintMode; lang: Lang; reg: TextFont; bold: TextFont; pdf: PDFDocument }
const X = (mm: number) => mm * PT;
const Y = (mm: number) => (PH - mm) * PT;

function drawSymbol(page: PDFPage, symId: string, xMm: number, yMm: number, sizeMm: number, color: RGB) {
  const def = SYMBOL_BY_ID.get(symId) ?? SYMBOLS[0];
  const scale = (sizeMm * PT) / 10;
  if (def.fill) page.drawSvgPath(def.fill, { x: X(xMm), y: Y(yMm), scale, color });
  if (def.stroke) page.drawSvgPath(def.stroke, { x: X(xMm), y: Y(yMm), scale, borderColor: color, borderWidth: STROKE_WIDTH * scale, borderLineCap: 1 });
}

function header(ctx: Ctx, page: PDFPage, right: string) {
  page.drawLine({ start: { x: X(MX), y: Y(MY) }, end: { x: X(PW - MX), y: Y(MY) }, thickness: 1.2 * PT, color: LINE });
  const rw = ctx.reg.width(right, 8.5);
  const title = ctx.bold.fit(ctx.doc.title || t('defaultTitle', {}, ctx.lang), 13, X(PW - 2 * MX) - rw - 12);
  ctx.bold.draw(page, title, X(MX), Y(MY + 8.5), 13, INK);
  ctx.reg.draw(page, right, X(PW - MX) - rw, Y(MY + 8.5), 8.5, GREY);
  page.drawLine({ start: { x: X(MX), y: Y(MY + 11) }, end: { x: X(PW - MX), y: Y(MY + 11) }, thickness: 0.4 * PT, color: LINE });
}

function footer(ctx: Ctx, page: PDFPage, i: number, n: number) {
  if (n < 2) return;
  const s = t('page', { i, n }, ctx.lang), w = ctx.reg.width(s, 7);
  ctx.reg.draw(page, s, X(PW / 2) - w / 2, Y(PH - MY + 2), 7, GREY);
}

function drawGrid(ctx: Ctx, page: PDFPage, tile: Tile, cell: number, top: number) {
  const { doc, mode } = ctx, W = doc.width, H = doc.height;
  const cols = tile.c1 - tile.c0;
  const left = (PW - cols * cell) / 2;
  const cx = (c: number) => left + (c - tile.c0) * cell, cy = (r: number) => top + (r - tile.r0) * cell;

  for (let r = tile.r0; r < tile.r1; r++)
    for (let c = tile.c0; c < tile.c1; c++) {
      const v = doc.cells[r * W + c];
      if (v < 0) continue;
      const e = doc.entries[v];
      if (mode !== 'sym') page.drawRectangle({ x: X(cx(c)), y: Y(cy(r) + cell), width: cell * PT, height: cell * PT, color: hex(e.color) });
      if (mode !== 'col') drawSymbol(page, e.sym, cx(c), cy(r), cell, mode === 'sym' ? INK : hex(textOn(e.color)));
    }

  // Lines: major every 5, aligned with the labels (columns from the left, rows from the bottom).
  const line = (x1: number, y1: number, x2: number, y2: number, major: boolean, edge: boolean) =>
    page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: (edge ? 0.5 : major ? 0.38 : 0.15) * PT, color: major || edge ? THICK : LINE });
  for (let c = tile.c0; c <= tile.c1; c++) line(cx(c), cy(tile.r0), cx(c), cy(tile.r1), c % 5 === 0, c === tile.c0 || c === tile.c1);
  for (let r = tile.r0; r <= tile.r1; r++) line(cx(tile.c0), cy(r), cx(tile.c1), cy(r), (H - r) % 5 === 0, r === tile.r0 || r === tile.r1);

  // Overlap with the previous page (dashed).
  const dash = { thickness: 0.35 * PT, color: RED, dashArray: [2, 2] };
  if (tile.c0 > 0) page.drawLine({ start: { x: X(cx(tile.c0 + OVERLAP)), y: Y(cy(tile.r0)) }, end: { x: X(cx(tile.c0 + OVERLAP)), y: Y(cy(tile.r1)) }, ...dash });
  if (tile.r0 > 0) page.drawLine({ start: { x: X(cx(tile.c0)), y: Y(cy(tile.r0 + OVERLAP)) }, end: { x: X(cx(tile.c1)), y: Y(cy(tile.r0 + OVERLAP)) }, ...dash });

  // Centre mark.
  if (W / 2 >= tile.c0 && W / 2 <= tile.c1 && H / 2 >= tile.r0 && H / 2 <= tile.r1)
    page.drawCircle({ x: X(cx(W / 2)), y: Y(cy(H / 2)), size: cell * 0.16 * PT, color: RED });

  // Labels.
  const fs = 6.5;
  const label = (s: string, xMm: number, yMm: number) => { const w = ctx.bold.width(s, fs); ctx.bold.draw(page, s, X(xMm) - w / 2, Y(yMm) - fs * 0.35, fs, INK); };
  for (let c = tile.c0; c < tile.c1; c++) if (isMajorLabel(c + 1)) {
    label(String(c + 1), cx(c) + cell / 2, cy(tile.r0) - 3);
    label(String(c + 1), cx(c) + cell / 2, cy(tile.r1) + 3);
  }
  for (let r = tile.r0; r < tile.r1; r++) if (isMajorLabel(H - r)) {
    label(String(H - r), cx(tile.c0) - 3.5, cy(r) + cell / 2);
    label(String(H - r), cx(tile.c1) + 3.5, cy(r) + cell / 2);
  }
}

function drawLegend(ctx: Ctx, page: PDFPage, top: number) {
  const { doc, mode, lang } = ctx, cnt = counts(doc);
  ctx.bold.draw(page, t('legend', {}, lang), X(MX), Y(top + 4), 10, INK);
  const y0 = top + 7, colW = (PW - 2 * MX) / 3, rows = Math.ceil(doc.entries.length / 3);
  const bottom = y0 + LEGEND_ROW * (rows + 1);
  page.drawLine({ start: { x: X(MX), y: Y(y0) }, end: { x: X(PW - MX), y: Y(y0) }, thickness: 0.5 * PT, color: LINE });
  page.drawLine({ start: { x: X(MX), y: Y(bottom) }, end: { x: X(PW - MX), y: Y(bottom) }, thickness: 0.5 * PT, color: LINE });
  for (let col = 0; col < 3; col++) {
    const x0 = MX + col * colW;
    if (col) page.drawLine({ start: { x: X(x0), y: Y(y0) }, end: { x: X(x0), y: Y(bottom) }, thickness: 0.5 * PT, color: LINE });
    ctx.bold.draw(page, t('symbol', {}, lang), X(x0 + 1.5), Y(y0 + 4), 7, INK);
    ctx.bold.draw(page, t('descr', {}, lang), X(x0 + 14), Y(y0 + 4), 7, INK);
    const cw = ctx.bold.width(t('count', {}, lang), 7);
    ctx.bold.draw(page, t('count', {}, lang), X(x0 + colW - 1.5) - cw, Y(y0 + 4), 7, INK);
    page.drawLine({ start: { x: X(x0), y: Y(y0 + LEGEND_ROW) }, end: { x: X(x0 + colW), y: Y(y0 + LEGEND_ROW) }, thickness: 0.4 * PT, color: LINE });
    for (let r = 0; r < rows; r++) {
      const i = col * rows + r, e = doc.entries[i], ry = y0 + LEGEND_ROW * (r + 1);
      if (r < rows - 1) page.drawLine({ start: { x: X(x0), y: Y(ry + LEGEND_ROW) }, end: { x: X(x0 + colW), y: Y(ry + LEGEND_ROW) }, thickness: 0.2 * PT, color: LIGHT });
      if (!e) continue;
      const s = 4.6, sx = x0 + 4, sy = ry + (LEGEND_ROW - s) / 2;
      page.drawRectangle({ x: X(sx), y: Y(sy + s), width: s * PT, height: s * PT, color: mode === 'sym' ? rgb(1, 1, 1) : hex(e.color), borderColor: hex('#555555'), borderWidth: 0.2 * PT });
      if (mode !== 'col') drawSymbol(page, e.sym, sx, sy, s, mode === 'sym' ? INK : hex(textOn(e.color)));
      const n = String(cnt[i]), nw = ctx.reg.width(n, 8);
      ctx.reg.draw(page, n, X(x0 + colW - 1.5) - nw, Y(ry + 4.1), 8, GREY);
      ctx.reg.draw(page, ctx.reg.fit(e.desc, 8.5, X(colW - 17) - nw), X(x0 + 14), Y(ry + 4.1), 8.5, INK);
    }
  }
}

function drawOverview(ctx: Ctx, page: PDFPage, plan: Plan, top: number, maxH: number) {
  const { doc, mode } = ctx, W = doc.width, H = doc.height;
  ctx.bold.draw(page, t('overview', {}, ctx.lang), X(MX), Y(top + 4), 10, INK);
  const y0 = top + 8, cell = Math.min((PW - 2 * MX) / W, (maxH - 10) / H), x0 = (PW - W * cell) / 2;
  page.drawRectangle({ x: X(x0), y: Y(y0 + H * cell), width: W * cell * PT, height: H * cell * PT, borderColor: THICK, borderWidth: 0.4 * PT });
  for (let i = 0; i < doc.cells.length; i++) {
    const v = doc.cells[i];
    if (v < 0) continue;
    const r = Math.floor(i / W), c = i % W;
    page.drawRectangle({ x: X(x0 + c * cell), y: Y(y0 + (r + 1) * cell), width: cell * PT, height: cell * PT, color: mode === 'sym' ? GREY : hex(doc.entries[v].color) });
  }
  if (plan.tiles.length < 2) return;
  plan.tiles.forEach((tl, k) => {
    page.drawRectangle({ x: X(x0 + tl.c0 * cell), y: Y(y0 + tl.r1 * cell), width: (tl.c1 - tl.c0) * cell * PT, height: (tl.r1 - tl.r0) * cell * PT, borderColor: RED, borderWidth: 0.4 * PT });
    const s = String(k + 2), w = ctx.bold.width(s, 12), mx = X(x0 + ((tl.c0 + tl.c1) / 2) * cell), my = Y(y0 + ((tl.r0 + tl.r1) / 2) * cell);
    page.drawRectangle({ x: mx - w / 2 - 4, y: my - 8, width: w + 8, height: 17, color: rgb(1, 1, 1), borderColor: RED, borderWidth: 0.8 });
    ctx.bold.draw(page, s, mx - w / 2, my - 4, 12, RED);
  });
}

export async function buildPdf(doc: Doc, mode: PrintMode, lang: Lang): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = async (w: 'regular' | 'bold') => [await pdf.embedFont(fontBytes(w), { subset: true })];
  const ctx: Ctx = { doc, mode, lang, pdf, reg: new TextFont(await embed('regular')), bold: new TextFont(await embed('bold')) };
  pdf.setTitle(doc.title || t('defaultTitle', {}, lang));
  pdf.setCreator('Pattern maker');

  const plan = planPages(doc.width, doc.height, doc.entries.length);
  const total = plan.tiles.length + (plan.cover ? 1 : 0);
  const dims = `${doc.width} × ${doc.height}`;
  let pageNo = 0;

  if (plan.cover) {
    const page = pdf.addPage([PW * PT, PH * PT]);
    header(ctx, page, dims);
    const lh = legendHeight(doc.entries.length), top = MY + HEADER;
    drawOverview(ctx, page, plan, top, PH - MY - FOOTER - top - lh - 4);
    drawLegend(ctx, page, PH - MY - FOOTER - lh);
    footer(ctx, page, ++pageNo, total);
  }
  for (const tile of plan.tiles) {
    const page = pdf.addPage([PW * PT, PH * PT]);
    const info = plan.tiles.length > 1
      ? `${dims} · ${t('colsRows', { c0: tile.c0 + 1, c1: tile.c1, r0: doc.height - tile.r1 + 1, r1: doc.height - tile.r0 }, lang)}`
      : dims;
    header(ctx, page, info);
    drawGrid(ctx, page, tile, plan.cell, GRID_TOP);
    if (plan.legendWithGrid) drawLegend(ctx, page, PH - MY - legendHeight(doc.entries.length));
    footer(ctx, page, ++pageNo, total);
  }
  return pdf.save();
}
