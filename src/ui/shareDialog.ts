/** "Share pattern" dialog: builds the link, copies it, or uses the system share sheet. */
import { t } from '../i18n';
import type { Doc } from '../model';
import { encodeShare, shareBase } from '../share';
import { $ } from './dom';
import { toast } from './toast';

const LONG_LINK = 2000;

export function createShareDialog(getDoc: () => Doc) {
  const dlg = $<HTMLDialogElement>('#sharedlg'), box = $<HTMLInputElement>('#sharelink');
  const copyBtn = $<HTMLButtonElement>('#sharecopy'), nativeBtn = $<HTMLButtonElement>('#sharenative'), long = $('#sharelong');
  let url = '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      box.select();
      document.execCommand('copy'); // older browsers / file://
    }
    copyBtn.textContent = '✓ ' + t('copied');
    setTimeout(() => (copyBtn.textContent = t('copyLink')), 2000);
  }
  copyBtn.onclick = copy;
  nativeBtn.onclick = async () => {
    try { await navigator.share({ title: getDoc().title || t('appTitle'), url }); } catch { /* cancelled */ }
  };
  box.addEventListener('focus', () => box.select());

  return {
    async open() {
      try {
        url = shareBase() + '#' + (await encodeShare(getDoc()));
      } catch {
        toast(t('shareBroken'), { error: true });
        return;
      }
      box.value = url;
      long.hidden = url.length <= LONG_LINK;
      long.textContent = t('linkLong', { n: url.length });
      nativeBtn.hidden = typeof navigator.share !== 'function';
      copyBtn.textContent = t('copyLink');
      dlg.showModal();
      copyBtn.focus();
    },
  };
}
