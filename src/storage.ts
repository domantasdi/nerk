/** Browser persistence. Reads the original app's v1 key once so existing work carries over. */
import { FormatError, parseDoc, serialize } from './format';
import type { Doc } from './model';

const KEY = 'stitch-pattern-v2';
const LEGACY_KEY = 'stitch-pattern-v1';
export const FIT_KEY = 'stitch-pattern-v1-fit';

export function loadSaved(): Doc | null {
  for (const key of [KEY, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return parseDoc(JSON.parse(raw));
    } catch (e) {
      if (!(e instanceof FormatError || e instanceof SyntaxError)) return null; // storage blocked
    }
  }
  return null;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => Doc) | null = null;

export type SaveStatus = 'pending' | 'saved' | 'error';
let statusListener: (s: SaveStatus) => void = () => {};
/** Autosave state for the "saved" indicator. */
export const onSaveStatus = (fn: (s: SaveStatus) => void) => { statusListener = fn; };

export function flush() {
  clearTimeout(timer);
  if (!pending) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize(pending())));
    statusListener('saved');
  } catch {
    statusListener('error'); // private mode / quota / blocked storage
  }
  pending = null;
}

/** Debounced save; call on every change. */
export function scheduleSave(get: () => Doc) {
  pending = get;
  statusListener('pending');
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function readJSON<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
export function writeJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
