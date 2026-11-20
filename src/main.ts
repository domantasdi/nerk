import { loadPageFonts } from './fonts';
import { FormatError, fileName, parseDoc, serialize } from './format';
import { fitRows, line } from './geometry';
import { LANGS, applyI18n, getLang, setLang, t, type Lang } from './i18n';
import { EMPTY, MAX_ENTRIES, MAX_SIZE, MIN_SIZE, bbox, blankDoc, counts, resizeDoc, samplePattern, textOn, type Doc, type MirrorMode } from './model';
import { buildPdf, type PrintMode } from './pdf';
import { FIT_KEY, flush, loadSaved, readJSON, scheduleSave, writeJSON } from './storage';
import { Store, type Tool } from './store';
import { SYMBOLS, symbolSvg } from './symbols';
import { GridView } from './view';

/* ---------- tiny DOM helpers (no innerHTML with user data) ---------- */
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/* ---------- state ---------- */
const store = new Store(loadSaved() ?? samplePattern(t('sampleTitle'), t('sampleDesc')));
const canvas = $<HTMLCanvasElement>('#grid');
const view = new GridView(canvas, () => store.doc);
const wrap = $('#wrap');
const PMODE_KEY = 'stitch-pattern-pmode';
view.mode = (readJSON<PrintMode>(PMODE_KEY) ?? 'both') as PrintMode;
$<HTMLSelectElement>('#pmode').value = view.mode;

function notice(msg: string) {
  const n = $('#notice');
  n.textContent = msg;
  n.hidden = !msg;
}

/* ---------- palette (keyed in-place updates keep focus while typing) ---------- */
const pal = $<HTMLUListElement>('#pal');

function paletteRow(i: number): HTMLLIElement {
  const sel = h('select', { 'data-k': 'sym', 'aria-label': t('symbol') });
  for (const s of SYMBOLS) sel.append(h('option', { value: s.id }, s.label));
  return h('li', { class: 'ent', 'data-i': String(i) },
    h('button', { class: 'pick', type: 'button' }),
    h('input', { type: 'color', 'data-k': 'color', 'aria-label': t('colorPicker') }),
    sel,
    h('input', { type: 'text', 'data-k': 'desc', maxlength: '200', placeholder: t('descPlaceholder'), 'aria-label': t('descr') }),
    h('button', { class: 'x', type: 'button', 'data-del': '', 'aria-label': t('removeColor'), title: t('removeColor') }, '✕'),
    h('div', { class: 'cnt' }));
}

function renderPalette() {
  const d = store.doc, cnt = counts(d);
  if (pal.children.length !== d.entries.length) pal.replaceChildren(...d.entries.map((_, i) => paletteRow(i)));
  d.entries.forEach((e, i) => {
    const li = pal.children[i] as HTMLLIElement, active = document.activeElement;
    li.classList.toggle('sel', i === store.sel);
    const pick = li.querySelector<HTMLButtonElement>('.pick')!;
    pick.style.background = e.color;
    pick.replaceChildren(symbolSvg(e.sym, textOn(e.color), 20));
    pick.setAttribute('aria-pressed', String(i === store.sel));
    pick.setAttribute('aria-label', t('selectColor', { n: i + 1 }) + (e.desc ? ` – ${e.desc}` : ''));
    for (const inp of li.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]')) {
      const v = e[inp.dataset.k as 'color' | 'sym' | 'desc'];
      if (inp !== active && inp.value !== v) inp.value = v;
    }
    li.querySelector<HTMLButtonElement>('.x')!.disabled = d.entries.length <= 1;
    li.querySelector('.cnt')!.textContent = t('stitches', { n: cnt[i] });
  });
  $('#pc').textContent = `(${d.entries.length}/${MAX_ENTRIES})`;
  $<HTMLButtonElement>('#add').disabled = d.entries.length >= MAX_ENTRIES;
}

const entryIndex = (el: EventTarget | null) => Number((el as HTMLElement).closest<HTMLElement>('.ent')?.dataset.i ?? -1);
pal.addEventListener('click', (e) => {
  const target = e.target as HTMLElement, i = entryIndex(target);
  if (i < 0) return;
  if (target.closest('[data-del]')) store.deleteEntry(i);
  else if (target.closest('.pick')) store.select(i);
});
pal.addEventListener('focusin', (e) => {
  const k = (e.target as HTMLElement).dataset.k;
  if (k === 'color' || k === 'desc') store.beginMetaEdit();
  const i = entryIndex(e.target);
  if (i >= 0 && i !== store.sel) store.select(i);
});
pal.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement, k = el.dataset.k;
  if (k === 'color' || k === 'desc') store.updateEntry(entryIndex(el), { [k]: el.value });
});
pal.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement, k = el.dataset.k;
  if (k === 'sym') store.updateEntry(entryIndex(el), { sym: el.value });
  else store.commitMetaEdit();
});
pal.addEventListener('focusout', () => store.commitMetaEdit());
$('#add').onclick = () => {
  store.addEntry();
  (pal.lastElementChild?.querySelector('input[type=text]') as HTMLInputElement | null)?.focus();
};

/* ---------- legend + fabric fitting ---------- */
function renderLegend() {
  const d = store.doc, cnt = counts(d);
  $('#legend').replaceChildren(...d.entries.map((e, i) => {
    const sw = h('span', { class: 'lsw' });
    if (view.mode !== 'sym') sw.style.background = e.color;
    if (view.mode !== 'col') sw.append(symbolSvg(e.sym, view.mode === 'sym' ? '#222' : textOn(e.color), 16));
    return h('li', {}, sw, h('span', { class: 'd' }, e.desc || '—'), h('span', { class: 'muted' }, String(cnt[i])));
  }));
}

function fitTable(caption: string, rows: ReturnType<typeof fitRows>, a: string, b: string): HTMLTableElement {
  const tbl = h('table', { class: 'ft' }, h('caption', {}, caption));
  if (!rows.length) { tbl.append(h('tr', {}, h('td', {}, t('noFit')))); return tbl; }
  tbl.append(h('tr', {}, ...[t('copies'), t('gapBetween'), a, b].map((s) => h('th', {}, s))));
  rows.forEach((r, k) => tbl.append(h('tr', k === rows.length - 1 ? { class: 'best' } : {},
    ...[r.n, r.n > 1 ? r.gap : '–', r.left, r.right].map((v) => h('td', {}, String(v))))));
  return tbl;
}

function renderFit() {
  const b = bbox(store.doc), out = $('#fitout');
  if (!b) { $('#dsize').textContent = t('drawFirst'); out.replaceChildren(); return; }
  $('#dsize').innerHTML = t('designSize', { w: b.w, h: b.h }); // numbers only
  const W = Math.max(0, +$<HTMLInputElement>('#fw').value || 0), H = Math.max(0, +$<HTMLInputElement>('#fh').value || 0);
  const g = Math.max(0, +$<HTMLInputElement>('#fg').value || 0);
  const x = fitRows(W, b.w, g), y = fitRows(H, b.h, g);
  out.replaceChildren(fitTable(t('intoWidth', { n: W }), x, t('left'), t('right')), fitTable(t('intoHeight', { n: H }), y, t('top'), t('bottom')));
  if (x.length && y.length) {
    const sum = h('div', { class: 'fitsum' });
    sum.innerHTML = t('fitMax', { x: x.at(-1)!.n, y: y.at(-1)!.n, t: x.at(-1)!.n * y.at(-1)!.n }); // numbers only
    out.append(sum);
  }
}
const fitIds = ['#fw', '#fh', '#fg'];
const savedFit = readJSON<string[]>(FIT_KEY);
if (Array.isArray(savedFit)) fitIds.forEach((id, k) => { if (/^\d{1,4}$/.test(String(savedFit[k]))) $<HTMLInputElement>(id).value = String(savedFit[k]); });
fitIds.forEach((id) => $(id).addEventListener('input', () => { renderFit(); writeJSON(FIT_KEY, fitIds.map((i) => $<HTMLInputElement>(i).value)); }));

/* ---------- UI state ---------- */
function renderUi() {
  document.querySelectorAll<HTMLElement>('#tools .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)));
  document.querySelectorAll<HTMLElement>('#mirror .btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === store.mirror)));
  $<HTMLButtonElement>('#undo').disabled = !store.history.canUndo;
  $<HTMLButtonElement>('#redo').disabled = !store.history.canRedo;
  pal.querySelectorAll('.ent').forEach((li, i) => {
    li.classList.toggle('sel', i === store.sel);
    li.querySelector('.pick')?.setAttribute('aria-pressed', String(i === store.sel));
  });
  view.mirror = store.mirror;
  view.invalidate();
}
function renderMeta() {
  const title = $<HTMLInputElement>('#title');
  if (document.activeElement !== title) title.value = store.doc.title;
  renderPalette();
  renderLegend();
  view.invalidate();
}
function renderDoc() {
  const d = store.doc;
  $('#dims').textContent = `${d.width} × ${d.height}`;
  $<HTMLInputElement>('#gw').value = String(d.width);
  $<HTMLInputElement>('#gh').value = String(d.height);
  view.cursor = Math.min(view.cursor, d.cells.length - 1);
  renderMeta();
  renderFit();
}

let statsFrame = 0;
let lastSize = '';
store.on((ev) => {
  if (ev.type === 'cells') {
    view.invalidate();
    if (!statsFrame) statsFrame = requestAnimationFrame(() => { statsFrame = 0; renderPalette(); renderLegend(); renderFit(); });
  } else if (ev.type === 'meta') renderMeta();
  else if (ev.type === 'doc') {
    renderDoc();
    const size = `${store.doc.width}x${store.doc.height}`;
    if (size !== lastSize) { lastSize = size; fitZoom(); }
  } else renderUi();
  if (ev.type !== 'ui') scheduleSave(() => store.doc);
});

/* ---------- title ---------- */
const titleEl = $<HTMLInputElement>('#title');
titleEl.addEventListener('focus', () => store.beginMetaEdit());
titleEl.addEventListener('input', () => store.setTitle(titleEl.value));
titleEl.addEventListener('blur', () => store.commitMetaEdit());

/* ---------- drawing with mouse / pen / touch ---------- */
let painting = false, last = -1, paintVal = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  const i = view.cellAt(e.clientX, e.clientY);
  if (i < 0) return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  view.cursor = i;
  paintVal = e.button === 2 || store.tool === 'erase' ? EMPTY : store.sel;
  if (store.tool === 'fill' && e.button === 0) { store.fillAt(i, paintVal); return; }
  canvas.setPointerCapture(e.pointerId);
  painting = true;
  last = i;
  store.beginStroke();
  store.paint(i, paintVal);
});
canvas.addEventListener('pointermove', (e) => {
  const i = view.cellAt(e.clientX, e.clientY);
  if (i !== view.hover) { view.hover = i; view.invalidate(); }
  if (!painting || i < 0 || i === last) return;
  store.paintMany(last >= 0 ? line(last, i, store.doc.width) : [i], paintVal);
  last = i;
});
const stop = () => { if (painting) { painting = false; store.endStroke(); } };
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);
canvas.addEventListener('pointerleave', () => { if (view.hover >= 0) { view.hover = -1; view.invalidate(); } });

/* ---------- keyboard drawing ---------- */
const live = $('#live');
function announce() {
  const d = store.doc, i = view.cursor, v = d.cells[i];
  live.textContent = t('cellAt', { r: d.height - Math.floor(i / d.width), c: (i % d.width) + 1, v: v < 0 ? t('cellEmpty') : d.entries[v].desc || String(v + 1) });
}
canvas.addEventListener('focus', () => { view.showCursor = true; view.invalidate(); announce(); });
canvas.addEventListener('blur', () => { view.showCursor = false; view.invalidate(); });
canvas.addEventListener('keydown', (e) => {
  const d = store.doc, r = Math.floor(view.cursor / d.width), c = view.cursor % d.width;
  const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const drawVal = store.tool === 'erase' ? EMPTY : store.sel;
  if (moves[e.key]) {
    const [dr, dc] = moves[e.key], nr = Math.min(d.height - 1, Math.max(0, r + dr)), nc = Math.min(d.width - 1, Math.max(0, c + dc));
    view.cursor = nr * d.width + nc;
    if (e.shiftKey) store.paint(view.cursor, drawVal);
  } else if (e.key === ' ' || e.key === 'Enter') store.paint(view.cursor, drawVal);
  else if (e.key === 'Delete' || e.key === 'Backspace') store.paint(view.cursor, EMPTY);
  else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) store.fillAt(view.cursor, drawVal);
  else if (/^[1-9]$/.test(e.key)) store.select(+e.key - 1);
  else return;
  e.preventDefault();
  view.invalidate();
  announce();
});

/* ---------- zoom ---------- */
function fitZoom() { view.fitTo(wrap.clientWidth - 8, wrap.clientHeight - 8); }
$('#zin').onclick = () => view.setZoom(view.cell * 1.25);
$('#zout').onclick = () => view.setZoom(view.cell / 1.25);
$('#zfit').onclick = fitZoom;
wrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  view.setZoom(view.cell * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
}, { passive: false });

/* ---------- controls ---------- */
document.querySelectorAll<HTMLElement>('#tools .btn').forEach((b) => (b.onclick = () => store.setTool(b.dataset.tool as Tool)));
document.querySelectorAll<HTMLElement>('#mirror .btn').forEach((b) => (b.onclick = () => store.setMirror(b.dataset.m as MirrorMode)));
$('#undo').onclick = () => store.undo();
$('#redo').onclick = () => store.redo();
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); store.redo(); }
});
$('#clear').onclick = () => {
  if (store.doc.cells.every((v) => v < 0)) return;
  store.replaceDoc({ ...store.doc, entries: store.doc.entries.map((e) => ({ ...e })), cells: new Int16Array(store.doc.cells.length).fill(EMPTY) });
};
$('#new').onclick = () => store.replaceDoc(blankDoc(store.doc.width, store.doc.height, t('defaultTitle'), t('firstDesc')));

$<HTMLFormElement>('#sizeform').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = Math.round(+$<HTMLInputElement>('#gw').value), hgt = Math.round(+$<HTMLInputElement>('#gh').value);
  if (!(w >= MIN_SIZE && w <= MAX_SIZE && hgt >= MIN_SIZE && hgt <= MAX_SIZE)) return;
  if (w === store.doc.width && hgt === store.doc.height) return;
  const { doc, lost } = resizeDoc(store.doc, w, hgt);
  if (lost && !confirm(t('resizeLoses', { n: lost }))) return;
  store.replaceDoc(doc);
});

$<HTMLSelectElement>('#pmode').onchange = (e) => {
  view.mode = (e.target as HTMLSelectElement).value as PrintMode;
  writeJSON(PMODE_KEY, view.mode);
  renderLegend();
  view.invalidate();
};

/* ---------- files ---------- */
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
$('#save').onclick = () => download(new Blob([JSON.stringify(serialize(store.doc))], { type: 'application/json' }), fileName(store.doc.title, 'json', 'rastas'));
$('#open').onclick = () => $('#file').click();
$<HTMLInputElement>('#file').onchange = async (e) => {
  const input = e.target as HTMLInputElement, f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const doc: Doc = parseDoc(JSON.parse(await f.text()));
    store.replaceDoc(doc);
    notice('');
  } catch (err) {
    notice(t('notAPattern', { why: err instanceof FormatError ? err.message : 'JSON' }));
  }
};

async function makePdf(): Promise<Blob | null> {
  notice(t('pdfWorking'));
  try {
    const bytes = await buildPdf(store.doc, view.mode, getLang());
    notice('');
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } catch (err) {
    console.error(err);
    notice(t('pdfFailed'));
    return null;
  }
}
const pdfName = () => fileName(store.doc.title, 'pdf', 'rastas');
$('#pdfdl').onclick = async () => { const b = await makePdf(); if (b) download(b, pdfName()); };
$('#pdfopen').onclick = async () => {
  const win = window.open('', '_blank'); // open synchronously so popup blockers allow it
  const b = await makePdf();
  if (!b) { win?.close(); return; }
  if (!win) { download(b, pdfName()); notice(t('popupBlocked')); return; }
  const url = URL.createObjectURL(b);
  win.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
};

/* ---------- language ---------- */
const langSel = $<HTMLSelectElement>('#lang');
langSel.replaceChildren(...LANGS.map((l) => h('option', { value: l }, l.toUpperCase())));
langSel.value = getLang();
langSel.onchange = () => {
  setLang(langSel.value as Lang);
  applyI18n();
  pal.replaceChildren(); // rebuild rows with translated labels
  renderDoc();
};

/* ---------- start ---------- */
applyI18n();
renderDoc();
renderUi();
lastSize = `${store.doc.width}x${store.doc.height}`;
requestAnimationFrame(fitZoom);
loadPageFonts().then(() => view.invalidate(), () => {});
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
if (framed) {
  $('#notice').innerHTML = t('framed'); // trusted dictionary text
  $('#notice').hidden = false;
}

// Installable/offline when hosted over http(s); the single HTML file still works from disk.
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator && !framed) {
  document.head.append(h('link', { rel: 'manifest', href: 'manifest.webmanifest' }));
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Exposed for end-to-end tests only.
Object.assign(window, { __store: store, __view: view });
