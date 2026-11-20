/** Inline SVG icons (24×24, stroke = currentColor). Constant markup only. */
const P: Record<string, string> = {
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/><path d="M14.5 6.5l3 3"/>',
  erase: '<path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8L11 18H8z"/><path d="M9 12l4.5 4.5"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 16s-1.5 2-1.5 3a1.5 1.5 0 003 0c0-1-1.5-3-1.5-3z"/>',
  pick: '<path d="M14 6l4 4"/><path d="M17.5 3.5a2.1 2.1 0 013 3L18 9l-3-3z"/><path d="M15 7l-9 9-1 4 4-1 9-9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  mirrorNone: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  mirrorH: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 3v18" stroke-dasharray="2 2"/>',
  mirrorV: '<rect x="5" y="4" width="14" height="16" rx="1"/><path d="M3 12h18" stroke-dasharray="2 2"/>',
  mirrorBoth: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 2v20M2 12h20" stroke-dasharray="2 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5"/><path d="M12 17h.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};

export function icon(name: keyof typeof P, size = 20): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/** Replace every <i data-icon="name"></i> placeholder with its SVG. */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon as keyof typeof P)));
}
