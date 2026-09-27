# PDFly – All your PDF tools in one place

PDFly is a PDF and image toolkit that runs **entirely in the browser**. Merge, split, compress, convert, edit and organize documents, and convert photos between HEIC, HEIF, JPG and PNG, through a consistent three-step flow: **Upload → Customize → Download**.

There is no backend: files never leave the user's device, and the site is a set of static files that can be hosted for free (Netlify, GitHub Pages, Vercel, Cloudflare Pages…).

---

## 1. Project overview

```
doc-convertor/
├── packages/pdf-core/     # @pdfly/core – shared pdf-lib operations
├── client/                # React 19 + TypeScript + Vite + MUI + Redux Toolkit
│   └── src/engines/       # browser processing engines (compress, OCR, conversions…)
├── e2e/                   # Playwright end-to-end tests
├── docs/ARCHITECTURE.md   # conventions for adding tools
├── netlify.toml           # Netlify build + SPA redirect
└── .github/workflows/     # CI and GitHub Pages deployment
```

## 2. Features (29 tools)

**Organize PDF** – Merge, Split, Remove Pages, Extract Pages, Organize (reorder, rotate, duplicate, delete, insert blank, add pages from another PDF), Scan to PDF.

**Optimize PDF** – Compress (images are downscaled and re-encoded), Repair (xref/trailer rebuild, page-image rebuild as last resort), OCR (tesseract.js, 16 languages; searchable PDF + text).

**Convert to PDF** – JPG/PNG/WEBP to PDF, Word, PowerPoint, Excel to PDF (text, lists, tables and images; simplified layout), HTML to PDF (built-in renderer, or "Print with browser" for an exact copy).

**Convert from PDF** – PDF to JPG/PNG, Word (DOCX), PowerPoint (PPTX), Excel (XLSX, table detection), PDF/A (1b/2b/3b with a validation report).

**Edit PDF** – Rotate, Page Numbers, Watermark, Crop, Edit PDF (text, images, drawing, highlights, shapes, signatures), PDF Forms.

**Image Tools** – HEIC to JPG, HEIF to JPG (native decoding in Safari, libheif WebAssembly elsewhere), JPG to PNG, PNG to JPG.

**Platform** – global search (Ctrl/Cmd + K), My Files (recent outputs in IndexedDB), settings, light/dark theme, responsive and accessible UI, lazy-loaded tools.

## 3. Tech stack

| Area | Technology |
| --- | --- |
| UI | React 19, TypeScript, Vite 7, Redux Toolkit, React Router 7, Material UI 7, React Hook Form + Zod, dnd-kit |
| PDF | pdf-lib, PDF.js |
| Conversions | docx, pptxgenjs, SheetJS (xlsx), mammoth, JSZip, tesseract.js, heic-to (libheif) |
| Testing | Vitest, React Testing Library, Playwright |

## 4. Getting started

Prerequisites: **Node.js 20+** and npm 10+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Optional client settings (`client/.env`, see `client/.env.example`):

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_MAX_FILE_SIZE_MB` | `50` | Per-file size limit |
| `VITE_BASE_PATH` | `/` | Sub-path the site is served from (`/<repo>/` on GitHub Pages) |

## 5. Build

```bash
npm run build        # outputs static files to client/dist
npm run preview      # serve the production build locally
```

## 6. Free hosting

### Netlify
1. Push the repository to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub** and pick the repository.
3. Netlify reads `netlify.toml` (build `npm run build`, publish `client/dist`, SPA redirect). Click **Deploy**.

### GitHub Pages
1. Push the repository to GitHub (branch `main`).
2. Repository **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy-pages.yml`, which tests, builds with the correct base path and publishes to `https://<user>.github.io/<repo>/`.

## 7. Testing

```bash
npm run typecheck
npm run lint
npm test             # unit tests (pdf-core + client)
npm run test:e2e     # Playwright; first run: npx playwright install chromium
```

## 8. Limits of browser-only processing

- Large files are processed with the device's memory and CPU; very large PDFs or long OCR jobs are slower on phones.
- OCR downloads language data (~10–20 MB per language) and HEIC conversion downloads the decoder (~3 MB, ~0.7 MB gzipped) on first use; both are cached afterwards.
- Office → PDF keeps text, tables and images but not the exact original layout.
- PDF/A output cannot embed missing fonts; the validation report flags them.
- HTML → PDF from a URL only works for sites that allow cross-origin requests; save the page as HTML and upload it otherwise.

## 9. Licences

The HEIC decoder (`heic-to`, built on libheif) is LGPL-3.0 and is loaded as a separate, unmodified script chunk. All other dependencies use permissive licences.
