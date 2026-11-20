import { describe, expect, it } from 'vitest';
import { fitRows, floodRegion, line, mirrored } from '../../src/geometry';

describe('mirrored', () => {
  it('returns 1, 2 or 4 cells', () => {
    expect(mirrored(0, 10, 6, 'none')).toEqual([0]);
    expect(mirrored(0, 10, 6, 'h').sort((a, b) => a - b)).toEqual([0, 9]);
    expect(mirrored(0, 10, 6, 'v').sort((a, b) => a - b)).toEqual([0, 50]);
    expect(mirrored(0, 10, 6, 'both').sort((a, b) => a - b)).toEqual([0, 9, 50, 59]);
  });
  it('does not duplicate the centre column of odd widths', () => {
    expect(mirrored(2, 5, 5, 'h')).toEqual([2]);
  });
});

describe('line', () => {
  it('fills gaps between distant cells', () => {
    expect(line(0, 4, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(line(0, 33, 10)).toEqual([0, 11, 22, 33]);
    expect(line(5, 5, 10)).toEqual([5]);
  });
  it('is contiguous (8-connected) for any slope', () => {
    const pts = line(3, 10 * 7 + 9, 10);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      expect(Math.abs((a % 10) - (b % 10))).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(a / 10) - Math.floor(b / 10))).toBeLessThanOrEqual(1);
    }
  });
});

describe('floodRegion', () => {
  it('stays inside a closed region', () => {
    // 5×5 with a wall in column 2
    const cells = Array.from({ length: 25 }, (_, i) => (i % 5 === 2 ? 0 : -1));
    const r = floodRegion(cells, 5, 5, 0);
    expect(r.length).toBe(10);
    expect(r.every((i) => i % 5 < 2)).toBe(true);
  });
});

describe('fitRows', () => {
  it('matches the original algorithm', () => {
    const rows = fitRows(50, 20, 1);
    expect(rows.map((r) => r.n)).toEqual([1, 2]);
    expect(rows[1]).toEqual({ n: 2, gap: 3, left: 3, right: 4 });
    expect(rows.every((r) => r.n * 20 + (r.n - 1) * r.gap + r.left + r.right === 50)).toBe(true);
  });
  it('returns nothing when the design does not fit', () => {
    expect(fitRows(10, 20, 1)).toEqual([]);
    expect(fitRows(10, 0, 1)).toEqual([]);
  });
});
