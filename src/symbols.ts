/**
 * Stitch symbols as vector paths in a 10×10 box (y down).
 * The same path data drives the on-screen canvas (Path2D), the palette swatches
 * (inline SVG) and the PDF (pdf-lib drawSvgPath), so screen and paper always match
 * regardless of installed fonts or emoji rendering.
 */
export interface SymbolDef {
  id: string;
  /** Text hint for <select> options (UI only, never printed). */
  label: string;
  fill?: string;
  stroke?: string;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

function star(cx: number, cy: number, R: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function flower(): string {
  let d = '';
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    d += circle(+(5 + 2 * Math.cos(a)).toFixed(2), +(5.2 + 2 * Math.sin(a)).toFixed(2), 1.45);
  }
  return d;
}

export const SYMBOLS: readonly SymbolDef[] = [
  { id: 'cross', label: '✕', stroke: 'M2 2L8 8M8 2L2 8' },
  { id: 'dot', label: '●', fill: circle(5, 5, 3) },
  { id: 'square', label: '■', fill: 'M2 2H8V8H2Z' },
  { id: 'triangle', label: '▲', fill: 'M5 1.6L8.6 8.2H1.4Z' },
  { id: 'diamond', label: '◆', fill: 'M5 1.3L8.7 5L5 8.7L1.3 5Z' },
  { id: 'circle', label: '○', stroke: circle(5, 5, 3) },
  { id: 'square-o', label: '□', stroke: 'M2.3 2.3H7.7V7.7H2.3Z' },
  { id: 'triangle-o', label: '△', stroke: 'M5 2L8.2 7.9H1.8Z' },
  { id: 'diamond-o', label: '◇', stroke: 'M5 1.6L8.4 5L5 8.4L1.6 5Z' },
  { id: 'star', label: '★', fill: star(5, 5.4, 4, 1.65) },
  { id: 'heart', label: '♥', fill: 'M5 8.6C1 5.6 1.3 1.8 3.5 1.8C4.4 1.8 5 2.5 5 3.2C5 2.5 5.6 1.8 6.5 1.8C8.7 1.8 9 5.6 5 8.6Z' },
  { id: 'triangle-down', label: '▼', fill: 'M5 8.4L8.6 1.8H1.4Z' },
  { id: 'plus', label: '+', stroke: 'M5 1.8V8.2M1.8 5H8.2' },
  { id: 'half', label: '◐', fill: 'M5 2a3 3 0 0 0 0 6Z', stroke: circle(5, 5, 3) },
  { id: 'star-o', label: '☆', stroke: star(5, 5.4, 3.7, 1.6) },
  { id: 'diamond-sm', label: '♦', fill: 'M5 2.4L7.6 5L5 7.6L2.4 5Z' },
  { id: 'club', label: '♣', fill: circle(5, 3.3, 1.6) + circle(3.2, 5.6, 1.6) + circle(6.8, 5.6, 1.6) + 'M5 4.8L6.2 8.6H3.8Z' },
  { id: 'spade', label: '♠', fill: 'M5 1.4C3 4 1.7 5 1.7 6.3C1.7 7.7 3.6 8.3 4.6 7L3.8 8.7H6.2L5.4 7C6.4 8.3 8.3 7.7 8.3 6.3C8.3 5 7 4 5 1.4Z' },
  { id: 'flower', label: '✿', fill: flower() },
  { id: 'equals', label: '=', stroke: 'M2 3.8H8M2 6.2H8' },
  { id: 'slash', label: '/', stroke: 'M7.5 1.8L2.5 8.2' },
  { id: 'backslash', label: '\\', stroke: 'M2.5 1.8L7.5 8.2' },
  { id: 'hash', label: '#', stroke: 'M3.8 2V8M6.2 2V8M2 3.8H8M2 6.2H8' },
  { id: 'S', label: 'S', stroke: 'M7.4 2.6C6.2 1.6 2.6 1.6 2.6 3.6C2.6 5.3 7.4 4.7 7.4 6.5C7.4 8.5 3.8 8.5 2.6 7.4' },
  { id: 'Z', label: 'Z', stroke: 'M2.5 2H7.5L2.5 8H7.5' },
  { id: 'N', label: 'N', stroke: 'M2.6 8V2L7.4 8V2' },
  { id: 'H', label: 'H', stroke: 'M2.6 2V8M7.4 2V8M2.6 5H7.4' },
  { id: 'T', label: 'T', stroke: 'M2 2H8M5 2V8' },
  { id: 'V', label: 'V', stroke: 'M2.4 2L5 8L7.6 2' },
  { id: 'x-box', label: '⊠', stroke: 'M2 2H8V8H2ZM2 2L8 8M8 2L2 8' },
  { id: 'ring-dot', label: '⊙', stroke: circle(5, 5, 3.1), fill: circle(5, 5, 1.2) },
  { id: 'bars', label: '‖', stroke: 'M3.8 2V8M6.2 2V8' },
  { id: 'chevron', label: '^', stroke: 'M2 6.8L5 3.2L8 6.8' },
  { id: 'L', label: 'L', stroke: 'M3 2V8H7.5' },
  { id: 'E', label: 'E', stroke: 'M7.4 2H2.6V8H7.4M2.6 5H6.6' },
];

export const STROKE_WIDTH = 1.1;
export const SYMBOL_BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]));
export const isSymbolId = (v: unknown): v is string => typeof v === 'string' && SYMBOL_BY_ID.has(v);

/** Unicode symbols used by the v1 single-file version → symbol ids (one-to-one). */
export const LEGACY_SYMBOLS: Record<string, string> = {
  '✕': 'cross', '●': 'dot', '■': 'square', '▲': 'triangle', '◆': 'diamond', '○': 'circle',
  '□': 'square-o', '△': 'triangle-o', '◇': 'diamond-o', '★': 'star', '♥': 'heart',
  '▼': 'triangle-down', '+': 'plus', '◐': 'half', '☆': 'star-o', '♦': 'diamond-sm',
  '♣': 'club', '♠': 'spade', '✿': 'flower', '=': 'equals', '/': 'slash', '\\': 'backslash',
  '#': 'hash', S: 'S', Z: 'Z', N: 'N', H: 'H', T: 'T', V: 'V', X: 'x-box', O: 'ring-dot',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline SVG element for a symbol (palette/legend swatches). */
export function symbolSvg(id: string, color: string, size = 18): SVGSVGElement {
  const def = SYMBOL_BY_ID.get(id) ?? SYMBOLS[0];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  if (def.fill) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', def.fill);
    p.setAttribute('fill', color);
    svg.append(p);
  }
  if (def.stroke) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', def.stroke);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', String(STROKE_WIDTH));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  return svg;
}
