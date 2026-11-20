/**
 * Canvas grid renderer. One <canvas> instead of thousands of DOM nodes, so grids
 * up to 200×200 stay fast. Redraws are coalesced into one animation frame.
 */
import { isMajorLabel, textOn, type Doc, type MirrorMode } from './model';
import type { PrintMode } from './pdf';
import { STROKE_WIDTH, SYMBOL_BY_ID, SYMBOLS } from './symbols';

const LINE = '#6b6b94', THICK = '#45456e';

interface SymPaths { fill?: Path2D; stroke?: Path2D }
const pathCache = new Map<string, SymPaths>();
function symPaths(id: string): SymPaths {
  let p = pathCache.get(id);
  if (!p) {
    const d = SYMBOL_BY_ID.get(id) ?? SYMBOLS[0];
    p = { fill: d.fill ? new Path2D(d.fill) : undefined, stroke: d.stroke ? new Path2D(d.stroke) : undefined };
    pathCache.set(id, p);
  }
  return p;
}

export class GridView {
  cell = 20; // CSS px per cell
  mode: PrintMode = 'both';
  mirror: MirrorMode = 'none';
  hover = -1;
  cursor = 0;
  showCursor = false;
  private ctx: CanvasRenderingContext2D;
  private frame = 0;

  constructor(readonly canvas: HTMLCanvasElement, private getDoc: () => Doc) {
    this.ctx = canvas.getContext('2d')!;
  }

  get gutter() { return Math.max(20, Math.round(this.cell * 1.3)); }

  setZoom(cell: number) {
    this.cell = Math.max(4, Math.min(48, Math.round(cell)));
    this.invalidate();
  }
  /** Largest cell size that fits the given box. */
  fitTo(width: number, height: number) {
    const d = this.getDoc();
    const g = (c: number) => Math.max(20, Math.round(c * 1.3));
    let c = Math.floor(Math.min(width / (d.width + 2.6), height / (d.height + 2.6)));
    while (c > 4 && (d.width * c + 2 * g(c) > width || d.height * c + 2 * g(c) > height)) c--;
    this.setZoom(c);
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  cellAt(clientX: number, clientY: number): number {
    const d = this.getDoc(), r = this.canvas.getBoundingClientRect();
    const c = Math.floor((clientX - r.left - this.gutter) / this.cell), row = Math.floor((clientY - r.top - this.gutter) / this.cell);
    return c < 0 || row < 0 || c >= d.width || row >= d.height ? -1 : row * d.width + c;
  }

  draw() {
    const d = this.getDoc(), cs = this.cell, g = this.gutter, W = d.width, H = d.height;
    const cssW = W * cs + 2 * g, cssH = H * cs + 2 * g, dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.translate(g, g);

    // Cells
    const drawSyms = this.mode !== 'col' && cs >= 7;
    for (let i = 0; i < d.cells.length; i++) {
      const v = d.cells[i];
      if (v < 0) continue;
      const e = d.entries[v], x = (i % W) * cs, y = Math.floor(i / W) * cs;
      if (this.mode !== 'sym') { ctx.fillStyle = e.color; ctx.fillRect(x, y, cs, cs); }
      if (drawSyms) {
        const col = this.mode === 'sym' ? '#222' : textOn(e.color), p = symPaths(e.sym);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(cs / 10, cs / 10);
        if (p.fill) { ctx.fillStyle = col; ctx.fill(p.fill); }
        if (p.stroke) { ctx.strokeStyle = col; ctx.lineWidth = STROKE_WIDTH; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(p.stroke); }
        ctx.restore();
      }
    }

    // Grid lines: thin per cell, thick every 5 (columns from left, rows from bottom), border.
    const lines = (major: boolean) => {
      ctx.beginPath();
      for (let c = 0; c <= W; c++) if ((c % 5 === 0) === major && (major || cs >= 5)) { ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, H * cs); }
      for (let r = 0; r <= H; r++) if (((H - r) % 5 === 0) === major && (major || cs >= 5)) { ctx.moveTo(0, r * cs); ctx.lineTo(W * cs, r * cs); }
      ctx.strokeStyle = major ? THICK : LINE;
      ctx.lineWidth = major ? Math.max(1.2, cs * 0.07) : Math.max(0.5, cs * 0.03);
      ctx.stroke();
    };
    lines(false);
    lines(true);
    ctx.strokeStyle = THICK;
    ctx.lineWidth = Math.max(1.6, cs * 0.09);
    ctx.strokeRect(0, 0, W * cs, H * cs);

    // Mirror axes
    if (this.mirror !== 'none') {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#d0103a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (this.mirror !== 'v') { ctx.moveTo((W * cs) / 2, -g / 3); ctx.lineTo((W * cs) / 2, H * cs + g / 3); }
      if (this.mirror !== 'h') { ctx.moveTo(-g / 3, (H * cs) / 2); ctx.lineTo(W * cs + g / 3, (H * cs) / 2); }
      ctx.stroke();
      ctx.restore();
    }

    // Centre mark
    ctx.fillStyle = '#d0103a';
    ctx.beginPath();
    ctx.arc((W * cs) / 2, (H * cs) / 2, Math.max(2, cs * 0.16), 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#333';
    ctx.font = `700 ${Math.max(9, Math.min(13, cs * 0.55))}px Lato, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = cs < 8 ? 10 : 1; // avoid crowded numbers when zoomed out
    for (let c = 0; c < W; c++) if (isMajorLabel(c + 1) && ((c + 1) % step === 0 || c === 0)) {
      ctx.fillText(String(c + 1), c * cs + cs / 2, -g / 2);
      ctx.fillText(String(c + 1), c * cs + cs / 2, H * cs + g / 2);
    }
    for (let r = 0; r < H; r++) if (isMajorLabel(H - r) && ((H - r) % step === 0 || r === H - 1)) {
      ctx.fillText(String(H - r), -g / 2, r * cs + cs / 2);
      ctx.fillText(String(H - r), W * cs + g / 2, r * cs + cs / 2);
    }

    // Hover + keyboard cursor
    const outline = (i: number, color: string, w: number) => {
      if (i < 0 || i >= d.cells.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.strokeRect((i % W) * cs + w / 2, Math.floor(i / W) * cs + w / 2, cs - w, cs - w);
    };
    outline(this.hover, '#000', 1.5);
    if (this.showCursor) { outline(this.cursor, '#fff', 4); outline(this.cursor, '#c62828', 2); }
  }
}
