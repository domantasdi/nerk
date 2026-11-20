/**
 * Visual symbol picker (popover grid of the real printed shapes) instead of a
 * <select> of look-alike characters. Symbols used by other colours are marked.
 * Keyboard: arrows move, Enter/Space choose, Escape closes.
 */
import { t } from '../i18n';
import { SYMBOLS, symbolSvg } from '../symbols';
import { h } from './dom';

const COLS = 7;
let open: { pop: HTMLElement; anchor: HTMLElement; done: () => void } | null = null;

export function closeSymbolPicker(restoreFocus = true) {
  if (!open) return;
  const { pop, anchor, done } = open;
  open = null;
  pop.remove();
  anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  if (restoreFocus) anchor.focus();
  done();
}
function outside(e: Event) {
  if (open && !open.pop.contains(e.target as Node) && !open.anchor.contains(e.target as Node)) closeSymbolPicker(false);
}

export function openSymbolPicker(anchor: HTMLElement, current: string, usedByOthers: Set<string>, onPick: (id: string) => void, onClose: () => void = () => {}) {
  closeSymbolPicker(false);
  const pop = h('div', { class: 'sympop', role: 'dialog', 'aria-label': t('symbol') });
  const grid = h('div', { class: 'symgrid', role: 'listbox', 'aria-label': t('symbol') });
  const buttons = SYMBOLS.map((s, k) => {
    const used = usedByOthers.has(s.id);
    const b = h('button', {
      type: 'button', role: 'option', class: 'symbtn' + (used ? ' used' : ''), 'data-id': s.id,
      'aria-selected': String(s.id === current), tabindex: s.id === current ? '0' : '-1',
      'aria-label': `${t('symbol')} ${k + 1}${used ? ` (${t('symbolInUse')})` : ''}`,
      title: used ? t('symbolInUse') : '',
    }, symbolSvg(s.id, '#222', 20));
    b.onclick = () => { onPick(s.id); closeSymbolPicker(); };
    return b;
  });
  grid.append(...buttons);
  grid.addEventListener('keydown', (e) => {
    const k = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS, Home: -k, End: buttons.length - 1 - k };
    if (e.key in step) {
      e.preventDefault();
      const n = Math.max(0, Math.min(buttons.length - 1, k + step[e.key]));
      buttons.forEach((b, i) => b.setAttribute('tabindex', i === n ? '0' : '-1'));
      buttons[n].focus();
    }
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSymbolPicker(); } else if (e.key === 'Tab') closeSymbolPicker(false); });
  pop.append(grid);
  document.body.append(pop);

  // Position under the anchor, kept inside the viewport.
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - pw - 8));
  const top = r.bottom + 6 + ph > innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6;
  pop.style.left = left + scrollX + 'px';
  pop.style.top = top + scrollY + 'px';

  anchor.setAttribute('aria-expanded', 'true');
  open = { pop, anchor, done: onClose };
  document.addEventListener('pointerdown', outside, true);
  (buttons.find((b) => b.dataset.id === current) ?? buttons[0]).focus();
}
