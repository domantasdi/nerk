import { describe, expect, it } from 'vitest';
import { FormatError, fileName, parseDoc, serialize } from '../../src/format';
import { blankDoc, samplePattern } from '../../src/model';

const v1 = () => ({ title: 'Senas', entries: [{ color: '#c62828', sym: '✕', desc: 'Raudona' }, { color: '#1565C0', sym: 'X', desc: '' }], cells: Array(900).fill(-1).map((_, i) => (i === 0 ? 1 : i === 1 ? 0 : -1)), sel: 1 });

describe('parseDoc', () => {
  it('migrates v1 files (30×30, unicode symbols)', () => {
    const d = parseDoc(v1());
    expect([d.width, d.height]).toEqual([30, 30]);
    expect(d.entries.map((e) => e.sym)).toEqual(['cross', 'x-box']);
    expect(d.entries[1].color).toBe('#1565c0');
    expect([d.cells[0], d.cells[1], d.cells[2]]).toEqual([1, 0, -1]);
  });
  it('round-trips v2', () => {
    const d = samplePattern('Snaigė', 'Raudona');
    const back = parseDoc(JSON.parse(JSON.stringify(serialize(d))));
    expect(back.title).toBe('Snaigė');
    expect(Array.from(back.cells)).toEqual(Array.from(d.cells));
  });
  it('accepts non-square sizes', () => {
    const d = blankDoc(40, 12);
    expect(parseDoc(serialize(d)).cells.length).toBe(480);
  });
  it.each([
    ['HTML in colour', (o: any) => (o.entries[0].color = '"><img src=x onerror=alert(1)>')],
    ['named colour', (o: any) => (o.entries[0].color = 'red')],
    ['unknown symbol', (o: any) => (o.entries[0].sym = '<b>')],
    ['cell out of range', (o: any) => (o.cells[5] = 7)],
    ['fractional cell', (o: any) => (o.cells[5] = 0.5)],
    ['wrong cell count', (o: any) => o.cells.pop()],
    ['no entries', (o: any) => (o.entries = [])],
    ['entry not object', (o: any) => (o.entries[0] = 'x')],
    ['description not text', (o: any) => (o.entries[0].desc = { a: 1 })],
  ])('rejects %s', (_, mutate) => {
    const o = v1();
    mutate(o);
    expect(() => parseDoc(o)).toThrow(FormatError);
  });
  it('rejects bad v2 sizes and versions', () => {
    const s = serialize(blankDoc(10, 10)) as any;
    expect(() => parseDoc({ ...s, width: 1000 })).toThrow(FormatError);
    expect(() => parseDoc({ ...s, version: 99 })).toThrow(FormatError);
    expect(() => parseDoc(null)).toThrow(FormatError);
  });
  it('truncates over-long text', () => {
    const o = v1();
    o.title = 'a'.repeat(500);
    expect(parseDoc(o).title.length).toBe(120);
  });
});

describe('fileName', () => {
  it('transliterates Lithuanian letters and strips the rest', () => {
    expect(fileName('Snaigė (pavyzdys)/../x', 'json', 'rastas')).toBe('Snaige-pavyzdysx.json');
    expect(fileName('Žąsų šokis', 'pdf', 'rastas')).toBe('Zasu-sokis.pdf');
    expect(fileName('***', 'pdf', 'rastas')).toBe('rastas.pdf');
  });
});
