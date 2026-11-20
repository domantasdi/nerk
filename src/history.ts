/**
 * Undo/redo with compact changes:
 *  - 'cells': only the touched cells (index, before, after) — strokes and fills
 *  - 'meta':  title + palette (small)
 *  - 'doc':   full snapshot, only for structural edits (resize, open, new, delete colour)
 */
import type { Doc, Entry } from './model';

export interface Meta { title: string; entries: Entry[] }

export type Change =
  | { kind: 'cells'; idx: Int32Array; from: Int16Array; to: Int16Array }
  | { kind: 'meta'; from: Meta; to: Meta }
  | { kind: 'doc'; from: Doc; to: Doc };

export const metaOf = (d: Doc): Meta => ({ title: d.title, entries: d.entries.map((e) => ({ ...e })) });
export const sameMeta = (a: Meta, b: Meta) => JSON.stringify(a) === JSON.stringify(b);

export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  constructor(private limit = 500) {}

  push(c: Change): void {
    this.undoStack.push(c);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; }

  undo(): Change | undefined {
    const c = this.undoStack.pop();
    if (c) this.redoStack.push(c);
    return c;
  }
  redo(): Change | undefined {
    const c = this.redoStack.pop();
    if (c) this.undoStack.push(c);
    return c;
  }
}

/** Collects cell edits during one stroke/fill; first "before" value per cell wins. */
export class CellRecorder {
  private before = new Map<number, number>();
  record(i: number, prev: number) { if (!this.before.has(i)) this.before.set(i, prev); }
  /** Builds the change against the current cells, or null if nothing actually changed. */
  finish(cells: Int16Array): Change | null {
    const idx: number[] = [], from: number[] = [], to: number[] = [];
    for (const [i, b] of this.before) if (cells[i] !== b) { idx.push(i); from.push(b); to.push(cells[i]); }
    return idx.length ? { kind: 'cells', idx: Int32Array.from(idx), from: Int16Array.from(from), to: Int16Array.from(to) } : null;
  }
}
