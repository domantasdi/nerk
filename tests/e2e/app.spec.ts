import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Win = { __store: any; __view: any };

/** Client coordinates of a cell's centre. */
async function cellXY(page: Page, r: number, c: number) {
  return page.evaluate(([r, c]) => {
    const v = (window as unknown as Win).__view, rect = v.canvas.getBoundingClientRect();
    return { x: rect.left + v.gutter + c * v.cell + v.cell / 2, y: rect.top + v.gutter + r * v.cell + v.cell / 2 };
  }, [r, c]);
}
const cells = (page: Page) => page.evaluate(() => Array.from((window as unknown as Win).__store.doc.cells as Int16Array));
const cell = async (page: Page, r: number, c: number) => (await cells(page))[r * 30 + c];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.querySelectorAll('details.panel').forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await page.click('#new');
});

test('a fast drag paints every cell in between, as one undo step', async ({ page }) => {
  const a = await cellXY(page, 2, 2), b = await cellXY(page, 2, 20);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 1 }); // one jump across 18 cells
  await page.mouse.up();
  const row = (await cells(page)).slice(2 * 30 + 2, 2 * 30 + 21);
  expect(row.every((v) => v === 0)).toBe(true);
  await page.click('#undo');
  expect((await cells(page)).every((v) => v === -1)).toBe(true);
  await page.click('#redo');
  expect(await cell(page, 2, 11)).toBe(0);
});

test('right button erases; middle button does nothing', async ({ page }) => {
  const p = await cellXY(page, 5, 5);
  await page.mouse.click(p.x, p.y);
  expect(await cell(page, 5, 5)).toBe(0);
  await page.mouse.click(p.x, p.y, { button: 'middle' });
  expect(await cell(page, 5, 5)).toBe(0);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  expect(await cell(page, 5, 5)).toBe(-1);
});

test('focusing the title or a palette field does not wipe redo', async ({ page }) => {
  const p = await cellXY(page, 1, 1);
  await page.mouse.click(p.x, p.y);
  await page.click('#undo');
  await expect(page.locator('#redo')).toBeEnabled();
  await page.click('#title');
  await page.click('.ent input[type=text]');
  await page.locator('#grid').focus();
  await expect(page.locator('#redo')).toBeEnabled();
});

test('typing a title is a single undo step', async ({ page }) => {
  await page.fill('#title', '');
  await page.locator('#title').pressSequentially('Gėlės');
  await page.locator('#grid').focus();
  await page.click('#undo');
  await expect(page.locator('#title')).toHaveValue('Kryželio raštas');
});

test('keyboard drawing', async ({ page }) => {
  await page.locator('#grid').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  expect(await cell(page, 1, 1)).toBe(0);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await cell(page, 1, 2)).toBe(0);
  await expect(page.locator('#live')).toContainText('Eilutė 29, stulpelis 3');
  await page.keyboard.press('Delete');
  expect(await cell(page, 1, 2)).toBe(-1);
});

test('a crafted pattern file is rejected and nothing is injected', async ({ page }) => {
  const evil = { entries: [{ color: '"><img src=x onerror="window.__pwned=1">', sym: '✕', desc: '<img src=x onerror="window.__pwned=1">' }], cells: Array(900).fill(-1) };
  await page.setInputFiles('#file', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evil)) });
  await expect(page.locator('#toast')).toContainText('color');
  // a valid colour but HTML in the description is shown as text
  evil.entries[0].color = '#00ff00';
  await page.setInputFiles('#file', { name: 'evil2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evil)) });
  await expect(page.locator('#legend')).toContainText('<img');
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await page.locator('#legend img, #pal img').count()).toBe(0);
});

test('save → open round trip, and v1 files are migrated', async ({ page }) => {
  const p = await cellXY(page, 3, 4);
  await page.mouse.click(p.x, p.y);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const saved = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(saved.version).toBe(2);
  expect(saved.cells[3 * 30 + 4]).toBe(0);

  const v1 = { title: 'Senas', entries: [{ color: '#c62828', sym: '♥', desc: 'A' }], cells: Array(900).fill(-1).map((_, i) => (i === 31 ? 0 : -1)), sel: 0 };
  await page.setInputFiles('#file', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  await expect(page.locator('#title')).toHaveValue('Senas');
  expect(await page.evaluate(() => (window as unknown as Win).__store.doc.entries[0].sym)).toBe('heart');
});

test('work saved by the original app (v1 localStorage) is picked up', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('stitch-pattern-v1', JSON.stringify({ title: 'Iš seno', entries: [{ color: '#2e7d32', sym: '★', desc: 'Žalia' }], cells: Array(900).fill(0), sel: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#title')).toHaveValue('Iš seno');
  await expect(page.locator('#legend')).toContainText('Žalia');
});

test('resize keeps the design centred and is undoable', async ({ page }) => {
  const p = await cellXY(page, 15, 15);
  await page.mouse.click(p.x, p.y);
  await page.fill('#gw', '50');
  await page.fill('#gh', '40');
  await page.click('#sizeform button[type=submit]');
  await expect(page.locator('#dims')).toHaveText('50 × 40');
  const d = await page.evaluate(() => { const s = (window as unknown as Win).__store.doc; return { w: s.width, v: s.cells[20 * 50 + 25] }; });
  expect(d).toEqual({ w: 50, v: 0 });
  await page.click('#undo');
  await expect(page.locator('#dims')).toHaveText('30 × 30');
});

test('PDF download is a real PDF', async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pdfdl')]);
  expect(dl.suggestedFilename()).toBe('Kryzelio-rastas.pdf');
  expect(readFileSync((await dl.path())!).subarray(0, 5).toString()).toBe('%PDF-');
});

test('language switch', async ({ page }) => {
  await page.selectOption('#lang', 'en');
  await expect(page.locator('[data-tool=pen] span')).toHaveText('Draw');
  await page.selectOption('#lang', 'lt');
  await expect(page.locator('[data-tool=pen] span')).toHaveText('Piešti');
});

test('the built single file works offline from disk with no network requests', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const external: string[] = [];
  await ctx.route(/^https?:/, (route) => { external.push(route.request().url()); return route.abort(); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const file = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
  await page.goto('file://' + file);
  await expect(page.locator('[data-tool=pen] span')).toHaveText('Piešti');
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 12px Lato', 'ėįų'); })).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('hosted over http it installs a service worker and reloads offline', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  expect(await page.locator('link[rel=manifest]').count()).toBe(1);
  await page.reload(); // let the worker take control and cache the page
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-tool=pen] span')).toHaveText('Piešti');
  await ctx.close();
});

test('destructive actions offer Undo in a toast instead of a dialog', async ({ page }) => {
  const p = await cellXY(page, 4, 4);
  await page.mouse.click(p.x, p.y);
  await page.click('#clear');
  await expect(page.locator('#toast')).toBeVisible();
  expect(await cell(page, 4, 4)).toBe(-1);
  await page.locator('#toast .tact').click();
  expect(await cell(page, 4, 4)).toBe(0);
  await expect(page.locator('#toast')).toBeHidden();
});

test('tool, mirror, colour and zoom shortcuts', async ({ page }) => {
  await page.click('#add');
  await page.locator('#grid').focus();
  await page.keyboard.press('e');
  await expect(page.locator('[data-tool=erase]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('g');
  await expect(page.locator('[data-tool=fill]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('b');
  await expect(page.locator('[data-tool=pen]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('m');
  await expect(page.locator('[data-m=h]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('1');
  expect(await page.evaluate(() => (window as unknown as Win).__store.sel)).toBe(0);
  const before = await page.evaluate(() => (window as unknown as Win).__view.cell);
  await page.keyboard.press('+');
  expect(await page.evaluate(() => (window as unknown as Win).__view.cell)).toBeGreaterThan(before);
  await page.keyboard.press('0');
  expect(await page.evaluate(() => (window as unknown as Win).__view.cell)).toBe(before);
  // letters typed into a text field are not shortcuts
  await page.click('.ent input[type=text]');
  await page.keyboard.type('e');
  await expect(page.locator('[data-tool=pen]')).toHaveAttribute('aria-pressed', 'true');
});

test('eyedropper and Alt+click pick a colour from the grid', async ({ page }) => {
  await page.click('#add'); // colour 2 selected
  await page.keyboard.press('Enter');
  const a = await cellXY(page, 3, 3), b = await cellXY(page, 6, 6);
  await page.mouse.click(a.x, a.y); // colour 2 at (3,3)
  await page.keyboard.press('1');
  await page.mouse.click(b.x, b.y); // colour 1 at (6,6)
  await page.keyboard.down('Alt');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => (window as unknown as Win).__store.sel)).toBe(1);
  await page.click('[data-tool=pick]');
  await page.mouse.click(b.x, b.y);
  expect(await page.evaluate(() => (window as unknown as Win).__store.sel)).toBe(0);
  await expect(page.locator('[data-tool=pen]')).toHaveAttribute('aria-pressed', 'true');
  expect(await cell(page, 6, 6)).toBe(0); // picking does not paint
});

test('symbol picker: keyboard choice and duplicate warning', async ({ page }) => {
  await page.click('#add');
  await page.click('.ent:nth-child(2) .symsel');
  await expect(page.locator('.sympop')).toBeVisible();
  await expect(page.locator('.symbtn.used')).toHaveCount(1); // the cross used by colour 1
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sympop')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__store.doc.entries[1].sym)).toBe('square');
  // choose the same symbol as colour 1 → warning shown
  await page.click('.ent:nth-child(2) .symsel');
  await page.locator('.symbtn[data-id=cross]').click();
  await expect(page.locator('.ent:nth-child(2) .dup')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ent:nth-child(2) .dup')).toBeHidden();
  await page.click('.ent:nth-child(2) .symsel');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sympop')).toHaveCount(0);
  await expect(page.locator('.ent:nth-child(2) .symsel')).toBeFocused();
});

test('help dialog opens with ? and closes with Escape', async ({ page }) => {
  await page.locator('#grid').focus();
  await page.keyboard.press('?');
  await expect(page.locator('#help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  await page.click('#helpbtn');
  await expect(page.locator('#help')).toBeVisible();
});

test('autosave indicator and coordinates in the status bar', async ({ page }) => {
  const p = await cellXY(page, 0, 0);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#coords')).toHaveText('Eil. 30, stulp. 1');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#savestate')).toContainText('Išsaugota');
});

test('Ctrl+wheel zooms around the pointer', async ({ page }) => {
  // Once the grid is larger than the view, the cell under the pointer must stay put.
  await page.locator('#grid').focus();
  for (let k = 0; k < 3; k++) await page.keyboard.press('+');
  const p = await cellXY(page, 12, 13);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  const after = await page.evaluate(([x, y]) => (window as unknown as Win).__view.cellAt(x, y), [p.x, p.y]);
  expect(after).toBe(12 * 30 + 13); // same cell still under the pointer
});
