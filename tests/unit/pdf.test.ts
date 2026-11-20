import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { blankDoc, samplePattern } from '../../src/model';
import { buildPdf, planPages, spans } from '../../src/pdf';

describe('page planning', () => {
  it('fits 30×30 with the legend on one page', () => {
    const p = planPages(30, 30, 3);
    expect(p.tiles.length).toBe(1);
    expect(p.legendWithGrid).toBe(true);
    expect(p.cell).toBeCloseTo(5.4);
  });
  it('tiles big grids with overlap', () => {
    const p = planPages(200, 200, 10);
    expect(p.tiles.length).toBeGreaterThan(4);
    expect(p.cover).toBe(true);
    const cols = [...new Set(p.tiles.map((t) => `${t.c0}-${t.c1}`))];
    expect(cols.length).toBeGreaterThan(1);
  });
  it('spans cover everything with the requested overlap', () => {
    for (const [total, per] of [[100, 44], [200, 62], [45, 44], [44, 44]]) {
      const s = spans(total, per, 2);
      expect(s[0][0]).toBe(0);
      expect(s.at(-1)![1]).toBe(total);
      s.forEach(([a, b], k) => {
        expect(b - a).toBeLessThanOrEqual(per);
        if (k) expect(s[k - 1][1] - a).toBeGreaterThanOrEqual(2);
      });
    }
  });
});

describe('buildPdf', () => {
  it('creates a one-page PDF with Lithuanian text', async () => {
    const d = samplePattern('Snaigė ąčęėįšųūž', 'Raudona');
    const bytes = await buildPdf(d, 'both', 'lt');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Snaigė ąčęėįšųūž');
  });
  it('creates overview + tiled pages for 150×120', async () => {
    const d = blankDoc(150, 120, 'Didelis', 'x');
    d.cells.fill(0, 0, 3000);
    const pdf = await PDFDocument.load(await buildPdf(d, 'sym', 'en'));
    const plan = planPages(150, 120, 1);
    expect(pdf.getPageCount()).toBe(plan.tiles.length + 1);
  });
});
