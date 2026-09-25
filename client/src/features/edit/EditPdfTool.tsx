import { Alert, Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material';
import NearMeRoundedIcon from '@mui/icons-material/NearMeRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import GestureRoundedIcon from '@mui/icons-material/GestureRounded';
import BorderColorRoundedIcon from '@mui/icons-material/BorderColorRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import StrikethroughSRoundedIcon from '@mui/icons-material/StrikethroughSRounded';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded';
import ArrowRightAltRoundedIcon from '@mui/icons-material/ArrowRightAltRounded';
import RectangleRoundedIcon from '@mui/icons-material/RectangleRounded';
import CheckBoxRoundedIcon from '@mui/icons-material/CheckBoxRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import AutoFixOffRoundedIcon from '@mui/icons-material/AutoFixOffRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import LayersClearRoundedIcon from '@mui/icons-material/LayersClearRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import Toolbar, { type ToolbarAction } from '@/components/Toolbar';
import PDFViewer from '@/components/PDFViewer';
import ResponsiveDrawer from '@/components/ResponsiveDrawer';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { useIsMobile } from '@/hooks/useIsMobile';
import { TOOL_BY_ID } from '@/constants/tools';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  clearPageAnnotations,
  initEditor,
  redo,
  removeAnnotation,
  resetEditor,
  selectAnnotation,
  setEditorPage,
  setEditorStyle,
  setEditorTool,
  setEditorZoom,
  undo,
  type EditorTool,
} from '@/store/slices/editorSlice';
import { applyAnnotations, withSuffix } from '@pdfly/core';
import EditorPageOverlay from './editorOverlay';
import { HIGHLIGHT_DEFAULT } from './editorHistory';
import EditorStylePanel from './editorStylePanel';
import EditorImageDialog, { type PickedImage } from './editorImageDialog';
import { clearImageStore, collectImages } from './editorImageStore';

const tool = TOOL_BY_ID.edit;

type ShapeVariant = 'rect' | 'ellipse' | 'line' | 'arrow' | 'whiteout';

const SHAPES: { id: ShapeVariant; label: string; icon: React.ReactNode; shortcut?: string }[] = [
  { id: 'rect', label: 'Rectangle', icon: <CropSquareRoundedIcon fontSize="small" />, shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: <CircleOutlinedIcon fontSize="small" />, shortcut: 'O' },
  { id: 'line', label: 'Line', icon: <HorizontalRuleRoundedIcon fontSize="small" />, shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', icon: <ArrowRightAltRoundedIcon fontSize="small" />, shortcut: 'A' },
  { id: 'whiteout', label: 'Whiteout (cover text)', icon: <RectangleRoundedIcon fontSize="small" />, shortcut: 'W' },
];

export default function EditPdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const dispatch = useAppDispatch();
  const mobile = useIsMobile();
  const file = workflow.files[0];
  const editorTool = useAppSelector((s) => s.editor.tool);
  const annotations = useAppSelector((s) => s.editor.annotations);
  const selectedId = useAppSelector((s) => s.editor.selectedId);
  const canUndo = useAppSelector((s) => s.editor.past.length > 0);
  const canRedo = useAppSelector((s) => s.editor.future.length > 0);
  const zoom = useAppSelector((s) => s.editor.zoom);
  const currentPage = useAppSelector((s) => s.editor.currentPage);
  const pageCount = useAppSelector((s) => (file ? s.pdf.docs[file.id]?.pageCount ?? 0 : 0));

  const [whiteout, setWhiteout] = useState(false);
  const [shapesAnchor, setShapesAnchor] = useState<HTMLElement | null>(null);
  const [imageDialog, setImageDialog] = useState<'image' | 'signature' | null>(null);
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const preHighlightStyle = useRef<{ color: string; opacity: number } | null>(null);

  // Editor lifecycle
  useEffect(() => {
    if (file?.id) dispatch(initEditor({ fileId: file.id }));
  }, [dispatch, file?.id]);
  useEffect(
    () => () => {
      dispatch(resetEditor());
      clearImageStore();
    },
    [dispatch],
  );

  const selectTool = useCallback(
    (t: EditorTool, opts: { whiteout?: boolean } = {}) => {
      setWhiteout(Boolean(opts.whiteout));
      setEditingId(null);
      setShapesAnchor(null);
      // highlight gets a sensible default style; restore the previous colour afterwards
      if (t === 'highlight' && editorTool !== 'highlight') {
        preHighlightStyle.current = null;
        dispatch(setEditorStyle(HIGHLIGHT_DEFAULT));
      } else if (t !== 'highlight' && editorTool === 'highlight') {
        dispatch(setEditorStyle({ color: '#DC2626', opacity: 1 }));
      }
      if (t === 'image' || t === 'signature') {
        setPendingImage(null);
        setImageDialog(t);
      }
      dispatch(setEditorTool(t));
    },
    [dispatch, editorTool],
  );

  const deleteSelected = useCallback(() => {
    if (selectedId) dispatch(removeAnnotation(selectedId));
  }, [dispatch, selectedId]);

  // Keyboard shortcuts (ignored while typing in inputs)
  const enabled = workflow.step === 'configure' && !editingId;
  useKeyboardShortcut('z', () => dispatch(undo()), { ctrlOrMeta: true, enabled });
  useKeyboardShortcut('z', () => dispatch(redo()), { ctrlOrMeta: true, shift: true, enabled });
  useKeyboardShortcut('y', () => dispatch(redo()), { ctrlOrMeta: true, enabled });
  useKeyboardShortcut('Delete', deleteSelected, { enabled });
  useKeyboardShortcut('Backspace', deleteSelected, { enabled });
  useKeyboardShortcut('Escape', () => {
    setPendingImage(null);
    if (editorTool !== 'select') selectTool('select');
    else dispatch(selectAnnotation(null));
  }, { enabled: workflow.step === 'configure' && !editingId && !imageDialog });
  useKeyboardShortcut('v', () => selectTool('select'), { enabled });
  useKeyboardShortcut('t', () => selectTool('text'), { enabled });
  useKeyboardShortcut('i', () => selectTool('image'), { enabled });
  useKeyboardShortcut('d', () => selectTool('draw'), { enabled });
  useKeyboardShortcut('h', () => selectTool('highlight'), { enabled });
  useKeyboardShortcut('u', () => selectTool('underline'), { enabled });
  useKeyboardShortcut('x', () => selectTool('strikeout'), { enabled });
  useKeyboardShortcut('r', () => selectTool('rect'), { enabled });
  useKeyboardShortcut('o', () => selectTool('ellipse'), { enabled });
  useKeyboardShortcut('l', () => selectTool('line'), { enabled });
  useKeyboardShortcut('a', () => selectTool('arrow'), { enabled });
  useKeyboardShortcut('w', () => selectTool('rect', { whiteout: true }), { enabled });
  useKeyboardShortcut('c', () => selectTool('checkbox'), { enabled });
  useKeyboardShortcut('s', () => selectTool('signature'), { enabled });
  useKeyboardShortcut('e', () => selectTool('erase'), { enabled });

  const shapeActive = ['rect', 'ellipse', 'line', 'arrow'].includes(editorTool);

  const actions: ToolbarAction[] = useMemo(
    () => [
      { id: 'select', label: 'Select', icon: <NearMeRoundedIcon />, active: editorTool === 'select', onClick: () => selectTool('select'), shortcut: 'V' },
      { id: 'text', label: 'Text', icon: <TextFieldsRoundedIcon />, active: editorTool === 'text', onClick: () => selectTool('text'), shortcut: 'T' },
      { id: 'image', label: 'Image', icon: <ImageRoundedIcon />, active: editorTool === 'image', onClick: () => selectTool('image'), shortcut: 'I' },
      { id: 'draw', label: 'Draw', icon: <GestureRoundedIcon />, active: editorTool === 'draw', onClick: () => selectTool('draw'), shortcut: 'D' },
      { id: 'highlight', label: 'Highlight', icon: <BorderColorRoundedIcon />, active: editorTool === 'highlight', onClick: () => selectTool('highlight'), shortcut: 'H' },
      { id: 'underline', label: 'Underline', icon: <FormatUnderlinedRoundedIcon />, active: editorTool === 'underline', onClick: () => selectTool('underline'), shortcut: 'U' },
      { id: 'strikeout', label: 'Strike-through', icon: <StrikethroughSRoundedIcon />, active: editorTool === 'strikeout', onClick: () => selectTool('strikeout'), shortcut: 'X' },
      { id: 'shapes', label: 'Shapes', icon: <CategoryRoundedIcon />, active: shapeActive, onClick: () => setShapesAnchor(document.querySelector<HTMLElement>('[data-editor-toolbar] [aria-label="Shapes"]')), shortcut: 'R, O, L, A, W' },
      { id: 'checkbox', label: 'Checkbox', icon: <CheckBoxRoundedIcon />, active: editorTool === 'checkbox', onClick: () => selectTool('checkbox'), shortcut: 'C' },
      { id: 'signature', label: 'Signature', icon: <DrawRoundedIcon />, active: editorTool === 'signature', onClick: () => selectTool('signature'), shortcut: 'S' },
      { id: 'erase', label: 'Erase', icon: <AutoFixOffRoundedIcon />, active: editorTool === 'erase', onClick: () => selectTool('erase'), shortcut: 'E' },
      { id: 'undo', label: 'Undo', icon: <UndoRoundedIcon />, onClick: () => dispatch(undo()), disabled: !canUndo, dividerBefore: true, shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', icon: <RedoRoundedIcon />, onClick: () => dispatch(redo()), disabled: !canRedo, shortcut: 'Ctrl+Shift+Z' },
      { id: 'delete', label: 'Delete selected', icon: <DeleteRoundedIcon />, onClick: deleteSelected, disabled: !selectedId, shortcut: 'Delete' },
      { id: 'clear', label: 'Clear page', icon: <LayersClearRoundedIcon />, onClick: () => dispatch(clearPageAnnotations(currentPage)), disabled: !annotations.some((a) => a.page === currentPage) },
    ],
    [editorTool, shapeActive, canUndo, canRedo, selectedId, currentPage, annotations, selectTool, deleteSelected, dispatch],
  );

  const onSave = useCallback(() => {
    if (!file) return;
    setEditingId(null);
    const snapshot = annotations;
    const images = collectImages(snapshot.map((a) => a.imageId));
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', null);
      const bytes = await ctx.getBytes(file.id);
      ctx.setStage('Generating PDF...', null);
      const data = await applyAnnotations(bytes, snapshot, images);
      const blob = new Blob([data as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(file.name, '-edited'), blob, mimeType: 'application/pdf', pageCount: pageCount || undefined }] };
    }, 'Analyzing...');
  }, [file, annotations, workflow, pageCount]);

  const requestReset = () => {
    if (annotations.length) setConfirmReset(true);
    else workflow.reset();
  };

  const renderOverlay = useCallback(
    (page: number, w: number, h: number, scale: number) => (
      <EditorPageOverlay
        page={page}
        widthPx={w}
        heightPx={h}
        scale={scale}
        pendingImage={pendingImage}
        onImagePlaced={() => setPendingImage(null)}
        onRequestImage={(kind) => setImageDialog(kind)}
        whiteout={whiteout}
        editingId={editingId}
        onEditingChange={setEditingId}
      />
    ),
    [pendingImage, whiteout, editingId],
  );

  const onPageChange = useCallback((p: number) => dispatch(setEditorPage(p)), [dispatch]);
  const onZoomChange = useCallback((z: number) => dispatch(setEditorZoom(z)), [dispatch]);

  const saveButton = (
    <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={onSave} disabled={!file} data-testid="primary-action" fullWidth={mobile}>
      Save PDF
    </Button>
  );

  const hint = pendingImage
    ? `Click or drag on the page to place your ${editorTool === 'signature' ? 'signature' : 'image'}.`
    : editorTool === 'text'
      ? 'Click on the page to add a text box.'
      : editorTool === 'draw'
        ? 'Draw on the page with the mouse, finger or pen.'
        : editorTool === 'checkbox'
          ? 'Click on the page to place a checkbox.'
          : editorTool === 'erase'
            ? 'Click an annotation to remove it.'
            : editorTool === 'image' || editorTool === 'signature'
              ? `Choose ${editorTool === 'signature' ? 'a signature' : 'an image'}, then click on the page to place it.`
            : whiteout
              ? 'Drag a white box over text you want to hide, then add new text on top.'
              : editorTool === 'select'
                ? null
                : 'Drag on the page to draw.';

  const configure = (
    <Stack spacing={1.5} data-testid="editor">
      <Box data-editor-toolbar sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Toolbar
          ariaLabel="Editor tools"
          size="small"
          actions={actions}
          sx={{ flex: 1, minWidth: 0 }}
          end={
            <>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', px: 0.5 }} aria-live="polite">
                Page {currentPage}{pageCount ? ` / ${pageCount}` : ''}
              </Typography>
              {mobile && (
                <Button size="small" startIcon={<TuneRoundedIcon />} onClick={() => setStylePanelOpen(true)} aria-label="Open style panel">
                  Style
                </Button>
              )}
            </>
          }
        />
        {!mobile && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button color="inherit" onClick={requestReset}>
              Change file
            </Button>
            {saveButton}
          </Stack>
        )}
      </Box>
      <Menu open={Boolean(shapesAnchor)} anchorEl={shapesAnchor} onClose={() => setShapesAnchor(null)} slotProps={{ list: { 'aria-label': 'Shapes' } }}>
        {SHAPES.map((s) => (
          <MenuItem key={s.id} selected={s.id === 'whiteout' ? whiteout && editorTool === 'rect' : editorTool === s.id && !whiteout} onClick={() => (s.id === 'whiteout' ? selectTool('rect', { whiteout: true }) : selectTool(s.id))}>
            <ListItemIcon>{s.icon}</ListItemIcon>
            <ListItemText primary={s.label} secondary={s.shortcut ? `Shortcut: ${s.shortcut}` : undefined} />
          </MenuItem>
        ))}
      </Menu>

      {annotations.length === 0 && !hint && (
        <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
          Pick a tool and click on the page. Existing text cannot be edited in place; use <strong>Shapes &gt; Whiteout</strong> to cover it and add new text on top. Shortcuts: V select, T text, D draw, H highlight, Ctrl+Z undo.
        </Alert>
      )}
      {hint && (
        <Alert severity="info" variant="outlined" sx={{ py: 0.5 }} role="status">
          {hint}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
        <Box sx={{ flex: 1, minWidth: 0, height: { xs: 'calc(100vh - 300px)', md: 'calc(100vh - 280px)' }, minHeight: 420 }}>
          {file && (
            <PDFViewer
              fileId={file.id}
              ns="input"
              renderOverlay={renderOverlay}
              onPageChange={onPageChange}
              zoom={zoom}
              onZoomChange={onZoomChange}
              hideSearch
              hideThumbnails={mobile}
            />
          )}
        </Box>
        {!mobile && (
          <Paper component="aside" aria-label="Style" variant="outlined" sx={{ width: 288, flexShrink: 0, p: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Style
            </Typography>
            <EditorStylePanel />
          </Paper>
        )}
      </Box>

      {mobile && (
        <Paper elevation={8} sx={{ position: 'sticky', bottom: 0, p: 1.5, zIndex: 10, borderRadius: '16px 16px 0 0', display: 'flex', gap: 1 }}>
          <Button color="inherit" onClick={requestReset} sx={{ flexShrink: 0 }}>
            Change file
          </Button>
          {saveButton}
        </Paper>
      )}

      <ResponsiveDrawer open={mobile && stylePanelOpen} onClose={() => setStylePanelOpen(false)} title="Style">
        <EditorStylePanel />
      </ResponsiveDrawer>

      <EditorImageDialog
        open={imageDialog !== null}
        kind={imageDialog ?? 'image'}
        onClose={() => {
          setImageDialog(null);
          if (!pendingImage) dispatch(setEditorTool('select'));
        }}
        onPick={(img) => {
          setPendingImage(img);
          const kind = imageDialog ?? 'image';
          setImageDialog(null);
          dispatch(setEditorTool(kind));
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        title="Discard your changes?"
        message={`You have ${annotations.length} unsaved annotation${annotations.length === 1 ? '' : 's'}. Starting over will discard them.`}
        confirmLabel="Discard and start over"
        destructive
        onConfirm={() => {
          setConfirmReset(false);
          workflow.reset();
        }}
        onClose={() => setConfirmReset(false)}
      />
    </Stack>
  );

  return (
    <ToolWorkflow
      workflow={workflow}
      wide
      hideSidebar
      configure={configure}
      resultTitle="PDF saved"
      resultDescription="Your annotations have been added to the PDF."
      downloadLabel="Download PDF"
      processingHint="Drawing annotations into the PDF..."
    />
  );
}
