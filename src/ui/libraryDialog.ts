/** "My patterns" dialog: search, open, duplicate, delete. */
import { getLang, t } from '../i18n';
import type { Library, PatternMeta } from '../library';
import { $, h } from './dom';
import { icon } from './icons';

export interface LibraryActions {
  currentId: () => string;
  open: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  create: () => void;
  importFile: () => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function when(ts: number): string {
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  const s = Math.round((ts - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return rtf.format(0, 'second');
}

export function createLibraryDialog(lib: Library, act: LibraryActions) {
  const dlg = $<HTMLDialogElement>('#libdlg'), grid = $('#libgrid'), search = $<HTMLInputElement>('#libsearch');

  function card(m: PatternMeta): HTMLLIElement {
    const current = m.id === act.currentId(), title = m.title || t('untitled');
    const img = h('img', { class: 'thumb', alt: '', width: '96', height: '96', loading: 'lazy' });
    if (m.thumb.startsWith('data:image/png;base64,')) img.src = m.thumb;
    const openBtn = h('button', { type: 'button', class: 'libopen', 'aria-current': current ? 'true' : undefined },
      h('span', { class: 'thumbbox' }, img),
      h('span', { class: 'lt' }, title),
      h('span', { class: 'lm' }, t('patternInfo', { w: m.width, h: m.height, n: m.stitches, when: when(m.updated) })),
      ...(current ? [h('span', { class: 'badge' }, t('currentBadge'))] : []));
    openBtn.onclick = () => { dlg.close(); if (!current) act.open(m.id); };
    const dup = h('button', { type: 'button', class: 'btn icon', title: t('duplicate'), 'aria-label': `${t('duplicate')}: ${title}` }, icon('copy', 18));
    dup.onclick = () => act.duplicate(m.id);
    const del = h('button', { type: 'button', class: 'btn icon danger', title: t('deletePattern'), 'aria-label': `${t('deletePattern')}: ${title}` }, icon('trash', 18));
    del.onclick = () => act.remove(m.id);
    return h('li', { class: 'libcard' + (current ? ' current' : ''), 'data-id': m.id }, openBtn, h('div', { class: 'libact' }, dup, del));
  }

  function render() {
    if (!dlg.open) return;
    const all = lib.list(), q = fold(search.value.trim());
    const shown = q ? all.filter((m) => fold(m.title || t('untitled')).includes(q)) : all;
    $('#libcount').textContent = t('libraryCount', { n: all.length });
    // Keep focus on the same card across re-renders (e.g. after an autosave).
    const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.libcard')?.dataset.id;
    grid.replaceChildren(...shown.map(card));
    $('#libempty').hidden = shown.length > 0;
    if (focusedId) grid.querySelector<HTMLElement>(`.libcard[data-id="${CSS.escape(focusedId)}"] .libopen`)?.focus();
  }

  search.addEventListener('input', render);
  $('#libnew').onclick = () => { dlg.close(); act.create(); };
  $('#libopen').onclick = () => { dlg.close(); act.importFile(); };

  return {
    open() {
      search.value = '';
      dlg.showModal();
      render();
      grid.querySelector<HTMLElement>('.libcard.current .libopen')?.focus();
    },
    render,
  };
}
