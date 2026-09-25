import { Alert, Box, Button, Card, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Slider, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import PageGrid, { type GridPage } from '@/components/PageGrid';
import PageSelectionInput from '@/components/PageSelectionInput';
import { useToolWorkflow, type ToolWorkflow as Workflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { pdfCacheKey, usePdfDocument } from '@/hooks/usePdfDocument';
import { usePageSelection } from '@/hooks/usePageSelection';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';
import { outputRegistry } from '@/services/fileRegistry';
import { formatBytes } from '@/utils/format';
import ServerToolNotice from './ServerToolNotice';

const tool = TOOL_BY_ID['pdf-to-jpg'];

type ImageFormat = 'jpg' | 'png';
type PageMode = 'all' | 'selected';

const DPI_OPTIONS: { value: number; label: string }[] = [
  { value: 72, label: '72 dpi – small files, thumbnails' },
  { value: 96, label: '96 dpi – web pages' },
  { value: 150, label: '150 dpi – good for screens' },
  { value: 200, label: '200 dpi – sharp, presentations' },
  { value: 300, label: '300 dpi – print quality' },
];

/** Rough output size estimate (bytes) from page sizes in points, resolution and encoder settings. */
function estimateBytes(pages: { width: number; height: number }[], dpi: number, format: ImageFormat, quality: number): number {
  let total = 0;
  for (const p of pages) {
    const pixels = ((p.width / 72) * dpi) * ((p.height / 72) * dpi);
    const bytesPerPixel = format === 'png' ? 0.35 : 0.03 + 0.22 * Math.pow(quality / 100, 2);
    total += pixels * bytesPerPixel;
  }
  return total;
}

function ImageResults({ workflow }: { workflow: Workflow }) {
  const { outputs } = workflow;
  if (!outputs.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="image-results">
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
        {outputs.length} image{outputs.length === 1 ? '' : 's'}
      </Typography>
      <Box role="list" aria-label="Converted images" sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {outputs.map((o, i) => {
          const url = outputRegistry.objectUrl(o.id);
          return (
            <Card key={o.id} role="listitem" variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ aspectRatio: '0.707', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', borderRadius: 1.5, overflow: 'hidden' }}>
                {url ? (
                  <Box component="img" src={url} alt={`Image ${i + 1}: ${o.name}`} loading="lazy" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
                ) : (
                  <ImageRoundedIcon color="disabled" />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, minWidth: 0 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" noWrap display="block" title={o.name} sx={{ fontWeight: 600 }}>
                    {o.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatBytes(o.size)}
                  </Typography>
                </Box>
                <Tooltip title="Download">
                  <IconButton size="small" aria-label={`Download ${o.name}`} onClick={() => workflow.downloadOutput(o.id)} sx={{ minWidth: 44, minHeight: 44 }}>
                    <DownloadRoundedIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Card>
          );
        })}
      </Box>
    </Paper>
  );
}

export default function PdfToJpgTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const fileId = file?.id ?? null;
  const { loaded, numPages, error: pdfError, info } = usePdfDocument(fileId, 'input');

  const [format, setFormat] = useState<ImageFormat>('jpg');
  const [quality, setQuality] = useState(workflow.settings.imageQuality);
  const [dpi, setDpi] = useState(150);
  const [mode, setMode] = useState<PageMode>('all');

  const keys = useMemo(() => Array.from({ length: numPages }, (_, i) => String(i + 1)), [numPages]);
  const selection = usePageSelection(keys);
  const { set: setSelection, selectAll, toggle } = selection;

  // Default: every page selected, "All pages" mode, whenever a (new) document is loaded.
  useEffect(() => {
    if (numPages > 0) {
      setSelection(keys);
      setMode('all');
    }
  }, [numPages, keys, setSelection]);

  const selectedPages = useMemo(() => selection.selectedList.map(Number).sort((a, b) => a - b), [selection.selectedList]);
  const effectivePages = mode === 'all' ? keys.map(Number) : selectedPages;

  const gridPages = useMemo<GridPage[]>(
    () =>
      fileId
        ? keys.map((k, i) => ({
            key: k,
            docKey: pdfCacheKey('input', fileId),
            loaded,
            pageNumber: i + 1,
            rotation: 0,
            label: k,
            aspect: info?.pages[i] ? info.pages[i].width / info.pages[i].height : undefined,
          }))
        : [],
    [fileId, keys, loaded, info],
  );

  const onToggle = useCallback(
    (key: string, shift: boolean) => {
      if (mode === 'all') setMode('selected');
      toggle(key, shift);
    },
    [mode, toggle],
  );

  const onModeChange = (next: PageMode | null) => {
    if (!next) return;
    setMode(next);
    if (next === 'all') selectAll();
  };

  const estimate = useMemo(() => {
    const pagesInfo = info?.pages ?? [];
    const chosen = effectivePages.map((n) => pagesInfo[n - 1]).filter(Boolean);
    return chosen.length ? estimateBytes(chosen, dpi, format, quality) : 0;
  }, [info, effectivePages, dpi, format, quality]);

  const onConvert = useCallback(() => {
    const pages = mode === 'all' ? undefined : selectedPages;
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/convert/pdf-to-jpg',
          fields: { format, quality, dpi, pages },
          processingStage: 'Rendering pages...',
        }),
      'Uploading...',
    );
  }, [workflow, mode, selectedPages, format, quality, dpi]);

  const count = effectivePages.length;
  const actionDisabled = !file || Boolean(pdfError) || count === 0;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Conversion complete"
      resultDescription={workflow.outputs.length > 1 ? `${workflow.outputs.length} images are ready. Download them one by one or all at once as a ZIP.` : 'Your image is ready.'}
      downloadLabel={workflow.outputs.length > 1 ? 'Download All (ZIP)' : `Download ${format.toUpperCase()}`}
      resultExtra={<ImageResults workflow={workflow} />}
      configure={
        file && (
          <ConfigureLayout
            actionLabel={count === 0 ? 'Select at least 1 page' : `Convert ${count} page${count === 1 ? '' : 's'} to ${format.toUpperCase()}`}
            actionIcon={<ImageRoundedIcon />}
            actionDisabled={actionDisabled}
            onAction={onConvert}
            summary={
              <>
                {count} of {numPages || '…'} pages · {format.toUpperCase()} · {dpi} dpi
                {estimate > 0 && (
                  <>
                    <br />
                    Estimated output: about {formatBytes(estimate)} in total
                  </>
                )}
              </>
            }
            onBack={workflow.reset}
            backLabel="Change file"
            options={
              <>
                <FormControl fullWidth>
                  <InputLabel id="img-format-label">Image format</InputLabel>
                  <Select labelId="img-format-label" id="img-format" label="Image format" value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
                    <MenuItem value="jpg">JPG – smaller files, photos</MenuItem>
                    <MenuItem value="png">PNG – lossless, sharp text</MenuItem>
                  </Select>
                </FormControl>
                {format === 'jpg' && (
                  <Box>
                    <Typography id="jpg-quality-label" variant="subtitle2" sx={{ fontWeight: 600 }}>
                      JPG quality: {quality}
                    </Typography>
                    <Slider
                      aria-labelledby="jpg-quality-label"
                      value={quality}
                      min={10}
                      max={100}
                      step={5}
                      marks={[
                        { value: 10, label: 'Small' },
                        { value: 100, label: 'Best' },
                      ]}
                      valueLabelDisplay="auto"
                      onChange={(_, v) => setQuality(Array.isArray(v) ? v[0] : v)}
                    />
                  </Box>
                )}
                <FormControl fullWidth>
                  <InputLabel id="img-dpi-label">Resolution</InputLabel>
                  <Select labelId="img-dpi-label" id="img-dpi" label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                    {DPI_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }} id="page-mode-label">
                    Pages
                  </Typography>
                  <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v: PageMode | null) => onModeChange(v)} aria-labelledby="page-mode-label">
                    <ToggleButton value="all" sx={{ minHeight: 44 }}>
                      All pages
                    </ToggleButton>
                    <ToggleButton value="selected" sx={{ minHeight: 44 }}>
                      Selected pages
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                {mode === 'selected' && numPages > 0 && (
                  <PageSelectionInput totalPages={numPages} value={selectedPages} onChange={(pages) => setSelection(pages.map(String))} label="Pages to convert" />
                )}
                <Typography variant="caption" color="text.secondary">
                  {estimate > 0 ? `Estimated output size: about ${formatBytes(estimate)} (${count} image${count === 1 ? '' : 's'}). ` : ''}
                  Higher resolution and quality give sharper images but larger files.
                </Typography>
              </>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice />
              {pdfError && <Alert severity="error">{pdfError}</Alert>}
              {!pdfError && (
                <>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 160 }}>
                      Click a page to include or exclude it. Shift-click selects a range.
                    </Typography>
                    <Button size="small" onClick={() => onModeChange('all')} disabled={mode === 'all'}>
                      Select all
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setMode('selected');
                        selection.clear();
                      }}
                      disabled={count === 0}
                    >
                      Clear
                    </Button>
                  </Stack>
                  <PageGrid pages={gridPages} selected={selection.selected} onToggleSelect={onToggle} size="sm" ariaLabel="Pages to convert" />
                </>
              )}
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
