import { loadPageFonts } from './fonts';
import { FormatError, fileName, parseDoc, serialize } from './format';
import { fitRows } from './geometry';
import { LANGS, applyI18n, getLang, setLang, t, type Lang } from './i18n';
import { EMPTY, MAX_ENTRIES, MAX_SIZE, MIN_SIZE, bbox, blankDoc, counts, resizeDoc, samplePattern, textOn, type Doc, type MirrorMode } from './model';
import { buildPdf, type PrintMode } from './pdf';
import { AutoSaver, newId, openLibrary, type PatternMeta } from './library';
import { HASH_KEY, decodeShare, fingerprint } from './share';
import { CURRENT_KEY, FIT_KEY, readJSON, takeLegacyDoc, writeJSON } from './storage';
import { Store, TOOLS, type Tool } from './store';
import { SYMBOLS, symbolSvg } from './symbols';
import { attachCanvasInput, zoomCentre } from './ui/canvasInput';
import { $, h, isTyping } from './ui/dom';
import { hydrateIcons, icon } from './ui/icons';
import { createLibraryDialog } from './ui/libraryDialog';
import { createShareDialog } from './ui/shareDialog';
import { closeSymbolPicker, openSymbolPicker } from './ui/symbolPicker';
import { toast } from './ui/toast';
import { GridView } from './view';

/* ---------- pattern library: pick the pattern to show ---------- */
function makeThumb(d: Doc): string {
  const s = Math.max(1, Math.floor(96 / Math.max(d.width, d.height)));
  const c = document.createElement('canvas');
  c.width = d.width * s;
  c.height = d.height * s;
  const x = c.getContext('2d');
  if (!x) return '';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  d.cells.forEach((v, i) => {
    if (v < 0) return;
    x.fillStyle = d.entries[v].color;
    x.fillRect((i % d.width) * s, Math.floor(i / d.width) * s, s, s);
  });
  return c.toDataURL('image/png');
}

const lib = await openLibrary(makeThumb);
const legacy = takeLegacyDoc(); // single autosave slot of earlier versions → first library entry
if (legacy && !lib.list().length) writeJSON(CURRENT_KEY, (await lib.create(legacy)).id);

/** A share link in the address bar (#p=…) is read once and removed, so a reload doesn't import it again. */
async function takeSharedFromUrl(): Promise<{ doc: Doc; source: string } | 'broken' | null> {
  if (!location.hash.startsWith(`#${HASH_KEY}=`)) return null;
  const raw = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const doc = await decodeShare(raw);
    return doc ? { doc, source: fingerprint(raw) } : null;
  } catch {
    return 'broken';
  }
}
const sharedAtStart = await takeSharedFromUrl();
let sharedWasKnown = false;

async function initialPattern(): Promise<{ id: string; doc: Doc }> {
  // Arriving through a share link: show that pattern (and don't create the sample next to it).
  if (sharedAtStart && sharedAtStart !== 'broken') {
    const existing = lib.findBySource(sharedAtStart.source), doc = existing && (await lib.get(existing.id));
    if (existing && doc) { sharedWasKnown = true; return { id: existing.id, doc }; }
    return { id: (await lib.create(sharedAtStart.doc, { source: sharedAtStart.source })).id, doc: sharedAtStart.doc };
  }
  const saved = readJSON<string>(CURRENT_KEY);
  for (const id of [saved, ...lib.list().map((m) => m.id)]) {
    if (!id || !lib.meta(id)) continue;
    const doc = await lib.get(id);
    if (doc) return { id, doc };
  }
  const doc = samplePattern(t('sampleTitle'), t('sampleDesc'));
  return { id: (await lib.create(doc)).id, doc };
}
const initial = await initialPattern();
let currentId = initial.id;
writeJSON(CURRENT_KEY, currentId);

/* ---------- state ---------- */
const store = new Store(initial.doc);
const canvas = $<HTMLCanvasElement>('#grid');
const view = new GridView(canvas, () => store.doc);
const wrap = $('#wrap');
const PMODE_KEY = 'stitch-pattern-pmode';
view.mode = (readJSON<PrintMode>(PMODE_KEY) ?? 'both') as PrintMode;
$<HTMLSelectElement>('#pmode').value = view.mode;

/** Run a whole-document change and offer to undo it (instead of a confirm() dialog). */
function undoable(run: () => void, message: string) {
  run();
  toast(message, { action: { label: t('undoAction'), run: () => store.undo() } });
}

const entryName = (i: number) => store.doc.entries[i]?.desc || `#${i + 1}`;

/* ---------- palette (keyed in-place updates keep focus while typing) ---------- */
const pal = $<HTMLUListElement>('#pal');

function paletteRow(i: number): HTMLLIElement {
  const del = h('button', { class: 'x', type: 'button', 'data-del': '', 'aria-label': t('removeColor'), title: t('removeColor') }, icon('close', 16));
  return h('li', { class: 'ent', 'data-i': String(i) },
    h('button', { class: 'pick', type: 'button' }),
    h('input', { type: 'color', 'data-k': 'color', 'aria-label': t('colorPicker'), title: t('colorPicker') }),
    h('button', { class: 'symsel', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }),
    h('input', { type: 'text', 'data-k': 'desc', maxlength: '200', placeholder: t('descPlaceholder'), 'aria-label': t('descr'), autocomplete: 'off' }),
    del,
    h('div', { class: 'cnt' }),
    h('div', { class: 'dup', hidden: '' }, icon('warn', 14), t('dupSymbol')));
}

function renderPalette() {
  const d = store.doc, cnt = counts(d);
  if (pal.children.length !== d.entries.length) pal.replaceChildren(...d.entries.map((_, i) => paletteRow(i)));
  const symUse = new Map<string, number>();
  for (const e of d.entries) symUse.set(e.sym, (symUse.get(e.sym) ?? 0) + 1);
  d.entries.forEach((e, i) => {
    const li = pal.children[i] as HTMLLIElement, active = document.activeElement;
    li.classList.toggle('sel', i === store.sel);
    const pick = li.querySelector<HTMLButtonElement>('.pick')!;
    pick.style.background = e.color;
    pick.replaceChildren(symbolSvg(e.sym, textOn(e.color), 20), h('span', { class: 'num' }, String(i + 1)));
    pick.setAttribute('aria-pressed', String(i === store.sel));
    pick.setAttribute('aria-label', t('selectColor', { n: i + 1 }) + (e.desc ? ` – ${e.desc}` : ''));
    pick.title = i < 9 ? `${t('selectColor', { n: i + 1 })} (${i + 1})` : t('selectColor', { n: i + 1 });
    const sym = li.querySelector<HTMLButtonElement>('.symsel')!;
    sym.replaceChildren(symbolSvg(e.sym, '#222', 18), icon('chevron', 12));
    sym.setAttribute('aria-label', t('chooseSymbol', { name: String(SYMBOL_INDEX.get(e.sym) ?? '') }));
    sym.dataset.sym = e.sym;
    for (const inp of li.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const v = e[inp.dataset.k as 'color' | 'desc'];
      if (inp !== active && inp.value !== v) inp.value = v;
    }
    li.querySelector<HTMLButtonElement>('.x')!.disabled = d.entries.length <= 1;
    li.querySelector('.cnt')!.textContent = t('stitches', { n: cnt[i] });
    const dup = (symUse.get(e.sym) ?? 0) > 1;
    li.querySelector<HTMLElement>('.dup')!.hidden = !dup;
    li.classList.toggle('warn', dup);
  });
  $('#pc').textContent = `(${d.entries.length}/${MAX_ENTRIES})`;
  $<HTMLButtonElement>('#add').disabled = d.entries.length >= MAX_ENTRIES;
  renderCurrentColor();
}
const SYMBOL_INDEX = new Map(SYMBOLS.map((s, k) => [s.id, k + 1]));

function renderCurrentColor() {
  const e = store.doc.entries[store.sel], chip = $('#curcolor'), sw = chip.querySelector<HTMLElement>('.chipsw')!;
  sw.style.background = e.color;
  sw.replaceChildren(symbolSvg(e.sym, textOn(e.color), 18));
  const label = t('currentColor', { name: entryName(store.sel) });
  chip.setAttribute('aria-label', label);
  chip.title = label;
}
$('#curcolor').onclick = () => {
  const btn = pal.children[store.sel]?.querySelector<HTMLButtonElement>('.pick');
  btn?.scrollIntoView({ block: 'nearest' });
  btn?.focus();
};

const entryIndex = (el: EventTarget | null) => Number((el as HTMLElement).closest<HTMLElement>('.ent')?.dataset.i ?? -1);
pal.addEventListener('click', (e) => {
  const target = e.target as HTMLElement, i = entryIndex(target);
  if (i < 0) return;
  if (target.closest('[data-del]')) {
    const n = counts(store.doc)[i];
    if (n) undoable(() => store.deleteEntry(i), t('colorDeleted', { n }));
    else store.deleteEntry(i);
  } else if (target.closest('.pick')) store.select(i);
  else if (target.closest('.symsel')) {
    const btn = target.closest<HTMLButtonElement>('.symsel')!;
    const others = new Set(store.doc.entries.filter((_, k) => k !== i).map((x) => x.sym));
    openSymbolPicker(btn, store.doc.entries[i].sym, others, (id) => store.updateEntry(i, { sym: id }));
  }
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
pal.addEventListener('change', () => store.commitMetaEdit());
pal.addEventListener('focusout', () => store.commitMetaEdit());
pal.addEventListener('keydown', (e) => {
  // Enter in a description field finishes editing and returns to the grid.
  if (e.key === 'Enter' && (e.target as HTMLElement).matches('input[type=text]')) { e.preventDefault(); canvas.focus(); }
});
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
  tbl.append(h('tr', {}, ...[t('copies'), t('gapBetween'), a, b].map((s) => h('th', { scope: 'col' }, s))));
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

/* ---------- remember which side panels are open ---------- */
const PANELS_KEY = 'stitch-pattern-panels';
const openPanels = readJSON<Record<string, boolean>>(PANELS_KEY) ?? {};
document.querySelectorAll<HTMLDetailsElement>('details.panel').forEach((d) => {
  if (typeof openPanels[d.id] === 'boolean') d.open = openPanels[d.id];
  d.addEventListener('toggle', () => { openPanels[d.id] = d.open; writeJSON(PANELS_KEY, openPanels); });
});

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
  canvas.dataset.cursor = store.tool;
  view.mirror = store.mirror;
  view.invalidate();
  renderCurrentColor();
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
    closeSymbolPicker(false);
    renderDoc();
    const size = `${store.doc.width}x${store.doc.height}`;
    if (size !== lastSize) { lastSize = size; fitZoom(); }
  } else renderUi();
  if (ev.type !== 'ui' && !switching) saver.schedule();
});

/* ---------- autosave + other tabs ---------- */
const saveState = $('#savestate');
const tabId = newId();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('stitch-patterns') : null;
const saver = new AutoSaver(lib, () => ({ id: currentId, doc: store.doc }), (s, meta) => {
  saveState.textContent = s === 'pending' ? t('saving') : s === 'saved' ? '✓ ' + t('savedLocal') : t('saveFailed');
  saveState.classList.toggle('err', s === 'error');
  if (s === 'saved' && meta) {
    channel?.postMessage({ type: 'saved', id: meta.id, tab: tabId });
    libDialog.render();
    requestPersistentStorage();
  }
});
let persistAsked = false;
function requestPersistentStorage() {
  // Ask once so the browser doesn't evict the library under storage pressure.
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}
if (channel) channel.onmessage = async (e: MessageEvent<{ type: string; id: string; tab: string }>) => {
  if (e.data?.tab === tabId) return;
  await lib.load(); // pick up the other tab's changes
  libDialog.render();
  if (e.data.type === 'saved' && e.data.id === currentId)
    toast(t('otherTab'), { action: { label: t('reload'), run: () => { saver.discard(); void switchTo(currentId, undefined, false); } }, timeout: 15_000 });
};

/** Show another library pattern (saves the current one first). Undo history is per pattern. */
let switching = false;
async function switchTo(id: string, doc?: Doc, saveFirst = true): Promise<boolean> {
  if (saveFirst) await saver.flush();
  const d = doc ?? (await lib.get(id));
  if (!d) return false;
  currentId = id;
  writeJSON(CURRENT_KEY, id);
  switching = true;
  try { store.replaceDoc(d, false); } finally { switching = false; }
  libDialog.render();
  return true;
}

/** Add a pattern to the library, open it, and offer to undo (go back + remove it). */
async function addAndOpen(doc: Doc, message: string, extra: Partial<PatternMeta> = {}) {
  const prev = currentId;
  const meta = await lib.create(doc, extra);
  await switchTo(meta.id, doc);
  toast(message, { action: { label: t('undoAction'), run: async () => { await switchTo(prev, undefined, false); await lib.remove(meta.id); libDialog.render(); } } });
}

/* ---------- title ---------- */
const titleEl = $<HTMLInputElement>('#title');
titleEl.addEventListener('focus', () => store.beginMetaEdit());
titleEl.addEventListener('input', () => store.setTitle(titleEl.value));
titleEl.addEventListener('blur', () => store.commitMetaEdit());
titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') canvas.focus(); });

/* ---------- canvas ---------- */
const coords = $('#coords'), live = $('#live');
attachCanvasInput({ canvas, wrap, view, store }, (i, fromKeyboard) => {
  const d = store.doc;
  if (i < 0) { coords.textContent = ''; return; }
  const r = d.height - Math.floor(i / d.width), c = (i % d.width) + 1, v = d.cells[i];
  coords.textContent = t('statusCell', { r, c });
  if (fromKeyboard) live.textContent = t('cellAt', { r, c, v: v < 0 ? t('cellEmpty') : entryName(v) });
});

/* ---------- zoom ---------- */
function fitZoom() { view.fitTo(wrap.clientWidth - 8, wrap.clientHeight - 8); }
$('#zin').onclick = () => zoomCentre(view, wrap, 1.25);
$('#zout').onclick = () => zoomCentre(view, wrap, 1 / 1.25);
$('#zfit').onclick = fitZoom;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWrap = '';
new ResizeObserver(() => {
  // Re-fit when the window size really changes (not on every tiny layout shift).
  const s = `${wrap.clientWidth}x${wrap.clientHeight}`;
  if (s === lastWrap) return;
  const first = !lastWrap;
  lastWrap = s;
  clearTimeout(resizeTimer);
  if (!first) resizeTimer = setTimeout(fitZoom, 150);
}).observe(wrap);

/* ---------- toolbar ---------- */
document.querySelectorAll<HTMLElement>('#tools .btn').forEach((b) => (b.onclick = () => store.setTool(b.dataset.tool as Tool)));
document.querySelectorAll<HTMLElement>('#mirror .btn').forEach((b) => (b.onclick = () => store.setMirror(b.dataset.m as MirrorMode)));
$('#undo').onclick = () => store.undo();
$('#redo').onclick = () => store.redo();

/* ---------- global shortcuts ---------- */
const MIRRORS: MirrorMode[] = ['none', 'h', 'v', 'both'];
const TOOL_KEYS: Record<string, Tool> = { b: 'pen', p: 'pen', e: 'erase', g: 'fill', i: 'pick' };
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || isTyping(e.target) || ($<HTMLDialogElement>('#help').open && e.key !== '?')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveFile(); return; }
  if (mod && k === 'o') { e.preventDefault(); $('#file').click(); return; }
  if (mod && k === 'p') { e.preventDefault(); openPdf(); return; }
  if (mod || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (TOOL_KEYS[k] && TOOLS.includes(TOOL_KEYS[k])) store.setTool(TOOL_KEYS[k]);
  else if (k === 'm') store.setMirror(MIRRORS[(MIRRORS.indexOf(store.mirror) + 1) % MIRRORS.length]);
  else if (/^[1-9]$/.test(e.key)) store.select(+e.key - 1);
  else if (e.key === '+' || e.key === '=') zoomCentre(view, wrap, 1.25);
  else if (e.key === '-') zoomCentre(view, wrap, 1 / 1.25);
  else if (e.key === '0') fitZoom();
  else return;
  e.preventDefault();
});

/* ---------- pattern panel ---------- */
$('#clear').onclick = () => {
  if (store.doc.cells.every((v) => v < 0)) return;
  undoable(() => store.replaceDoc({ ...store.doc, entries: store.doc.entries.map((e) => ({ ...e })), cells: new Int16Array(store.doc.cells.length).fill(EMPTY) }), t('cleared'));
};
const newPattern = () => addAndOpen(blankDoc(store.doc.width, store.doc.height, t('defaultTitle'), t('firstDesc')), t('newCreated'));
$('#new').onclick = newPattern;

$<HTMLFormElement>('#sizeform').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = Math.round(+$<HTMLInputElement>('#gw').value), hgt = Math.round(+$<HTMLInputElement>('#gh').value);
  if (!(w >= MIN_SIZE && w <= MAX_SIZE && hgt >= MIN_SIZE && hgt <= MAX_SIZE)) return;
  if (w === store.doc.width && hgt === store.doc.height) return;
  const { doc, lost } = resizeDoc(store.doc, w, hgt);
  undoable(() => store.replaceDoc(doc), lost ? t('resizedLost', { w, h: hgt, n: lost }) : t('resized', { w, h: hgt }));
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
function saveFile() {
  const name = fileName(store.doc.title, 'json', 'rastas');
  download(new Blob([JSON.stringify(serialize(store.doc))], { type: 'application/json' }), name);
  toast(t('fileSaved', { name }));
}
$('#save').onclick = saveFile;
$('#open').onclick = () => $('#file').click();
$<HTMLInputElement>('#file').onchange = async (e) => {
  const input = e.target as HTMLInputElement, f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const doc = parseDoc(JSON.parse(await f.text()));
    await addAndOpen(doc, t('imported', { name: doc.title || f.name }));
  } catch (err) {
    toast(t('notAPattern', { why: err instanceof FormatError ? err.message : 'JSON' }), { error: true });
  }
};

/* ---------- PDF ---------- */
const pdfButtons = [$<HTMLButtonElement>('#pdfopen'), $<HTMLButtonElement>('#pdfdl')];
async function makePdf(): Promise<Blob | null> {
  pdfButtons.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  toast(t('pdfWorking'), { timeout: 60_000 });
  try {
    const bytes = await buildPdf(store.doc, view.mode, getLang());
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } catch (err) {
    console.error(err);
    toast(t('pdfFailed'), { error: true });
    return null;
  } finally {
    pdfButtons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
  }
}
const pdfName = () => fileName(store.doc.title, 'pdf', 'rastas');
$('#pdfdl').onclick = async () => {
  const b = await makePdf();
  if (b) { download(b, pdfName()); toast(t('pdfReady', { name: pdfName() })); }
};
async function openPdf() {
  const win = window.open('', '_blank'); // open synchronously so popup blockers allow it
  const b = await makePdf();
  if (!b) { win?.close(); return; }
  if (!win) { download(b, pdfName()); toast(t('popupBlocked')); return; }
  const url = URL.createObjectURL(b);
  win.location.href = url;
  toast(t('pdfReady', { name: pdfName() }));
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
$('#pdfopen').onclick = openPdf;

/* ---------- dialogs ---------- */
const help = $<HTMLDialogElement>('#help');
function toggleHelp() {
  if (help.open) help.close();
  else help.showModal();
}
$('#helpbtn').onclick = toggleHelp;
document.querySelectorAll<HTMLDialogElement>('dialog').forEach((d) => {
  d.querySelector<HTMLElement>('.dclose')!.onclick = () => d.close();
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click on the backdrop
});

const libDialog = createLibraryDialog(lib, {
  currentId: () => currentId,
  open: (id) => void switchTo(id),
  create: () => void newPattern(),
  importFile: () => $('#file').click(),
  duplicate: async (id) => {
    await saver.flush();
    const doc = await lib.get(id);
    if (!doc) return;
    doc.title = (doc.title || t('untitled')) + t('copySuffix');
    await lib.create(doc);
    libDialog.render();
    toast(t('patternDuplicated', { name: doc.title }));
  },
  remove: async (id) => {
    await saver.flush();
    const meta = lib.meta(id), doc = await lib.get(id);
    if (!meta || !doc) return;
    await lib.remove(id);
    channel?.postMessage({ type: 'deleted', id, tab: tabId });
    if (id === currentId) {
      const next = lib.list()[0];
      if (next) await switchTo(next.id, undefined, false);
      else {
        const fresh = blankDoc(doc.width, doc.height, t('defaultTitle'), t('firstDesc'));
        await switchTo((await lib.create(fresh)).id, fresh, false);
      }
    }
    libDialog.render();
    toast(t('patternDeleted', { name: meta.title || t('untitled') }), {
      action: { label: t('undoAction'), run: async () => { await lib.restore(meta, doc); libDialog.render(); } },
    });
  },
});
$('#libbtn').onclick = async () => { await saver.flush(); libDialog.open(); }; // cards show the latest title/thumbnail

const shareDialog = createShareDialog(() => store.doc);
$('#sharebtn').onclick = () => void shareDialog.open();

/* ---------- share links pasted into an already open tab ---------- */
window.addEventListener('hashchange', async () => {
  const shared = await takeSharedFromUrl();
  if (!shared) return;
  if (shared === 'broken') { toast(t('shareBroken'), { error: true }); return; }
  const existing = lib.findBySource(shared.source);
  if (existing && (await switchTo(existing.id))) { toast(t('shareAlready')); return; }
  await addAndOpen(shared.doc, t('shareOpened', { name: shared.doc.title || t('untitled') }), { source: shared.source });
});

/* ---------- language ---------- */
const langSel = $<HTMLSelectElement>('#lang');
langSel.replaceChildren(...LANGS.map((l) => h('option', { value: l }, l.toUpperCase())));
langSel.value = getLang();
langSel.onchange = () => {
  setLang(langSel.value as Lang);
  applyI18n();
  pal.replaceChildren(); // rebuild rows with translated labels
  renderDoc();
  renderUi();
};

/* ---------- start ---------- */
hydrateIcons();
applyI18n();
renderDoc();
renderUi();
lastSize = `${store.doc.width}x${store.doc.height}`;
requestAnimationFrame(fitZoom);
loadPageFonts().then(() => view.invalidate(), () => {});
window.addEventListener('pagehide', () => void saver.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saver.flush(); });
if (lib.backend.kind === 'memory') {
  $('#notice').textContent = t('storageMemory');
  $('#notice').hidden = false;
}
if (sharedAtStart === 'broken') toast(t('shareBroken'), { error: true });
else if (sharedAtStart) toast(sharedWasKnown ? t('shareAlready') : t('shareOpened', { name: sharedAtStart.doc.title || t('untitled') }));

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
Object.assign(window, { __store: store, __view: view, __lib: lib, __saver: saver });
