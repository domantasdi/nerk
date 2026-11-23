/**
 * Share links: the whole pattern lives in the URL fragment (#p=…), which browsers
 * never send to a server. Format: "#p=<v>.<payload>", v = 1 (deflate-raw) or 0 (plain),
 * payload = base64url of a compact JSON (cells run-length encoded).
 * Everything decoded goes through parseDoc(), the same strict validation as files.
 */
import { parseDoc } from './format';
import { MAX_SIZE, MIN_SIZE, type Doc } from './model';

export const HASH_KEY = 'p';
const MAX_JSON = 2_000_000; // decompression-bomb guard (a 200×200 pattern is far smaller)

interface Compact { v: 2; t: string; w: number; h: number; e: [string, string, string][]; c: string }

/** Cells as runs: "0x120,1,2x3" (value+1, so 0 = empty; "xN" = repeated N times). */
export function rle(cells: ArrayLike<number>): string {
  const out: string[] = [];
  for (let i = 0; i < cells.length;) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    out.push(n > 1 ? `${cells[i] + 1}x${n}` : `${cells[i] + 1}`);
    i += n;
  }
  return out.join(',');
}

export function unrle(s: string, total: number): number[] {
  const out: number[] = [];
  for (const tok of s.split(',')) {
    const m = /^(\d{1,3})(?:x(\d{1,6}))?$/.exec(tok);
    if (!m) throw new Error('bad cells');
    const n = m[2] ? +m[2] : 1;
    if (out.length + n > total) throw new Error('too many cells');
    for (let k = 0; k < n; k++) out.push(+m[1] - 1);
  }
  return out;
}

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad characters');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON) { await reader.cancel(); throw new Error('too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The "#p=…" fragment for a pattern. */
export async function encodeShare(doc: Doc): Promise<string> {
  const c: Compact = { v: 2, t: doc.title, w: doc.width, h: doc.height, e: doc.entries.map((e) => [e.color, e.sym, e.desc]), c: rle(doc.cells) };
  const json = new TextEncoder().encode(JSON.stringify(c));
  return canCompress() ? `${HASH_KEY}=1.${b64url(await deflate(json))}` : `${HASH_KEY}=0.${b64url(json)}`;
}

/** Parse a location.hash (with or without "#"). Returns null if it isn't a share link. Throws on a broken one. */
export async function decodeShare(hash: string): Promise<Doc | null> {
  const m = new RegExp(`^#?${HASH_KEY}=([01])\\.(.+)$`).exec(hash);
  if (!m) return null;
  let bytes: Uint8Array = unb64url(m[2]);
  if (bytes.length > MAX_JSON) throw new Error('too large');
  if (m[1] === '1') {
    if (!canCompress()) throw new Error('browser cannot decompress');
    bytes = await inflate(bytes);
  }
  const c = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Compact>;
  if (!c || typeof c !== 'object' || c.v !== 2 || !Array.isArray(c.e) || typeof c.c !== 'string') throw new Error('not a pattern');
  const w = Number(c.w), h = Number(c.h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) throw new Error('bad size');
  const cells = unrle(c.c, w * h);
  return parseDoc({
    version: 2, title: c.t, width: w, height: h, cells,
    entries: c.e.map((x) => (Array.isArray(x) ? { color: x[0], sym: x[1], desc: x[2] } : x)),
  });
}

/** Where share links point: this page when hosted, otherwise the public copy of the app. */
export function shareBase(): string {
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin + location.pathname;
  return import.meta.env.VITE_PUBLIC_URL || 'https://domantasdi.github.io/nerk/';
}

/** Short stable fingerprint of a link payload, so opening the same link twice doesn't duplicate it. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

