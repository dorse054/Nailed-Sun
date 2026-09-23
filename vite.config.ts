/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` inlines everything into one HTML file so the game
// can be shared as a single page. The default build emits normal hashed assets.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
}));
