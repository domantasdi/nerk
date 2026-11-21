# Kryželio raštų kūrėjas / Cross-stitch pattern maker

Draw cross-stitch charts in the browser and print them on A4 as a vector PDF with a legend.

`npm run build` produces **one self-contained `dist/index.html`** (code, fonts and PDF engine inlined).
It works when opened straight from disk with no internet. When hosted over http(s), it is also
installable and works offline (`dist/sw.js` + `dist/manifest.webmanifest`).

## Commands

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # typecheck + single-file build → dist/index.html
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright; builds and serves dist/)
```

Before the first `test:e2e`, run `npx playwright install chromium` (or set `PW_CHROMIUM_PATH` to an existing Chromium).

## Layout

| File | Responsibility |
| --- | --- |
| `src/model.ts` | `Doc` type (any size 5–200), sample/blank docs, resize, counts, bounding box |
| `src/format.ts` | Saved-file format v2, **strict validation** of every loaded file, v1 → v2 migration |
| `src/history.ts` | Undo/redo storing only changed cells (full snapshots only for structural edits) |
| `src/store.ts` | All mutations: strokes, fill, mirror, palette, title, resize |
| `src/geometry.ts` | Pure algorithms: mirror, Bresenham line, flood fill, fabric fitting |
| `src/view.ts` | `<canvas>` grid renderer (zoom, hover, keyboard cursor, mirror axes) |
| `src/pdf.ts` | A4 PDF via pdf-lib: single page, or tiled pages with overlap, plus overview and legend |
| `src/symbols.ts` | Symbols as SVG paths, used by the screen, the swatches and the PDF |
| `src/fonts.ts` | Bundled Lato TTF, used by both the page and the PDF |
| `src/i18n.ts` | LT / EN texts |
| `src/library.ts` | Pattern library (IndexedDB → localStorage → memory fallback) and debounced autosave |
| `src/share.ts` | Share links: pattern compressed into the URL fragment `#p=…`, strictly validated on open |
| `src/storage.ts` | localStorage helpers; moves the single autosave slot of earlier versions into the library |
| `src/ui/libraryDialog.ts`, `src/ui/shareDialog.ts` | "My patterns" and "Share" dialogs |
| `src/ui/canvasInput.ts` | Drawing, eyedropper, pinch/pan, zoom around the pointer, keyboard cursor |
| `src/ui/toast.ts` | Notifications with Undo (replaces confirm dialogs) |
| `src/ui/symbolPicker.ts` | Visual symbol picker popover |
| `src/ui/icons.ts`, `src/ui/dom.ts` | Inline SVG icons, DOM helpers |
| `src/main.ts` | Wiring: palette, panels, shortcuts, files, PDF, help dialog |
| `scripts/make-fonts.py` | Rebuilds `src/assets/fonts/*.ttf` from the `lato-font` package (Lato 2.0, OFL) |

## Pattern library and share links

All patterns are stored in the browser (IndexedDB) under **My patterns**. Opening a file or a
share link adds a new pattern and never overwrites the open one. Undo history is kept per pattern.

**Share link** puts the whole pattern into the part of the URL after `#`, which browsers never send
to a server. A 30×30 pattern makes a link of about 320 characters. When the app is opened from disk,
links point to the public copy at `https://domantasdi.github.io/nerk/`; set `VITE_PUBLIC_URL` at build
time to change that.

### Publishing (GitHub Pages)

`.github/workflows/pages.yml` runs the unit tests, builds, and deploys on every push to `main`.
One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

## Keyboard shortcuts

`B` draw · `E` eraser · `G` fill · `I` eyedropper · `M` mirror mode · `1`–`9` colour ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+S` save · `Ctrl+O` open · `Ctrl+P` PDF ·
`+` `−` `0` zoom · `?` help. On the grid: arrows, `Space`/`Enter`, `Delete`, `F`.
Mouse: Alt+click picks a colour, right button erases, middle-drag pans, Ctrl+wheel zooms.
Touch: two fingers pan and pinch-zoom.

## File format (v2)

```json
{ "version": 2, "title": "…", "width": 30, "height": 30,
  "entries": [{ "color": "#c62828", "sym": "cross", "desc": "DMC 321" }],
  "cells": [-1, 0, …] }
```

`cells` is row-major. `-1` means empty; any other value is an index into `entries`. Files from the
original version (no `version` field, 30×30, Unicode symbols) are migrated on open.
