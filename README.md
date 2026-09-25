# PDFly – All your PDF tools in one place

PDFly is a complete, production-quality PDF toolkit web application. Non-technical users can merge, split, compress, convert, edit and organize documents through a consistent three-step flow: **Upload → Customize → Download**. Every tool is fully functional end-to-end: upload, process, preview, download/export, start again, and graceful error handling — on desktop, tablet and mobile.

Most tools run **entirely in the browser** (pdf-lib + PDF.js), so files never leave the device. Heavy conversions (Office ↔ PDF, OCR, compression, PDF/A, PDF → images) run on the Node/Express server with open-source tooling, and every server feature has a **pure-JS fallback** so the app works without any system dependencies installed.

---

## 1. Project overview

```
doc-convertor/
├── packages/pdf-core/   # @pdfly/core – shared pdf-lib operations (browser + server)
├── client/              # React 19 + TypeScript + Vite + MUI + Redux Toolkit
├── server/              # Node 20+ + Express 5 + TypeScript REST API
├── e2e/                 # Playwright end-to-end tests
├── docs/ARCHITECTURE.md # conventions for adding tools
├── playwright.config.ts
├── package.json         # npm workspaces + root scripts
└── .env.example
```

## 2. Features

**Organize PDF** – Merge (drag to reorder, rename, thumbnails), Split (every page / ranges / selected pages / every N pages, ZIP output), Remove Pages, Extract Pages, Organize (drag-reorder, rotate, duplicate, delete, insert blank, merge pages from another PDF, undo/redo), Scan to PDF (camera capture, upload, reorder, rotate, crop, enhance).

**Optimize PDF** – Compress (low/medium/high with size comparison), Repair (multi-strategy recovery with clear "repaired / healthy / unable to repair" status), OCR (searchable PDF + text export, 16 languages).

**Convert to PDF** – JPG/PNG/WEBP to PDF (page size, orientation, margins, fit mode, quality, live preview), Word, PowerPoint, Excel to PDF, HTML to PDF (paste, upload or URL; page size, orientation, margins, header/footer, background graphics).

**Convert from PDF** – PDF to JPG/PNG (quality, DPI, page selection, ZIP), PDF to Word (editable DOCX), PDF to PowerPoint (slide image + editable text), PDF to Excel (table detection), PDF to PDF/A (1b/2b/3b with a validation report).

**Edit PDF** – Rotate (per page or all), Page Numbers (position, format, font, color, margin, live preview), Watermark (text or image, opacity, rotation, position/tile, live preview), Crop (draw crop area, auto-detect margins, per page / all pages), Edit PDF (text, images, freehand drawing, highlight/underline/strike-through, shapes, lines/arrows, checkboxes, signatures, whiteout, undo/redo), PDF Forms (fill existing forms, add text/checkbox/radio/dropdown/date/signature fields, flatten).

**Platform** – global tool search (Ctrl/Cmd + K), My Files (recent outputs in IndexedDB with preview/download/rename/delete and auto-expiry), Settings (defaults, compression, theme light/dark/system, privacy), reusable PDF viewer (thumbnails, zoom, fit width/page, rotate, navigation, full screen, text search), responsive layout, accessible controls, lazy-loaded tools and PDF libraries.

## 3. Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 7, Redux Toolkit, React Router 7, Material UI 7, React Hook Form + Zod, Axios, React Dropzone, dnd-kit, PDF.js, pdf-lib, JSZip, TanStack Virtual |
| Backend | Node.js 20+, Express 5, TypeScript (tsx dev / esbuild build), Multer, Zod, Helmet, CORS, express-rate-limit |
| PDF processing | pdf-lib, PDF.js (+ @napi-rs/canvas on the server), sharp, tesseract.js, puppeteer (HTML → PDF), mammoth, SheetJS (xlsx), docx, pptxgenjs |
| Optional system tools | LibreOffice (headless), Ghostscript, qpdf, Tesseract / OCRmyPDF, Poppler (`pdftoppm`) — auto-detected, used when present |
| Testing | Vitest, React Testing Library, Supertest, Playwright |

## 4. Installation

Prerequisites: **Node.js 20 or newer** and npm 10+.

```bash
git clone <this repository>
cd doc-convertor
npm install
```

`npm install` installs all workspaces. Puppeteer downloads a Chromium build for HTML → PDF (set `PUPPETEER_SKIP_DOWNLOAD=1` before installing to skip it; HTML → PDF then falls back to LibreOffice or a plain-text renderer).

## 5. Environment variables

Copy `.env.example` to `server/.env` (or the repo root) and `client/.env.example` to `client/.env`. All values are optional.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Server bind address |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins (`*` for all) |
| `TMP_DIR` | `<os tmp>/pdfly` | Uploads, outputs and work dirs (auto-cleaned) |
| `MAX_FILE_SIZE_MB` | `50` | Upload limit per file |
| `MAX_FILES_PER_REQUEST` | `50` | Files per request |
| `FILE_TTL_MINUTES` | `60` | How long results stay downloadable |
| `CLEANUP_INTERVAL_MINUTES` | `5` | Temp-file cleanup interval |
| `RATE_LIMIT_WINDOW_MINUTES` / `RATE_LIMIT_MAX` | `15` / `300` | API rate limit |
| `PROCESS_TIMEOUT_MS` | `300000` | Kill external processes after this |
| `ALLOW_URL_FETCH` | `true` | Allow HTML → PDF from URLs |
| `TESSDATA_DIR` | `<os tmp>/pdfly-tessdata` | tesseract.js language cache |
| `SERVE_CLIENT` / `CLIENT_DIST` | `false` / `../client/dist` | Serve the built client from the server |
| `SOFFICE_PATH`, `GHOSTSCRIPT_PATH`, `QPDF_PATH`, `TESSERACT_PATH`, `PDFTOPPM_PATH`, `OCRMYPDF_PATH` | auto-detect | Explicit paths to optional tools |
| `VITE_API_BASE_URL` | `/api` | Client API base (Vite proxies `/api` in dev) |
| `VITE_PROXY_TARGET` | `http://localhost:4000` | Dev proxy target |
| `VITE_MAX_FILE_SIZE_MB` | `50` | Client-side size validation |

## 6. Running the frontend

```bash
npm run dev:client      # Vite dev server on http://localhost:5173
```

## 7. Running the backend

```bash
npm run dev:server      # Express API on http://localhost:4000 (tsx watch)
```

Run both together:

```bash
npm run dev
```

Check `GET http://localhost:4000/api/health` to see which optional tools were detected.

## 8. Required system dependencies

Nothing beyond Node.js is required. Optional tools improve fidelity/speed and are used automatically when found on `PATH` (or via the `*_PATH` variables):

| Tool | Used for | Without it |
| --- | --- | --- |
| LibreOffice (`soffice`) | Word/PowerPoint/Excel → PDF, PDF → Word | Pure-JS conversion (mammoth / SheetJS / pptx parsing; reduced layout fidelity) |
| Ghostscript (`gs`) | Compression, PDF/A, repair | JS image re-compression, pdf-lib PDF/A tagging with built-in validation |
| qpdf | Repair | pdf-lib / PDF.js rebuild strategies |
| Tesseract / OCRmyPDF | OCR | tesseract.js (downloads language data on first use) |
| Poppler (`pdftoppm`) | Fast page rendering | PDF.js + @napi-rs/canvas |
| Chromium (via puppeteer) | HTML → PDF | LibreOffice or plain-text rendering |

Install examples: Ubuntu `sudo apt install libreoffice ghostscript qpdf tesseract-ocr poppler-utils`; macOS `brew install --cask libreoffice && brew install ghostscript qpdf tesseract poppler`; Windows: install LibreOffice, Ghostscript, qpdf and Tesseract and add them to `PATH`.

## 9. Production build

```bash
npm run build           # typechecks pdf-core, bundles server to server/dist, builds client to client/dist
npm start               # runs server/dist/index.js
```

Deploy options:

- **Single process**: set `SERVE_CLIENT=true` (and `CLIENT_DIST` if needed) so Express serves `client/dist` and the API on one port.
- **Separate hosting**: serve `client/dist` from any static host and set `VITE_API_BASE_URL` to the API URL at build time; set `CORS_ORIGINS` on the server.

Put the server behind a reverse proxy with a request body limit ≥ `MAX_FILE_SIZE_MB` and generous timeouts for long conversions.

## 10. Testing

```bash
npm run typecheck       # TypeScript for all workspaces
npm test                # Vitest: pdf-core, server (services + API), client (utils, slices, components, tools)
npm run test:e2e        # Playwright (starts client + server automatically); first run: npx playwright install chromium
```

Set `RUN_OCR_TESTS=1` to include the tesseract.js recognition test (needs internet for language data).

> **Corporate networks:** tesseract.js downloads language data over HTTPS on first use. Behind TLS-intercepting proxies Node may report `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`; start the server with `NODE_OPTIONS=--use-system-ca` (Node 22+) or set `NODE_EXTRA_CA_CERTS` to your CA bundle. Language data is cached in `TESSDATA_DIR` afterwards.

---

### API overview

All endpoints accept `multipart/form-data` (files under `files`, options as fields; arrays/objects as JSON strings) and return:

```json
{ "success": true, "data": { "files": [{ "id": "…", "name": "out.pdf", "size": 1234, "mimeType": "application/pdf", "url": "/api/files/<id>/download" }], "meta": {}, "warnings": [] }, "message": "PDF generated successfully" }
```

Errors: `{ "success": false, "error": { "code": "INVALID_FILE", "message": "The uploaded file is not supported." } }`.

| Method | Route |
| --- | --- |
| GET | `/api/health` |
| POST | `/api/pdf/info`, `/merge`, `/split`, `/remove-pages`, `/extract-pages`, `/organize`, `/compress`, `/repair`, `/ocr` |
| POST | `/api/convert/jpg-to-pdf`, `/word-to-pdf`, `/ppt-to-pdf`, `/excel-to-pdf`, `/html-to-pdf`, `/pdf-to-jpg`, `/pdf-to-word`, `/pdf-to-ppt`, `/pdf-to-excel`, `/pdf-to-pdfa` |
| POST | `/api/edit/rotate`, `/page-numbers`, `/watermark`, `/crop`, `/forms`, `/api/edit` |
| GET / PATCH / DELETE | `/api/files`, `/api/files/:id`, `/api/files/:id/download` |

### Security

File type validation by magic bytes (never by extension alone), size limits, filename sanitization, per-request isolated temp directories, automatic expiry of outputs, rate limiting, CORS allow-list, Helmet headers, external binaries invoked with argument arrays only (no shell), SSRF protection for URL rendering, no arbitrary file execution and no permanent storage.
