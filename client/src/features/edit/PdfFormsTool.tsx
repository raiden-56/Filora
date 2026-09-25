import { Alert, Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, Tab, Tabs, Typography } from '@mui/material';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import PostAddRoundedIcon from '@mui/icons-material/PostAddRounded';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import ToolWorkflow from '@/components/ToolWorkflow';
import PDFViewer from '@/components/PDFViewer';
import EmptyState from '@/components/EmptyState';
import ResponsiveDrawer from '@/components/ResponsiveDrawer';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { useIsMobile } from '@/hooks/useIsMobile';
import { TOOL_BY_ID } from '@/constants/tools';
import { fileRegistry } from '@/services/fileRegistry';
import { useAppSelector } from '@/store/hooks';
import { newId } from '@/utils/id';
import { addFormFields, fillFormFields, listFormFields, withSuffix, type FormFieldInfo, type FormValue } from '@pdfly/core';
import FormsFillOverlay from './formsFillOverlay';
import FormsFieldPanel from './formsFieldPanel';
import FormsAddOverlay from './formsAddOverlay';
import FormsAddPanel from './formsAddPanel';
import { toNewFormFields, type DraftField, type FormValues, type PaletteKind } from './formsTypes';

const tool = TOOL_BY_ID.forms;

type Mode = 'fill' | 'add';

function defaultsFrom(fields: FormFieldInfo[]): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (f.kind === 'checkbox') out[f.name] = f.value === true;
    else if (f.kind === 'optionlist') out[f.name] = Array.isArray(f.value) ? f.value : [];
    else if (f.kind === 'text' || f.kind === 'radio' || f.kind === 'dropdown') out[f.name] = typeof f.value === 'string' ? f.value : '';
  }
  return out;
}

/** Only the values that differ from the document's current values are written back. */
function changedValues(fields: FormFieldInfo[], values: FormValues): Record<string, FormValue> {
  const defaults = defaultsFrom(fields);
  const out: Record<string, FormValue> = {};
  for (const [name, v] of Object.entries(values)) {
    const d = defaults[name];
    if (JSON.stringify(v) !== JSON.stringify(d)) out[name] = v;
  }
  return out;
}

export default function PdfFormsTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const mobile = useIsMobile();
  const file = workflow.files[0];
  const pageCount = useAppSelector((s) => (file ? s.pdf.docs[file.id]?.pageCount ?? 0 : 0));

  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('fill');
  const [flatten, setFlatten] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // Add-fields state
  const [drafts, setDrafts] = useState<DraftField[]>([]);
  const [activeKind, setActiveKind] = useState<PaletteKind | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);

  const form = useForm<FormValues>({ defaultValues: {} });
  const { control, reset, getValues, formState } = form;

  // Scan the uploaded PDF for form fields.
  useEffect(() => {
    if (!file?.id) {
      setFields(null);
      return;
    }
    let cancelled = false;
    setFields(null);
    setScanError(null);
    setDrafts([]);
    setSelectedDraft(null);
    setActiveKind(null);
    (async () => {
      try {
        const bytes = await fileRegistry.bytes(file.id);
        const list = await listFormFields(bytes);
        if (cancelled) return;
        setFields(list);
        reset(defaultsFrom(list));
        setMode(list.some((f) => f.kind !== 'button' && f.kind !== 'unknown') ? 'fill' : 'add');
      } catch (err) {
        if (cancelled) return;
        setFields([]);
        setScanError(err instanceof Error ? err.message : 'Could not read the form fields of this PDF.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file?.id, reset]);

  const fillable = useMemo(() => (fields ?? []).filter((f) => f.kind !== 'button' && f.kind !== 'unknown'), [fields]);

  const placeDraft = useCallback((kind: PaletteKind, page: number, rect: DraftField['rect']) => {
    setDrafts((list) => {
      const n = list.filter((d) => d.kind === kind).length + 1;
      const options = kind === 'radio' ? ['Option 1', 'Option 2'] : kind === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : [];
      const id = newId('fld');
      setSelectedDraft(id);
      return [...list, { id, kind, name: `${kind}_${n}`, page, rect, options }];
    });
    setActiveKind(null);
  }, []);

  const updateDraft = useCallback((id: string, patch: Partial<DraftField>) => setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d))), []);
  const removeDraft = useCallback((id: string) => {
    setDrafts((list) => list.filter((d) => d.id !== id));
    setSelectedDraft((s) => (s === id ? null : s));
  }, []);

  const onSave = useCallback(() => {
    if (!file) return;
    const values = getValues();
    const dirty = formState.isDirty;
    const currentFields = fields ?? [];
    const draftsNow = drafts;
    const modeNow = mode;
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', null);
      let bytes = await ctx.getBytes(file.id);
      const toWrite = dirty ? changedValues(currentFields, values) : {};
      if (modeNow === 'add') {
        if (!draftsNow.length) throw new Error('Add at least one field before saving.');
        ctx.setStage('Generating PDF...', 0.3);
        bytes = await addFormFields(bytes, toNewFormFields(draftsNow));
        if (Object.keys(toWrite).length || flatten) {
          ctx.setStage('Generating PDF...', 0.7);
          bytes = await fillFormFields(bytes, toWrite, { flatten });
        }
      } else {
        ctx.setStage('Generating PDF...', 0.5);
        bytes = await fillFormFields(bytes, toWrite, { flatten });
      }
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(file.name, modeNow === 'add' ? '-form' : '-filled'), blob, mimeType: 'application/pdf', pageCount: pageCount || undefined }] };
    }, 'Analyzing...');
  }, [file, getValues, formState.isDirty, fields, drafts, mode, flatten, workflow, pageCount]);

  const renderOverlay = useCallback(
    (page: number, w: number, h: number, scale: number) =>
      mode === 'fill' ? (
        <FormsFillOverlay page={page} widthPx={w} heightPx={h} fields={fillable} control={control} />
      ) : (
        <FormsAddOverlay
          page={page}
          widthPx={w}
          heightPx={h}
          scale={scale}
          fields={drafts}
          activeKind={activeKind}
          selectedId={selectedDraft}
          onSelect={setSelectedDraft}
          onPlace={placeDraft}
          onMove={(id, rect) => updateDraft(id, { rect })}
        />
      ),
    [mode, fillable, control, drafts, activeKind, selectedDraft, placeDraft, updateDraft],
  );

  const saveDisabled = !file || fields === null || (mode === 'add' ? drafts.length === 0 : fillable.length === 0);
  const saveLabel = mode === 'add' ? 'Save PDF with fields' : 'Save filled PDF';

  const panel = (
    <Stack spacing={2.5}>
      {mode === 'fill' ? (
        <>
          <FormsFieldPanel fields={fillable} control={control} />
          <FormControlLabel control={<Switch checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />} label="Flatten (make non-editable)" />
        </>
      ) : (
        <>
          <FormsAddPanel fields={drafts} activeKind={activeKind} onActiveKindChange={setActiveKind} selectedId={selectedDraft} onSelect={setSelectedDraft} onUpdate={updateDraft} onRemove={removeDraft} />
          {fillable.length > 0 && <FormControlLabel control={<Switch checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />} label="Flatten existing fields" />}
        </>
      )}
    </Stack>
  );

  const saveButton = (
    <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={onSave} disabled={saveDisabled} data-testid="primary-action" fullWidth={mobile}>
      {saveLabel}
    </Button>
  );

  const configure = (
    <Stack spacing={1.5} data-testid="forms-tool">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Tabs value={mode} onChange={(_, v: Mode) => { setMode(v); setActiveKind(null); }} aria-label="Form mode" sx={{ flex: 1, minWidth: 0 }}>
          <Tab value="fill" label={`Fill form${fillable.length ? ` (${fillable.length})` : ''}`} />
          <Tab value="add" label={`Add fields${drafts.length ? ` (${drafts.length})` : ''}`} />
        </Tabs>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }} aria-live="polite">
          Page {currentPage}{pageCount ? ` / ${pageCount}` : ''}
        </Typography>
        {mobile ? (
          <Button size="small" startIcon={<TuneRoundedIcon />} onClick={() => setPanelOpen(true)} aria-label="Open fields panel">
            Fields
          </Button>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button color="inherit" onClick={workflow.reset}>
              Change file
            </Button>
            {saveButton}
          </Stack>
        )}
      </Box>

      {scanError && <Alert severity="warning">{scanError}</Alert>}
      {fields === null && !scanError && (
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Looking for form fields...
          </Typography>
        </Stack>
      )}

      {fields !== null && mode === 'fill' && fillable.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState
            icon={<PostAddRoundedIcon />}
            title="This PDF has no form fields"
            description="Switch to the Add fields tab to place text fields, checkboxes, radio groups, dropdowns, date and signature fields anywhere on the document."
            actionLabel="Add fields"
            onAction={() => setMode('add')}
          />
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
          <Box sx={{ flex: 1, minWidth: 0, height: { xs: 'calc(100vh - 300px)', md: 'calc(100vh - 280px)' }, minHeight: 420 }}>
            {file && (
              <PDFViewer fileId={file.id} ns="input" renderOverlay={renderOverlay} onPageChange={setCurrentPage} zoom={zoom} onZoomChange={setZoom} hideSearch hideThumbnails={mobile} />
            )}
          </Box>
          {!mobile && (
            <Paper component="aside" aria-label={mode === 'fill' ? 'Form fields' : 'Add fields'} variant="outlined" sx={{ width: 320, flexShrink: 0, p: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {mode === 'fill' ? 'Fields' : 'Add fields'}
              </Typography>
              {panel}
            </Paper>
          )}
        </Box>
      )}

      {mobile && (
        <Paper elevation={8} sx={{ position: 'sticky', bottom: 0, p: 1.5, zIndex: 10, borderRadius: '16px 16px 0 0', display: 'flex', gap: 1 }}>
          <Button color="inherit" onClick={workflow.reset} sx={{ flexShrink: 0 }}>
            Change file
          </Button>
          {saveButton}
        </Paper>
      )}
      <ResponsiveDrawer open={mobile && panelOpen} onClose={() => setPanelOpen(false)} title={mode === 'fill' ? 'Fields' : 'Add fields'}>
        {panel}
      </ResponsiveDrawer>
    </Stack>
  );

  return (
    <ToolWorkflow
      workflow={workflow}
      wide
      hideSidebar
      configure={configure}
      resultTitle="Form saved"
      resultDescription={mode === 'add' ? 'Your form fields have been added to the PDF.' : 'Your filled form is ready.'}
      downloadLabel="Download PDF"
      processingHint="Writing form fields..."
    />
  );
}
