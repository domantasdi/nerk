import { describe, expect, it } from 'vitest';
import { blankDoc, samplePattern } from '../../src/model';
import { decodeShare, encodeShare, fingerprint, rle, unrle } from '../../src/share';

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('rle', () => {
  it('round-trips', () => {
    const cells = [-1, -1, -1, 0, 0, 1, -1, 2, 2, 2];
    expect(rle(cells)).toBe('0x3,1x2,2,0,3x3');
    expect(unrle(rle(cells), cells.length)).toEqual(cells);
  });
  it('refuses more cells than the grid holds (no huge allocations)', () => {
    expect(() => unrle('0x999999', 900)).toThrow();
    expect(() => unrle('abc', 900)).toThrow();
  });
});

describe('share links', () => {
  it('round-trips a pattern with Lithuanian text, compressed', async () => {
    const d = samplePattern('Snaigė ąčęėįšųūž', 'Raudona – DMC 321');
    const hash = await encodeShare(d);
    expect(hash.startsWith('p=1.')).toBe(true);
    expect(hash.length).toBeLessThan(400); // the 30×30 sample is ~320 characters
    const back = (await decodeShare('#' + hash))!;
    expect(back.title).toBe(d.title);
    expect(back.entries).toEqual(d.entries);
    expect(Array.from(back.cells)).toEqual(Array.from(d.cells));
  });
  it('keeps a full 200×200 pattern within a usable length', async () => {
    const d = blankDoc(200, 200);
    d.cells.forEach((_, i) => (d.cells[i] = (i * 7) % 13 < 5 ? 0 : -1));
    const hash = await encodeShare(d);
    expect(hash.length).toBeLessThan(20_000);
    expect(Array.from((await decodeShare(hash))!.cells)).toEqual(Array.from(d.cells));
  });
  it('accepts uncompressed links', async () => {
    const json = JSON.stringify({ v: 2, t: 'A', w: 5, h: 5, e: [['#ff0000', 'dot', '']], c: '0x24,1' });
    const d = (await decodeShare('#p=0.' + b64(json)))!;
    expect(d.cells[24]).toBe(0);
  });
  it('ignores unrelated hashes and rejects broken or malicious ones', async () => {
    expect(await decodeShare('#section-2')).toBeNull();
    await expect(decodeShare('#p=1.not*base64')).rejects.toThrow();
    await expect(decodeShare('#p=1.' + 'A'.repeat(40))).rejects.toThrow();
    const evil = JSON.stringify({ v: 2, t: 'x', w: 5, h: 5, e: [['"><img src=x onerror=alert(1)>', 'dot', '']], c: '0x25' });
    await expect(decodeShare('#p=0.' + b64(evil))).rejects.toThrow();
    const big = JSON.stringify({ v: 2, t: 'x', w: 5000, h: 5000, e: [['#ff0000', 'dot', '']], c: '0x25' });
    await expect(decodeShare('#p=0.' + b64(big))).rejects.toThrow();
  });
  it('fingerprints are stable and distinct', () => {
    expect(fingerprint('p=1.abc')).toBe(fingerprint('p=1.abc'));
    expect(fingerprint('p=1.abc')).not.toBe(fingerprint('p=1.abd'));
  });
});
