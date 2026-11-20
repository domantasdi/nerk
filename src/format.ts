/**
 * File format: serialize, strictly validate and migrate pattern files.
 * Everything read from a file or localStorage goes through parseDoc(), so the
 * rest of the app can trust colours, symbols and cell values.
 */
import { EMPTY, FORMAT_VERSION, MAX_ENTRIES, MAX_SIZE, MIN_SIZE, type Doc, type Entry } from './model';
import { LEGACY_SYMBOLS, isSymbolId } from './symbols';

export const MAX_TITLE = 120;
export const MAX_DESC = 200;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export class FormatError extends Error {}

export interface SavedDocV2 {
  version: 2;
  title: string;
  width: number;
  height: number;
  entries: Entry[];
  cells: number[];
}

export function serialize(d: Doc): SavedDocV2 {
  return { version: FORMAT_VERSION, title: d.title, width: d.width, height: d.height, entries: d.entries.map((e) => ({ ...e })), cells: Array.from(d.cells) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (msg: string): never => { throw new FormatError(msg); };

function str(v: unknown, max: number, field: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') fail(`${field}: not text`);
  return (v as string).slice(0, max);
}

function size(v: unknown, field: string): number {
  if (!Number.isInteger(v) || (v as number) < MIN_SIZE || (v as number) > MAX_SIZE) fail(`${field}: must be ${MIN_SIZE}–${MAX_SIZE}`);
  return v as number;
}

/** Parse anything (file JSON, localStorage) into a trusted Doc. Throws FormatError. */
export function parseDoc(raw: unknown): Doc {
  if (!isObj(raw)) fail('not an object');
  const o = raw as Record<string, unknown>;
  const version = o.version ?? 1;
  if (version !== 1 && version !== 2) fail(`unsupported version ${String(version)}`);

  // v1 (original single-file app): fixed 30×30, unicode symbols, no width/height.
  const width = version === 1 ? 30 : size(o.width, 'width');
  const height = version === 1 ? 30 : size(o.height, 'height');

  if (!Array.isArray(o.entries) || o.entries.length < 1 || o.entries.length > MAX_ENTRIES) fail('entries: expected 1–' + MAX_ENTRIES);
  const entries = (o.entries as unknown[]).map((e, i): Entry => {
    if (!isObj(e)) fail(`entries[${i}]: not an object`);
    const ent = e as Record<string, unknown>;
    if (typeof ent.color !== 'string' || !COLOR_RE.test(ent.color)) fail(`entries[${i}].color: expected #rrggbb`);
    const sym = version === 1 && typeof ent.sym === 'string' ? LEGACY_SYMBOLS[ent.sym] : ent.sym;
    if (!isSymbolId(sym)) fail(`entries[${i}].sym: unknown symbol`);
    return { color: (ent.color as string).toLowerCase(), sym: sym as string, desc: str(ent.desc, MAX_DESC, `entries[${i}].desc`) };
  });

  if (!Array.isArray(o.cells) || o.cells.length !== width * height) fail(`cells: expected ${width * height} values`);
  const cells = new Int16Array(width * height);
  (o.cells as unknown[]).forEach((v, i) => {
    if (!Number.isInteger(v) || (v as number) < EMPTY || (v as number) >= entries.length) fail(`cells[${i}]: out of range`);
    cells[i] = v as number;
  });

  return { title: str(o.title, MAX_TITLE, 'title'), width, height, entries, cells };
}

/** Safe ASCII file name from a title (ė → e): some browsers/OSes drop non-ASCII download names. */
export function fileName(title: string, ext: string, fallback: string): string {
  const base = title.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
  return (base || fallback) + '.' + ext;
}
