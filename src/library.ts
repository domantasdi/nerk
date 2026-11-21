/**
 * Pattern library: many patterns kept in the browser.
 * IndexedDB when available (large quota); localStorage, then memory, as fallbacks.
 * Pattern data is always re-validated with parseDoc() when read back.
 */
import { parseDoc, serialize, type SavedDocV2 } from './format';
import { cloneDoc, counts, type Doc } from './model';

export interface PatternMeta {
  id: string;
  title: string;
  width: number;
  height: number;
  stitches: number;
  colors: number;
  created: number;
  updated: number;
  thumb: string; // small PNG data URL ('' when unavailable)
  /** Fingerprint of the share link it came from, to avoid importing the same link twice. */
  source?: string;
}

export interface Backend {
  readonly kind: 'idb' | 'local' | 'memory';
  allMeta(): Promise<PatternMeta[]>;
  getDoc(id: string): Promise<SavedDocV2 | null>;
  put(meta: PatternMeta, doc: SavedDocV2): Promise<void>;
  remove(id: string): Promise<void>;
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

/* ---------- IndexedDB ---------- */
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((ok, bad) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => bad(tx.error); });

class IdbBackend implements Backend {
  readonly kind = 'idb' as const;
  constructor(private db: IDBDatabase) {}
  static open(timeoutMs = 2000): Promise<IdbBackend> {
    return new Promise((ok, bad) => {
      const timer = setTimeout(() => bad(new Error('IndexedDB timeout')), timeoutMs);
      const r = indexedDB.open('stitch-patterns', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('meta', { keyPath: 'id' });
        r.result.createObjectStore('docs', { keyPath: 'id' });
      };
      r.onsuccess = () => { clearTimeout(timer); ok(new IdbBackend(r.result)); };
      r.onerror = r.onblocked = () => { clearTimeout(timer); bad(r.error ?? new Error('blocked')); };
    });
  }
  allMeta() { return req<PatternMeta[]>(this.db.transaction('meta').objectStore('meta').getAll()); }
  async getDoc(id: string) {
    const rec = await req<{ id: string; doc: SavedDocV2 } | undefined>(this.db.transaction('docs').objectStore('docs').get(id));
    return rec?.doc ?? null;
  }
  put(meta: PatternMeta, doc: SavedDocV2) {
    const tx = this.db.transaction(['meta', 'docs'], 'readwrite');
    tx.objectStore('meta').put(meta);
    tx.objectStore('docs').put({ id: meta.id, doc });
    return done(tx);
  }
  remove(id: string) {
    const tx = this.db.transaction(['meta', 'docs'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('docs').delete(id);
    return done(tx);
  }
}

/* ---------- key/value (localStorage or memory) ---------- */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export class MemoryKV implements KV {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

export class KvBackend implements Backend {
  constructor(private kv: KV, readonly kind: 'local' | 'memory') {}
  private index(): PatternMeta[] {
    try { return JSON.parse(this.kv.getItem('stitch-lib-index') ?? '[]') as PatternMeta[]; } catch { return []; }
  }
  async allMeta() { return this.index(); }
  async getDoc(id: string) {
    const s = this.kv.getItem('stitch-lib-doc-' + id);
    return s ? (JSON.parse(s) as SavedDocV2) : null;
  }
  async put(meta: PatternMeta, doc: SavedDocV2) {
    this.kv.setItem('stitch-lib-doc-' + meta.id, JSON.stringify(doc));
    this.kv.setItem('stitch-lib-index', JSON.stringify([...this.index().filter((m) => m.id !== meta.id), meta]));
  }
  async remove(id: string) {
    this.kv.removeItem('stitch-lib-doc-' + id);
    this.kv.setItem('stitch-lib-index', JSON.stringify(this.index().filter((m) => m.id !== id)));
  }
}

/* ---------- library ---------- */
export class Library {
  private metas = new Map<string, PatternMeta>();
  constructor(readonly backend: Backend, private thumbnail: (d: Doc) => string = () => '') {}

  async load() { this.metas = new Map((await this.backend.allMeta()).map((m) => [m.id, m])); return this; }

  /** Newest first. */
  list(): PatternMeta[] { return [...this.metas.values()].sort((a, b) => b.updated - a.updated); }
  meta(id: string) { return this.metas.get(id); }
  findBySource(source: string) { return this.list().find((m) => m.source === source); }

  async get(id: string): Promise<Doc | null> {
    const raw = await this.backend.getDoc(id);
    if (!raw) return null;
    try { return parseDoc(raw); } catch { return null; }
  }

  async save(id: string, doc: Doc, extra: Partial<PatternMeta> = {}): Promise<PatternMeta> {
    const prev = this.metas.get(id), now = Date.now();
    const meta: PatternMeta = {
      id, title: doc.title, width: doc.width, height: doc.height,
      stitches: counts(doc).reduce((a, b) => a + b, 0), colors: doc.entries.length,
      created: prev?.created ?? now, updated: now, thumb: this.thumbnail(doc),
      ...(prev?.source ? { source: prev.source } : {}), ...extra,
    };
    await this.backend.put(meta, serialize(doc));
    this.metas.set(id, meta);
    return meta;
  }

  /** Put back a pattern exactly as it was (undo of delete). */
  async restore(meta: PatternMeta, doc: Doc) {
    await this.backend.put(meta, serialize(doc));
    this.metas.set(meta.id, meta);
  }

  async create(doc: Doc, extra: Partial<PatternMeta> = {}) { return this.save(newId(), doc, extra); }

  async remove(id: string) {
    await this.backend.remove(id);
    this.metas.delete(id);
  }
}

export async function openLibrary(thumbnail?: (d: Doc) => string): Promise<Library> {
  try {
    if (typeof indexedDB !== 'undefined') return await new Library(await IdbBackend.open(), thumbnail).load();
  } catch { /* fall through */ }
  try {
    localStorage.setItem('stitch-lib-probe', '1');
    localStorage.removeItem('stitch-lib-probe');
    return await new Library(new KvBackend(localStorage, 'local'), thumbnail).load();
  } catch {
    return await new Library(new KvBackend(new MemoryKV(), 'memory'), thumbnail).load();
  }
}

/** Debounced autosave of the open pattern. */
export class AutoSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private lib: Library,
    private current: () => { id: string; doc: Doc },
    private onStatus: (s: 'pending' | 'saved' | 'error', meta?: PatternMeta) => void,
    private delay = 400,
  ) {}
  schedule() {
    this.dirty = true;
    this.onStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }
  /** Forget unsaved changes (the stored copy is about to be reloaded). */
  discard() { clearTimeout(this.timer); this.dirty = false; }
  /** Save now if there are unsaved changes. Saves run one after another. */
  flush(): Promise<unknown> {
    clearTimeout(this.timer);
    if (!this.dirty) return this.chain;
    this.dirty = false;
    const { id, doc } = this.current();
    const snap = cloneDoc(doc); // later edits / pattern switches must not leak into this save
    this.chain = this.chain.then(() => this.lib.save(id, snap)).then(
      (meta) => this.onStatus('saved', meta as PatternMeta),
      () => { this.dirty = true; this.onStatus('error'); },
    );
    return this.chain;
  }
}
