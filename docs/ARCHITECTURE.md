# PDFly architecture & conventions (read before adding a tool)

Monorepo (npm workspaces): `packages/pdf-core` (shared pdf-lib ops), `client` (React/Vite/MUI/Redux). There is **no backend**: every tool runs in the browser and the build is a static site.
Root scripts: `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

## Shared core: `@pdfly/core` (`packages/pdf-core/src`)
Pure pdf-lib functions used by the client tools. All page numbers are 1-based.
`mergePdfs, splitPdf, removePages, extractPages, organizePdf({sources, pages:[{source,page,rotate}]}), rotatePdf, addPageNumbers, addWatermark, cropPdf({box:{x,y,width,height fractions, origin top-left}, pages}), imagesToPdf(images[{data,mimeType,rotation(cw)}], opts), insertBlankPage, resavePdf, getPdfInfo, listFormFields, fillFormFields, addFormFields`, utils: `parsePageSelection(str,total)`, `parsePageRangeGroups`, `formatBytes`, `sanitizeFilename`, `stripExtension`, `withSuffix(name, suffix, ext)`, `PAGE_SIZES`, `resolvePageSize`.
Import in client: `import { mergePdfs } from '@pdfly/core'`.

## Client (`client/src`)
- `constants/tools.ts`: the tool registry `TOOLS` (id, slug, name, category, accept kinds, multiple, actionLabel). `TOOL_BY_ID`, `toolPath()`.
- `features/registry.ts`: maps tool id -> lazy component in `features/<category>/<Name>Tool.tsx`. **Each tool = one default-exported component file** named exactly as listed there.
- `hooks/useToolWorkflow(tool)`: the workflow engine. Returns `{ files, step, stage, progress, error, result, outputs, settings, addFiles, removeFile, renameFile, reorder, setOrder, rotateFile, updateFile, goToConfigure, goToUpload, clearError, run(processFn, initialStage), cancel, reset, getOutputBlob, downloadOutput, downloadAll, notify }`.
  - `run(async (ctx) => ProcessResult)`: `ctx = { files, settings, signal, getBlob(id), getBytes(id), setStage(label, progress0to1|null), setProgress }`. Return `{ outputs: [{ name, blob, mimeType?, pageCount? }], extra?, warnings? }`. Errors thrown are shown as friendly messages (throw `Error('...')` with a user-facing message, or an `{code,message}`).
  - Results are saved to My Files automatically (IndexedDB) and the workflow moves to step `done`.
- `hooks/useIncomingFiles(workflow)`: call once in every tool so files dropped on the Home page are picked up.
- `components/ToolWorkflow.tsx`: page layout for the 3 steps. Props: `workflow`, `configure` (ReactNode for step 2), optional `upload`, `uploadExtraActions`, `resultExtra`, `resultTitle`, `resultDescription`, `downloadLabel`, `wide`, `hideSidebar`, `processingHint`, `stepLabels`.
- `components/ConfigureLayout.tsx`: 2-column customize layout (main + sticky options panel + primary action; bottom sticky bar on mobile). Props: `children, options, optionsTitle, actionLabel, onAction, actionDisabled, actionIcon, secondaryActions, summary, onBack, backLabel`.
- Reusable components: `UploadDropzone, FileList (dnd-kit sortable), FileCard, PDFThumbnail, PageGrid (selection + drag reorder + rotate/delete/duplicate per page; pages: GridPage[{key, docKey, loaded, pageNumber, rotation, label, badge, dimmed}]), PDFViewer (fileId, ns:'input'|'output'|'blob', blob?, renderOverlay?(page,w,h,scale), onPageChange, zoom/onZoomChange, toolbarExtra, hideThumbnails, hideSearch), PageSelectionInput (+ pagesToRangeText), SettingsPanel/SettingRow, Modal, ConfirmDialog, ProgressBar, ProcessingIndicator, EmptyState, ErrorState, SuccessState, DownloadCard, ResultScreen, Toolbar (scrollable icon toolbar; actions[{id,label,icon,onClick,active,disabled,dividerBefore,shortcut}]), ResponsiveDrawer (side panel desktop / bottom sheet mobile), StepIndicator, ToolIcon, ToolCard, ToolSidebar, GlobalSearch, AppHeader, AppFooter`.
- Hooks: `usePdfDocument(fileId, ns)` -> `{ loaded, doc, numPages, loading, error, info }` (pdf.js doc, cached), `useThumbnail`, `usePageSelection(keys)` -> `{selected:Set, selectedList, toggle(key, shift), selectAll, clear, invert, set, undo}`, `useIsMobile/useIsPhone`, `useDebounce`, `useKeyboardShortcut`, `useObjectUrl`.
- Services: `services/pdfjs.ts` (`openPdf, getCachedPdf, renderPageToCanvas, renderThumbnail, renderPageToBlob, getPageText`), `services/fileRegistry.ts` (`fileRegistry` for inputs, `outputRegistry` for outputs; blobs by id), `services/errors.ts` (`toAppError`), `services/download.ts` (`downloadBlob, createZip, downloadAllAsZip`), `services/storage.ts` (IndexedDB), `services/pendingFiles.ts`.
- Utils: `utils/file.ts` (`validateFile, toFileMeta, readImageSize, normalizeImageForPdf(blob,{quality,maxDimension}) -> {data,mimeType}, isImageMime, isPdfMime, fileKindLabel, dropzoneAccept`), `utils/format.ts` (`formatBytes, formatDuration, formatDate, relativeTime, clamp, percent`).
- Redux (`store/slices`): `files` (FileMeta[]: id,name,size,type,rotation,pageCount...), `tool` (step/stage/progress/error/result), `pdf` (parsed page info per file id), `editor` (annotations + undo/redo for Edit PDF), `settings` (persisted), `history` (My Files), `ui` (drawer/search/snackbars). Use `useAppSelector/useAppDispatch` from `store/hooks`. Keep local UI state local (useState); only share via Redux when needed across components.
- Path alias `@/` = `client/src/`. Strict TS, `noUnusedLocals`. MUI v7 (`slotProps`, no `Grid` item props - use Box CSS grid).
- Reference implementation: `features/organize/MergePdfTool.tsx`. Tools call `@pdfly/core` or an engine from `engines/` inside `workflow.run`.
- Every tool must: show a clear title/description (from ToolWorkflow), upload -> configure (with live preview where sensible) -> process (stage labels like 'Analyzing...', 'Converting...', 'Generating PDF...') -> result (preview/download/start again). Buttons must be real; no placeholders. Mobile: no horizontal overflow, touch targets >= 44px, panels as bottom sheets (ResponsiveDrawer).
- Accessibility: aria-labels on icon buttons, keyboard alternatives for drag/drop (buttons for move up/down or selection), focus states come from theme.

## Engines (`client/src/engines`)
Heavy processing lives in framework-free modules that take bytes/Blobs and return bytes/Blobs, so they are unit-testable in Vitest:
`render.ts` (pdf.js page rendering + text extraction), `textLayout.ts` (text-layer reconstruction), `textPdf.ts` (pdf-lib text/HTML renderer), `pdfToImages`, `pdfToWord` (docx), `pdfToPpt` (pptxgenjs), `pdfToExcel` (SheetJS), `pdfToPdfa` (+ `srgbIcc.ts` generated ICC profile), `compress`, `repair`, `ocr` (tesseract.js), `office` (Word/PowerPoint/Excel -> PDF), `htmlToPdf` (text renderer + browser print), `imageConvert` (HEIC/HEIF/JPG/PNG).
- Accept `signal` for cancellation (`assertNotAborted`) and `onProgress(stage, fraction | null)`; throw `engineError(code, message)` for user-facing failures (`engines/common.ts`).
- Large libraries (docx, pptxgenjs, xlsx, mammoth, tesseract.js, heic-to) are imported dynamically so they only load with the tool that needs them.
- Tests: vitest + RTL in `client/src/**/*.test.{ts,tsx}` (setup in `client/src/test/setup.ts`); build fixture PDFs with pdf-lib, do not commit binaries. jsdom has no canvas: keep canvas code thin and test the pure helpers.

## Verification
`npm run typecheck` and `npm test` from the repo root must pass. Run `npx tsc -b` inside `client/` for a quick check. Deployment: `netlify.toml` (Netlify) and `.github/workflows/deploy-pages.yml` (GitHub Pages, sets `VITE_BASE_PATH`).
