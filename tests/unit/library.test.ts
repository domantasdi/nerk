import { describe, expect, it } from 'vitest';
import { AutoSaver, KvBackend, Library, MemoryKV } from '../../src/library';
import { blankDoc, samplePattern } from '../../src/model';

const mk = () => new Library(new KvBackend(new MemoryKV(), 'memory'), () => 'data:image/png;base64,AA').load();

describe('Library', () => {
  it('creates, lists newest first, reads back and removes', async () => {
    const lib = await mk();
    const a = await lib.create(samplePattern('A', 'x'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await lib.create(blankDoc(40, 20, 'B'));
    expect(lib.list().map((m) => m.title)).toEqual(['B', 'A']);
    expect(lib.meta(a.id)!.stitches).toBe(164);
    expect((await lib.get(b.id))!.width).toBe(40);
    await lib.remove(a.id);
    expect(lib.list().length).toBe(1);
    expect(await lib.get(a.id)).toBeNull();
  });
  it('keeps created time and source across saves; restore puts a pattern back unchanged', async () => {
    const lib = await mk();
    const m = await lib.create(blankDoc(10, 10, 'X'), { source: 'abc' });
    const again = await lib.save(m.id, blankDoc(10, 10, 'X2'));
    expect(again.created).toBe(m.created);
    expect(again.source).toBe('abc');
    expect(lib.findBySource('abc')!.id).toBe(m.id);
    const doc = (await lib.get(m.id))!;
    await lib.remove(m.id);
    await lib.restore(again, doc);
    expect(lib.meta(m.id)).toEqual(again);
  });
  it('a reloaded library sees the same data', async () => {
    const kv = new MemoryKV();
    const lib = await new Library(new KvBackend(kv, 'memory')).load();
    const m = await lib.create(blankDoc(10, 10, 'Persist'));
    const lib2 = await new Library(new KvBackend(kv, 'memory')).load();
    expect(lib2.meta(m.id)!.title).toBe('Persist');
  });
  it('skips corrupted entries instead of crashing', async () => {
    const kv = new MemoryKV();
    const lib = await new Library(new KvBackend(kv, 'memory')).load();
    const m = await lib.create(blankDoc(10, 10));
    kv.setItem('stitch-lib-doc-' + m.id, JSON.stringify({ version: 2, cells: 'nope' }));
    expect(await lib.get(m.id)).toBeNull();
  });
});

describe('AutoSaver', () => {
  it('saves a snapshot: edits made after flush() starts are not mixed in', async () => {
    const lib = await mk();
    const doc = blankDoc(10, 10, 'S');
    const { id } = await lib.create(doc);
    const states: string[] = [];
    const saver = new AutoSaver(lib, () => ({ id, doc }), (s) => states.push(s), 10);
    doc.cells[0] = 0;
    saver.schedule();
    const p = saver.flush();
    doc.cells[1] = 0; // edit while the save is in flight
    await p;
    const stored = (await lib.get(id))!;
    expect([stored.cells[0], stored.cells[1]]).toEqual([0, -1]);
    expect(states).toEqual(['pending', 'saved']);
  });
  it('does nothing when there are no changes', async () => {
    const lib = await mk();
    const states: string[] = [];
    const saver = new AutoSaver(lib, () => ({ id: 'x', doc: blankDoc() }), (s) => states.push(s));
    await saver.flush();
    expect(states).toEqual([]);
  });
});
