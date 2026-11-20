import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained index.html (fonts, PDF engine and all code inlined).
// sw.js + manifest are copied next to it for hosted (PWA) use; the HTML alone
// still works when opened straight from disk.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: Infinity, chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
