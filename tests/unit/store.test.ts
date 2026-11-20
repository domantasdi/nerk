import { describe, expect, it } from 'vitest';
import { blankDoc, resizeDoc } from '../../src/model';
import { Store } from '../../src/store';

const mk = () => new Store(blankDoc(10, 10, 'T', 'Red'));

describe('Store history', () => {
  it('records a stroke as one undo step and only the changed cells', () => {
    const s = mk();
    s.beginStroke();
    s.paintMany([0, 1, 2, 1], 0);
    s.endStroke();
    expect(Array.from(s.doc.cells.slice(0, 3))).toEqual([0, 0, 0]);
    s.undo();
    expect(s.doc.cells.every((v) => v === -1)).toBe(true);
    s.redo();
    expect(s.doc.cells[2]).toBe(0);
  });
  it('does not record no-op strokes or fills', () => {
    const s = mk();
    s.paint(0, -1);
    s.fillAt(0, -1);
    expect(s.history.canUndo).toBe(false);
  });
  it('focusing a field without changing it keeps redo history (bug fix)', () => {
    const s = mk();
    s.paint(0, 0);
    s.undo();
    expect(s.history.canRedo).toBe(true);
    s.beginMetaEdit(); // e.g. focus title
    s.commitMetaEdit(); // blur, nothing changed
    expect(s.history.canRedo).toBe(true);
  });
  it('coalesces typing into one step', () => {
    const s = mk();
    s.beginMetaEdit();
    s.setTitle('A');
    s.setTitle('AB');
    s.commitMetaEdit();
    s.undo();
    expect(s.doc.title).toBe('T');
    expect(s.history.canUndo).toBe(false);
  });
  it('mirrors strokes', () => {
    const s = mk();
    s.setMirror('both');
    s.paint(0, 0);
    expect([0, 9, 90, 99].map((i) => s.doc.cells[i])).toEqual([0, 0, 0, 0]);
  });
  it('deleting a colour erases its stitches and is undoable', () => {
    const s = mk();
    s.addEntry();
    s.paint(0, 0);
    s.paint(1, 1);
    s.deleteEntry(0);
    expect([s.doc.cells[0], s.doc.cells[1]]).toEqual([-1, 0]);
    s.undo();
    expect([s.doc.cells[0], s.doc.cells[1]]).toEqual([0, 1]);
    expect(s.doc.entries.length).toBe(2);
  });
  it('flood fill respects mirror and is one step', () => {
    const s = mk();
    s.fillAt(55, 0);
    expect(s.doc.cells.every((v) => v === 0)).toBe(true);
    s.undo();
    expect(s.doc.cells.every((v) => v === -1)).toBe(true);
  });
});

describe('resizeDoc', () => {
  it('keeps the design centred and reports lost stitches', () => {
    const d = blankDoc(10, 10);
    d.cells[5 * 10 + 5] = 0;
    d.cells[0] = 0;
    const { doc, lost } = resizeDoc(d, 6, 6);
    expect(lost).toBe(1);
    expect(doc.cells[3 * 6 + 3]).toBe(0);
    const grown = resizeDoc(d, 20, 14).doc;
    expect(grown.cells[(5 + 2) * 20 + 5 + 5]).toBe(0);
  });
});
