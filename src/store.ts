/** Application state + all mutations (the only place that writes to the Doc). */
import { floodRegion, mirrored } from './geometry';
import { CellRecorder, History, metaOf, sameMeta, type Change, type Meta } from './history';
import { MAX_ENTRIES, cloneDoc, nextEntry, removeEntry, type Doc, type Entry, type MirrorMode } from './model';

export type Tool = 'pen' | 'erase' | 'fill' | 'pick';
export const TOOLS: Tool[] = ['pen', 'erase', 'fill', 'pick'];
export type StoreEvent =
  | { type: 'cells'; idx: Iterable<number> }
  | { type: 'meta' } // title / palette changed
  | { type: 'doc' } // everything changed (size may differ)
  | { type: 'ui' }; // selection, tool, mirror, history availability

export class Store {
  sel = 0;
  tool: Tool = 'pen';
  mirror: MirrorMode = 'none';
  readonly history = new History();
  private rec: CellRecorder | null = null;
  private metaFrom: Meta | null = null;
  private listeners = new Set<(e: StoreEvent) => void>();

  constructor(public doc: Doc) {}

  on(fn: (e: StoreEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: StoreEvent) { for (const fn of this.listeners) fn(e); }
  private commit(c: Change | null) { if (c) { this.history.push(c); this.emit({ type: 'ui' }); } }

  /* ---------- strokes ---------- */
  beginStroke() { this.endStroke(); this.rec = new CellRecorder(); }
  /** Paint one cell (plus its mirror images). Outside a stroke it records its own undo step. */
  paint(i: number, v: number) {
    const own = !this.rec;
    if (own) this.beginStroke();
    const changed: number[] = [];
    for (const j of mirrored(i, this.doc.width, this.doc.height, this.mirror)) {
      if (this.doc.cells[j] === v) continue;
      this.rec!.record(j, this.doc.cells[j]);
      this.doc.cells[j] = v;
      changed.push(j);
    }
    if (changed.length) this.emit({ type: 'cells', idx: changed });
    if (own) this.endStroke();
  }
  paintMany(idx: number[], v: number) { for (const i of idx) this.paint(i, v); }
  /** Abort the stroke in progress and restore its cells (e.g. a second finger turned it into a pinch). */
  cancelStroke() {
    if (!this.rec) return;
    const changed = this.rec.revert(this.doc.cells);
    this.rec = null;
    if (changed.length) this.emit({ type: 'cells', idx: changed });
  }
  endStroke() {
    if (!this.rec) return;
    const c = this.rec.finish(this.doc.cells);
    this.rec = null;
    this.commit(c);
  }
  fillAt(i: number, v: number) {
    this.beginStroke();
    const { width: w, height: h } = this.doc;
    const changed: number[] = [];
    for (const start of mirrored(i, w, h, this.mirror)) {
      if (this.doc.cells[start] === v) continue;
      for (const k of floodRegion(this.doc.cells, w, h, start)) {
        this.rec!.record(k, this.doc.cells[k]);
        this.doc.cells[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) this.emit({ type: 'cells', idx: changed });
    this.endStroke();
  }

  /* ---------- title & palette ---------- */
  /** Start a coalesced edit (e.g. typing). Nothing is recorded unless the value really changes. */
  beginMetaEdit() { if (!this.metaFrom) this.metaFrom = metaOf(this.doc); }
  commitMetaEdit() {
    if (!this.metaFrom) return;
    const from = this.metaFrom, to = metaOf(this.doc);
    this.metaFrom = null;
    if (!sameMeta(from, to)) this.commit({ kind: 'meta', from, to });
  }
  /** Live update without its own undo step when inside begin/commitMetaEdit. */
  updateEntry(i: number, patch: Partial<Entry>) {
    const own = !this.metaFrom;
    if (own) this.beginMetaEdit();
    Object.assign(this.doc.entries[i], patch);
    this.emit({ type: 'meta' });
    if (own) this.commitMetaEdit();
  }
  setTitle(title: string) {
    const own = !this.metaFrom;
    if (own) this.beginMetaEdit();
    this.doc.title = title;
    this.emit({ type: 'meta' });
    if (own) this.commitMetaEdit();
  }
  addEntry() {
    if (this.doc.entries.length >= MAX_ENTRIES) return;
    const from = metaOf(this.doc);
    this.doc.entries.push(nextEntry(this.doc));
    this.sel = this.doc.entries.length - 1;
    this.commit({ kind: 'meta', from, to: metaOf(this.doc) });
    this.emit({ type: 'meta' });
  }
  deleteEntry(i: number) {
    if (this.doc.entries.length <= 1) return;
    this.replaceDoc(removeEntry(this.doc, i));
  }
  select(i: number) {
    if (i < 0 || i >= this.doc.entries.length) return;
    this.sel = i;
    if (this.tool === 'erase' || this.tool === 'pick') this.tool = 'pen';
    this.emit({ type: 'ui' });
  }
  setTool(t: Tool) { this.tool = t; this.emit({ type: 'ui' }); }
  setMirror(m: MirrorMode) { this.mirror = m; this.emit({ type: 'ui' }); }

  /* ---------- whole document ---------- */
  replaceDoc(doc: Doc, record = true) {
    this.endStroke();
    this.metaFrom = null;
    const from = this.doc;
    this.doc = doc;
    this.sel = Math.min(this.sel, doc.entries.length - 1);
    if (record) this.commit({ kind: 'doc', from, to: cloneDoc(doc) });
    else { this.history.clear(); this.emit({ type: 'ui' }); }
    this.emit({ type: 'doc' });
  }

  /* ---------- undo / redo ---------- */
  undo() { this.endStroke(); this.commitMetaEdit(); this.apply(this.history.undo(), 'from'); }
  redo() { this.endStroke(); this.commitMetaEdit(); this.apply(this.history.redo(), 'to'); }
  private apply(c: Change | undefined, side: 'from' | 'to') {
    if (!c) return;
    if (c.kind === 'cells') {
      const vals = c[side];
      c.idx.forEach((i, k) => (this.doc.cells[i] = vals[k]));
      this.emit({ type: 'cells', idx: c.idx });
    } else if (c.kind === 'meta') {
      const m = c[side];
      this.doc.title = m.title;
      this.doc.entries = m.entries.map((e) => ({ ...e }));
      this.emit({ type: 'meta' });
    } else {
      this.doc = cloneDoc(c[side]);
      this.emit({ type: 'doc' });
    }
    this.sel = Math.min(this.sel, this.doc.entries.length - 1);
    this.emit({ type: 'ui' });
  }
}
