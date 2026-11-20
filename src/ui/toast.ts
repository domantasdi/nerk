/**
 * Non-blocking notifications. Destructive actions show an "Undo" button here
 * instead of interrupting with confirm() dialogs.
 */
import { t } from '../i18n';
import { $, h } from './dom';
import { icon } from './icons';

interface ToastOpts { action?: { label: string; run: () => void }; error?: boolean; timeout?: number }

let timer: ReturnType<typeof setTimeout> | undefined;
let arm = () => {};
let wired = false;

export function toast(msg: string, opts: ToastOpts = {}) {
  const box = $('#toast');
  clearTimeout(timer);
  const close = () => { box.hidden = true; box.replaceChildren(); };
  const kids: Node[] = [h('span', { class: 'tmsg' }, msg)];
  if (opts.action) {
    const btn = h('button', { type: 'button', class: 'tact' }, opts.action.label);
    btn.onclick = () => { close(); opts.action!.run(); };
    kids.push(btn);
  }
  const x = h('button', { type: 'button', class: 'tclose' }, icon('close', 16));
  x.setAttribute('aria-label', t('close'));
  x.onclick = close;
  kids.push(x);
  box.replaceChildren(...kids);
  box.classList.toggle('err', !!opts.error);
  box.setAttribute('role', opts.error ? 'alert' : 'status');
  box.hidden = false;
  // Keep actionable/error toasts long enough to react; pause while hovered or focused.
  const ms = opts.timeout ?? (opts.action || opts.error ? 8000 : 3500);
  arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  if (!wired) {
    wired = true;
    const pause = () => clearTimeout(timer), resume = () => arm();
    box.addEventListener('mouseenter', pause);
    box.addEventListener('focusin', pause);
    box.addEventListener('mouseleave', resume);
    box.addEventListener('focusout', resume);
  }
  arm();
}
