/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts'];

/**
 * Serves pdf.js CMaps and standard fonts at /pdfjs/* in dev and copies them into
 * dist/pdfjs/* for production builds (they are loaded on demand by PDF.js).
 */
function pdfjsAssets(): Plugin {
  const mime = (file: string) => (file.endsWith('.bcmap') ? 'application/octet-stream' : file.endsWith('.pfb') || file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
  return {
    name: 'pdfly-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0].replace(/^\/[^/]+(?=\/pdfjs\/)/, '');
        const m = /^\/pdfjs\/(cmaps|standard_fonts)\/([A-Za-z0-9._-]+)$/.exec(url);
        if (!m) return next();
        const file = path.join(PDFJS_DIR, m[1], m[2]);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', mime(file));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist', 'pdfjs');
      for (const dir of PDFJS_ASSET_DIRS) {
        fs.cpSync(path.join(PDFJS_DIR, dir), path.join(outDir, dir), { recursive: true });
      }
      // Static hosts without SPA rewrites (GitHub Pages) serve 404.html for deep links.
      const index = path.resolve(__dirname, 'dist', 'index.html');
      if (fs.existsSync(index)) fs.copyFileSync(index, path.resolve(__dirname, 'dist', '404.html'));
    },
  };
}

export default defineConfig({
  // Set VITE_BASE_PATH (e.g. "/Filora/") when the site is served from a sub-path such as GitHub Pages.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), pdfjsAssets()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'pdf-lib'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The HEIC decoder (libheif compiled to WebAssembly, inlined by heic-to) is ~3 MB; it is lazy-loaded by the HEIC tools only.
    chunkSizeWarningLimit: 3200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
          pdflib: ['pdf-lib'],
          pdfjs: ['pdfjs-dist'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
