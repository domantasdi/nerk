/** Tiny DOM helpers. User data only ever goes in via text nodes / attributes, never innerHTML. */
export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/** Is the event target something the user types into? (global shortcuts must ignore those) */
export const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.matches('input:not([type=color]):not([type=button]),select,textarea'));
