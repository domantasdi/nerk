/** Small localStorage helpers + reading the single-slot autosave of earlier versions. */
import { FormatError, parseDoc } from './format';
import type { Doc } from './model';

export const FIT_KEY = 'stitch-pattern-v1-fit';
export const CURRENT_KEY = 'stitch-pattern-current';
const LEGACY_KEYS = ['stitch-pattern-v2', 'stitch-pattern-v1'];
const MIGRATED_KEY = 'stitch-lib-migrated';

export function readJSON<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
export function writeJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

/**
 * The pattern autosaved by earlier versions (v2 key, then the original app's v1 key),
 * returned once so it can be moved into the library.
 */
export function takeLegacyDoc(): Doc | null {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return null;
    localStorage.setItem(MIGRATED_KEY, '1');
    for (const key of LEGACY_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try { return parseDoc(JSON.parse(raw)); } catch (e) { if (!(e instanceof FormatError || e instanceof SyntaxError)) throw e; }
    }
  } catch { /* storage blocked */ }
  return null;
}
