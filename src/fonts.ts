/**
 * Lato is bundled into the HTML (no Google Fonts request), so the app and its
 * PDFs look the same offline. TTF (not WOFF2) because PDFs can only embed
 * TrueType; built from @fontsource/lato by scripts/make-fonts.py.
 */
import lato400 from './assets/fonts/lato-400.ttf?inline';
import lato700 from './assets/fonts/lato-700.ttf?inline';

function bytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
}

export const fontBytes = (weight: 'regular' | 'bold') => bytes(weight === 'bold' ? lato700 : lato400);

export async function loadPageFonts(): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const faces = [new FontFace('Lato', fontBytes('regular').buffer as ArrayBuffer, { weight: '400' }), new FontFace('Lato', fontBytes('bold').buffer as ArrayBuffer, { weight: '700' })];
  await Promise.all(faces.map(async (f) => { await f.load(); document.fonts.add(f); }));
}
