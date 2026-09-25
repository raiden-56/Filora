import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import DeselectRoundedIcon from '@mui/icons-material/DeselectRounded';
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import FileDownloadDoneRoundedIcon from '@mui/icons-material/FileDownloadDoneRounded';
import { PDFDocument } from 'pdf-lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import PageGrid, { type GridPage } from '@/components/PageGrid';
import Toolbar, { type ToolbarAction } from '@/components/Toolbar';
import ErrorState from '@/components/ErrorState';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument } from '@/hooks/usePdfDocument';
import { usePageSelection } from '@/hooks/usePageSelection';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { TOOL_BY_ID } from '@/constants/tools';
import { fileRegistry } from '@/services/fileRegistry';
import { evictCachedPdf, getCachedPdf, type LoadedPdf } from '@/services/pdfjs';
import { dropzoneAccept, validateFile } from '@/utils/file';
import { newId } from '@/utils/id';
import { organizePdf, withSuffix } from '@pdfly/core';
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  createPages,
  deletePages,
  duplicatePages,
  insertPagesAfter,
  lastSelectedKey,
  movePage,
  pickPages,
  redoHistory,
  reorderPages,
  reversePages,
  rotatePages,
  shortName,
  sourceColor,
  toOrganizeOps,
  undoHistory,
  type History,
  type OrganizePageItem,
} from './organizePages';

const tool = TOOL_BY_ID.organize;

interface SourceDoc {
  /** id in fileRegistry (also the pdf.js cache key suffix) */
  id: string;
  name: string;
  kind: 'file' | 'pdf' | 'blank';
  color?: string;
  /** loaded pdf.js document (source 0 is read from usePdfDocument instead) */
  loaded: LoadedPdf | null;
}

const DEFAULT_PAGE: [number, number] = [595.28, 841.89];

export default function OrganizePdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const pdf = usePdfDocument(file?.id ?? null, 'input');

  const [sources, setSources] = useState<SourceDoc[]>([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const [history, setHistory] = useState<History<OrganizePageItem[]>>(() => createHistory<OrganizePageItem[]>([]));
  const historyRef = useRef(history);
  historyRef.current = history;
  const initializedFor = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const pages = history.present;
  const keys = useMemo(() => pages.map((p) => p.key), [pages]);
  const selection = usePageSelection(keys);
  const selectedCount = selection.selectedList.length;

  const cleanupExtraSources = useCallback(() => {
    for (const s of sourcesRef.current.slice(1)) {
      fileRegistry.remove(s.id);
      evictCachedPdf(`input:${s.id}`);
    }
  }, []);

  // Reset local state whenever the uploaded file changes.
  useEffect(() => {
    if (!file) {
      cleanupExtraSources();
      setSources([]);
      setHistory(createHistory<OrganizePageItem[]>([]));
      initializedFor.current = null;
      return;
    }
    if (initializedFor.current === file.id) return;
    cleanupExtraSources();
    setSources([{ id: file.id, name: file.name, kind: 'file', loaded: null }]);
    setHistory(createHistory<OrganizePageItem[]>([]));
    initializedFor.current = null;
  }, [file, cleanupExtraSources]);

  // Build the initial page list once the PDF is open. `pdf.info` is keyed by file id in Redux,
  // so (unlike `pdf.loaded`) it can never belong to a previously uploaded file.
  const info = pdf.info;
  useEffect(() => {
    if (!file || !info || info.status !== 'ready' || info.fileId !== file.id || initializedFor.current === file.id) return;
    initializedFor.current = file.id;
    setHistory(createHistory(createPages(0, info.pageCount)));
  }, [file, info]);

  // Remove extra sources when the tool unmounts (the workflow clears the rest).
  useEffect(() => () => cleanupExtraSources(), [cleanupExtraSources]);

  const loadedFor = useCallback((index: number): LoadedPdf | null => (index === 0 ? pdf.loaded : (sourcesRef.current[index]?.loaded ?? null)), [pdf.loaded]);

  const apply = useCallback((fn: (current: OrganizePageItem[]) => OrganizePageItem[]) => {
    setHistory((h) => commitHistory(h, fn(h.present)));
  }, []);

  // ------------------------------------------------------------------ actions
  const onReorder = useCallback((next: string[]) => apply((p) => reorderPages(p, next)), [apply]);
  const onRotate = useCallback((key: string, delta: number) => apply((p) => rotatePages(p, [key], delta)), [apply]);
  const onDelete = useCallback((key: string) => apply((p) => deletePages(p, [key])), [apply]);
  const onDuplicate = useCallback((key: string) => apply((p) => duplicatePages(p, [key]).pages), [apply]);

  const rotateSelected = (delta: number) => apply((p) => rotatePages(p, selection.selected, delta));
  const deleteSelected = () => {
    apply((p) => deletePages(p, selection.selected));
    selection.clear();
  };
  const duplicateSelected = () => apply((p) => duplicatePages(p, selection.selected).pages);
  const reverse = () => apply(reversePages);
  const undo = useCallback(() => setHistory((h) => undoHistory(h)), []);
  const redo = useCallback(() => setHistory((h) => redoHistory(h)), []);

  const singleKey = selectedCount === 1 ? selection.selectedList[0] : null;
  const moveSelected = useCallback(
    (delta: number) => {
      if (!singleKey) return;
      apply((p) => movePage(p, singleKey, delta));
    },
    [apply, singleKey],
  );
  useKeyboardShortcut('ArrowLeft', () => moveSelected(-1), { alt: true, enabled: Boolean(singleKey) });
  useKeyboardShortcut('ArrowRight', () => moveSelected(1), { alt: true, enabled: Boolean(singleKey) });
  useKeyboardShortcut('z', (e) => { e.preventDefault(); undo(); }, { ctrlOrMeta: true, enabled: canUndo(history) });
  useKeyboardShortcut('z', (e) => { e.preventDefault(); redo(); }, { ctrlOrMeta: true, shift: true, enabled: canRedo(history) });

  const registerSource = useCallback(async (blob: Blob, name: string, kind: SourceDoc['kind']): Promise<{ index: number; loaded: LoadedPdf }> => {
    const id = newId(kind === 'blank' ? 'blank' : 'src');
    fileRegistry.set(id, blob);
    try {
      const loaded = await getCachedPdf(`input:${id}`, async () => blob);
      const index = sourcesRef.current.length;
      const next: SourceDoc = { id, name, kind, loaded, color: kind === 'pdf' ? sourceColor(index) : undefined };
      sourcesRef.current = [...sourcesRef.current, next];
      setSources(sourcesRef.current);
      return { index, loaded };
    } catch (err) {
      fileRegistry.remove(id);
      throw err;
    }
  }, []);

  const insertBlank = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const current = historyRef.current.present;
      const afterKey = lastSelectedKey(current, selection.selected);
      const neighbour = afterKey ? current.find((p) => p.key === afterKey) : current[current.length - 1];
      let size = DEFAULT_PAGE;
      if (neighbour) {
        const l = loadedFor(neighbour.source);
        if (l) {
          const pg = await l.doc.getPage(neighbour.page);
          const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + neighbour.rotate) % 360 });
          size = [vp.width, vp.height];
        }
      }
      const doc = await PDFDocument.create();
      doc.addPage(size);
      const bytes = await doc.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const { index } = await registerSource(blob, 'Blank page', 'blank');
      apply((p) => insertPagesAfter(p, afterKey, createPages(index, 1)));
    } catch (err) {
      workflow.notify(err instanceof Error ? err.message : 'Could not insert a blank page.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addPdf = async (list: File[]) => {
    if (busy || !list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        const v = await validateFile(f, ['pdf']);
        if (!v.ok) {
          workflow.notify(v.error ?? 'Unsupported file.', 'error');
          continue;
        }
        try {
          const { index, loaded } = await registerSource(f, f.name, 'pdf');
          apply((p) => [...p, ...createPages(index, loaded.numPages)]);
          workflow.notify(`Added ${loaded.numPages} page${loaded.numPages === 1 ? '' : 's'} from "${f.name}".`, 'success');
        } catch (err) {
          workflow.notify(err instanceof Error ? err.message : `Could not open "${f.name}".`, 'error');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const runOrganize = useCallback(
    (list: OrganizePageItem[], suffix: string) => {
      const srcs = sourcesRef.current;
      void workflow.run(async (ctx) => {
        ctx.setStage('Analyzing...', 0);
        // Only load the sources that are actually referenced and renumber them compactly.
        const usedIndices = [...new Set(list.map((p) => p.source))].sort((a, b) => a - b);
        const remap = new Map(usedIndices.map((old, i) => [old, i]));
        const bytes: Uint8Array[] = [];
        for (let i = 0; i < usedIndices.length; i++) {
          const src = srcs[usedIndices[i]];
          const blob = src ? fileRegistry.get(src.id) : undefined;
          if (!blob) throw new Error(`"${src?.name ?? 'A source file'}" is no longer available. Please add it again.`);
          bytes.push(new Uint8Array(await blob.arrayBuffer()));
          ctx.setStage('Analyzing...', (i + 1) / usedIndices.length);
        }
        ctx.setStage('Processing...', null);
        const ops = toOrganizeOps(list).map((op) => ({ ...op, source: remap.get(op.source) ?? 0 }));
        const data = await organizePdf({ sources: bytes, pages: ops });
        ctx.setStage('Generating PDF...', 1);
        return {
          outputs: [
            {
              name: withSuffix(ctx.files[0].name, suffix),
              blob: new Blob([data as BlobPart], { type: 'application/pdf' }),
              mimeType: 'application/pdf',
              pageCount: list.length,
            },
          ],
        };
      }, 'Analyzing...');
    },
    [workflow],
  );

  const onSave = () => runOrganize(pages, '-organized');
  const onExtractSelected = () => runOrganize(pickPages(pages, selection.selected), '-extracted');

  const onBack = () => {
    cleanupExtraSources();
    workflow.reset();
  };

  // ------------------------------------------------------------------ grid
  const gridPages: GridPage[] = useMemo(
    () =>
      pages.map((p, i) => {
        const src = sources[p.source];
        const info = p.source === 0 ? pdf.info?.pages[p.page - 1] : undefined;
        const swapped = p.rotate === 90 || p.rotate === 270;
        const aspect = info && info.width && info.height ? (swapped ? info.height / info.width : info.width / info.height) : undefined;
        let badge: GridPage['badge'];
        if (src?.kind === 'blank') badge = <Chip size="small" label="Blank" variant="outlined" sx={{ height: 20, fontSize: 11, bgcolor: 'background.paper' }} />;
        else if (src && p.source > 0) badge = <Chip size="small" label={shortName(src.name)} sx={{ height: 20, fontSize: 11, fontWeight: 700, color: '#fff', bgcolor: src.color }} />;
        return {
          key: p.key,
          docKey: `input:${src?.id ?? ''}`,
          loaded: src ? (p.source === 0 ? pdf.loaded : src.loaded) : null,
          pageNumber: p.page,
          rotation: p.rotate,
          label: String(i + 1),
          aspect,
          badge,
        };
      }),
    [pages, sources, pdf.loaded, pdf.info],
  );

  const hasPages = pages.length > 0;
  const anySelected = selectedCount > 0;
  const actions: ToolbarAction[] = [
    { id: 'select-all', label: 'Select all', icon: <SelectAllRoundedIcon />, onClick: selection.selectAll, disabled: !hasPages || selectedCount === pages.length },
    { id: 'clear', label: 'Clear selection', icon: <DeselectRoundedIcon />, onClick: selection.clear, disabled: !anySelected },
    { id: 'rotate-left', label: 'Rotate selected left', icon: <RotateLeftRoundedIcon />, onClick: () => rotateSelected(-90), disabled: !anySelected, dividerBefore: true },
    { id: 'rotate-right', label: 'Rotate selected right', icon: <RotateRightRoundedIcon />, onClick: () => rotateSelected(90), disabled: !anySelected },
    { id: 'duplicate', label: 'Duplicate selected', icon: <ContentCopyRoundedIcon />, onClick: duplicateSelected, disabled: !anySelected },
    { id: 'delete', label: 'Delete selected', icon: <DeleteOutlineRoundedIcon />, onClick: deleteSelected, disabled: !anySelected },
    { id: 'move-left', label: 'Move left', icon: <KeyboardArrowLeftRoundedIcon />, onClick: () => moveSelected(-1), disabled: !singleKey, dividerBefore: true, shortcut: 'Alt+←' },
    { id: 'move-right', label: 'Move right', icon: <KeyboardArrowRightRoundedIcon />, onClick: () => moveSelected(1), disabled: !singleKey, shortcut: 'Alt+→' },
    { id: 'blank', label: anySelected ? 'Insert blank page after selection' : 'Insert blank page at end', icon: <NoteAddRoundedIcon />, onClick: () => void insertBlank(), disabled: busy, dividerBefore: true },
    { id: 'add-pdf', label: 'Add pages from another PDF', icon: <PictureAsPdfRoundedIcon />, onClick: () => pdfInputRef.current?.click(), disabled: busy },
    { id: 'reverse', label: 'Reverse order', icon: <SwapHorizRoundedIcon />, onClick: reverse, disabled: pages.length < 2 },
    { id: 'undo', label: 'Undo', icon: <UndoRoundedIcon />, onClick: undo, disabled: !canUndo(history), dividerBefore: true, shortcut: 'Ctrl+Z' },
    { id: 'redo', label: 'Redo', icon: <RedoRoundedIcon />, onClick: redo, disabled: !canRedo(history), shortcut: 'Ctrl+Shift+Z' },
  ];

  const summary = pdf.error
    ? 'This PDF could not be opened.'
    : !pdf.loaded
      ? 'Reading pages...'
      : `${pages.length} page${pages.length === 1 ? '' : 's'}${sources.length > 1 ? ` from ${sources.filter((s) => s.kind !== 'blank').length} file${sources.filter((s) => s.kind !== 'blank').length === 1 ? '' : 's'}` : ''}${anySelected ? ` · ${selectedCount} selected` : ''}`;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="PDF saved"
      resultDescription="Your reorganized PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<SaveRoundedIcon />}
          actionDisabled={!hasPages || Boolean(pdf.error) || busy}
          onAction={onSave}
          summary={summary}
          onBack={onBack}
          backLabel="Change file"
          optionsTitle="Organize"
          secondaryActions={
            <Button variant="outlined" fullWidth startIcon={<FileDownloadDoneRoundedIcon />} onClick={onExtractSelected} disabled={!anySelected || busy}>
              Extract selected{anySelected ? ` (${selectedCount})` : ''}
            </Button>
          }
          options={
            <>
              <Typography variant="body2" color="text.secondary">
                Drag pages to reorder (or focus a page&apos;s move handle, press Space and use the arrow keys). Click to select, shift-click for a range.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                With one page selected, use <strong>Move left / right</strong> or Alt+Arrow keys instead of dragging.
              </Typography>
              {sources.length > 1 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    Sources
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {sources.map((s, i) => (
                      <Chip
                        key={s.id}
                        size="small"
                        label={i === 0 ? shortName(s.name) : s.kind === 'blank' ? 'Blank' : shortName(s.name)}
                        variant={s.kind === 'blank' || i === 0 ? 'outlined' : 'filled'}
                        sx={s.color ? { bgcolor: s.color, color: '#fff', fontWeight: 700 } : undefined}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              {!hasPages && pdf.loaded && <Alert severity="warning">The document would be empty. Add pages, or use Undo to restore deleted pages.</Alert>}
            </>
          }
        >
          <Stack spacing={2}>
            {pdf.error && <ErrorState error={pdf.error} title="Cannot open this PDF" onRetry={onBack} retryLabel="Choose another file" />}
            {!pdf.error && file && (
              <>
                <Toolbar actions={actions} ariaLabel="Page actions" end={anySelected ? <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{selectedCount} selected</Typography> : undefined} />
                {!hasPages && pdf.loaded && <Alert severity="warning">The document would be empty. Add pages, or use Undo to restore deleted pages.</Alert>}
                <PageGrid
                  pages={gridPages}
                  selected={selection.selected}
                  onToggleSelect={selection.toggle}
                  onReorder={onReorder}
                  onRotate={onRotate}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  size="sm"
                  ariaLabel="Pages of the document"
                />
                <input
                  ref={pdfInputRef}
                  type="file"
                  multiple
                  accept={Object.values(dropzoneAccept(['pdf'])).flat().join(',')}
                  hidden
                  aria-label="Add pages from another PDF"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void addPdf(list);
                  }}
                />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
