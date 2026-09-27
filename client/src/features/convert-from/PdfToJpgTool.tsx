import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ImageResultsGrid from '@/components/ImageResultsGrid';
import ConfigureLayout from '@/components/ConfigureLayout';
import PageGrid, { type GridPage } from '@/components/PageGrid';
import PageSelectionInput from '@/components/PageSelectionInput';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { pdfCacheKey, usePdfDocument } from '@/hooks/usePdfDocument';
import { usePageSelection } from '@/hooks/usePageSelection';
import { TOOL_BY_ID } from '@/constants/tools';
import { pdfToImages } from '@/engines/pdfToImages';
import { formatBytes } from '@/utils/format';
import { stripExtension } from '@pdfly/core';

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
    void workflow.run(async (ctx) => {
      const input = ctx.files[0];
      ctx.setStage('Rendering pages...', 0);
      const bytes = await ctx.getBytes(input.id);
      const r = await pdfToImages(bytes, {
        format,
        quality,
        dpi,
        pages,
        signal: ctx.signal,
        onProgress: (done, total) => ctx.setStage('Rendering pages...', done / total),
      });
      const base = stripExtension(input.name);
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      return {
        outputs: r.files.map((f) => ({ name: `${base}-page-${f.page}.${format}`, blob: f.blob, mimeType })),
        extra: { engine: r.engine, pages: r.files.length, dpi },
      };
    }, 'Rendering pages...');
  }, [workflow, mode, selectedPages, format, quality, dpi]);

  const count = effectivePages.length;
  const actionDisabled = !file || Boolean(pdfError) || count === 0;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Conversion complete"
      resultDescription={workflow.outputs.length > 1 ? `${workflow.outputs.length} images are ready. Download them one by one or all at once as a ZIP.` : 'Your image is ready.'}
      downloadLabel={workflow.outputs.length > 1 ? 'Download All (ZIP)' : `Download ${format.toUpperCase()}`}
      resultExtra={<ImageResultsGrid workflow={workflow} />}
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
