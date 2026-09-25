import { Box, Button, IconButton, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import CropRoundedIcon from '@mui/icons-material/CropRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import ErrorState from '@/components/ErrorState';
import PageSelectionInput from '@/components/PageSelectionInput';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument, pdfCacheKey } from '@/hooks/usePdfDocument';
import { TOOL_BY_ID } from '@/constants/tools';
import { cropPdf, withSuffix } from '@pdfly/core';
import { PageStrip, aspectFromInfo, useElementWidth, usePageCanvas } from './pagePreview';
import { FULL_RECT, applyDrag, clampRect, detectContentBounds, mmToPt, ptToMm, type CropDragMode, type CropHandle, type FractionRect } from './placement';

const tool = TOOL_BY_ID.crop;

type Handle = CropHandle;
type DragMode = CropDragMode;
type ApplyMode = 'current' | 'all' | 'custom';
type Unit = 'percent' | 'mm';

const HANDLES: { id: Handle; label: string; cursor: string; style: React.CSSProperties }[] = [
  { id: 'nw', label: 'top left corner', cursor: 'nwse-resize', style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' } },
  { id: 'n', label: 'top edge', cursor: 'ns-resize', style: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' } },
  { id: 'ne', label: 'top right corner', cursor: 'nesw-resize', style: { left: '100%', top: 0, transform: 'translate(-50%, -50%)' } },
  { id: 'e', label: 'right edge', cursor: 'ew-resize', style: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' } },
  { id: 'se', label: 'bottom right corner', cursor: 'nwse-resize', style: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)' } },
  { id: 's', label: 'bottom edge', cursor: 'ns-resize', style: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)' } },
  { id: 'sw', label: 'bottom left corner', cursor: 'nesw-resize', style: { left: 0, top: '100%', transform: 'translate(-50%, -50%)' } },
  { id: 'w', label: 'left edge', cursor: 'ew-resize', style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
];

/** Numeric input with a local draft so typing is not fought by re-formatting. */
function NumberField({ label, value, unit, onCommit, id }: { label: string; value: number; unit: string; onCommit: (v: number) => void; id: string }) {
  const [draft, setDraft] = useState(value.toFixed(1));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value.toFixed(1));
  }, [value, focused]);
  const commit = () => {
    const n = Number(draft.replace(',', '.'));
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(value.toFixed(1));
  };
  return (
    <TextField
      id={id}
      label={label}
      value={draft}
      size="small"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `${label} in ${unit}` }, input: { endAdornment: <Typography variant="caption" color="text.secondary">{unit}</Typography> } }}
      fullWidth
    />
  );
}

export default function CropPdfTool() {
  const theme = useTheme();
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const fileId = file?.id ?? null;
  const { loaded, numPages, loading, error, info } = usePdfDocument(fileId, 'input');
  const docKey = fileId ? pdfCacheKey('input', fileId) : '';

  const [page, setPage] = useState(1);
  const [rect, setRectRaw] = useState<FractionRect>(FULL_RECT);
  const setRect = useCallback((r: FractionRect) => setRectRaw(clampRect(r)), []);
  const [applyMode, setApplyMode] = useState<ApplyMode>('all');
  const [customPages, setCustomPages] = useState<number[]>([]);
  const [unit, setUnit] = useState<Unit>('percent');
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(wrapRef);
  const maxWidth = Math.min(containerWidth || 0, 800);
  const canvas = usePageCanvas(loaded, page, maxWidth);
  const { width: cw, height: ch, pageWidthPt, pageHeightPt } = canvas;

  useEffect(() => {
    if (numPages && page > numPages) setPage(1);
  }, [numPages, page]);

  // ----- dragging (pointer events: mouse + touch) -----
  const drag = useRef<{ mode: DragMode; startX: number; startY: number; start: FractionRect; pointerId: number } | null>(null);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect, pointerId: e.pointerId };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      areaRef.current?.focus({ preventScroll: true });
    },
    [rect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId || !cw || !ch) return;
      e.preventDefault();
      const dx = (e.clientX - d.startX) / cw;
      const dy = (e.clientY - d.startY) / ch;
      setRectRaw(applyDrag(d.start, d.mode, dx, dy));
    },
    [cw, ch],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  }, []);

  // ----- keyboard nudging -----
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      setRectRaw((r) => (e.altKey ? applyDrag(r, 'se', dx, dy) : applyDrag(r, 'move', dx, dy)));
    },
    [],
  );

  // ----- numeric fields -----
  const toUnit = useCallback((fraction: number, axis: 'x' | 'y') => (unit === 'percent' ? fraction * 100 : ptToMm(fraction * (axis === 'x' ? pageWidthPt : pageHeightPt))), [unit, pageWidthPt, pageHeightPt]);
  const fromUnit = useCallback(
    (v: number, axis: 'x' | 'y') => {
      if (unit === 'percent') return v / 100;
      const pt = axis === 'x' ? pageWidthPt : pageHeightPt;
      return pt ? mmToPt(v) / pt : 0;
    },
    [unit, pageWidthPt, pageHeightPt],
  );
  const unitLabel = unit === 'percent' ? '%' : 'mm';
  const commitField = (key: keyof FractionRect, axis: 'x' | 'y') => (v: number) => {
    const f = fromUnit(v, axis);
    const next = { ...rect, [key]: f };
    if (key === 'x') next.width = Math.min(rect.width, 1 - f);
    if (key === 'y') next.height = Math.min(rect.height, 1 - f);
    setRect(next);
  };

  // ----- auto-detect -----
  const autoDetect = useCallback(() => {
    const el = canvas.canvasRef.current;
    if (!el || !el.width) return;
    const ctx = el.getContext('2d', { alpha: false });
    if (!ctx) return;
    try {
      const img = ctx.getImageData(0, 0, el.width, el.height);
      const found = detectContentBounds(img, { threshold: 245, padding: 0.02, stride: el.width > 1200 ? 2 : 1 });
      if (!found) {
        setDetectMsg('No content detected on this page.');
        return;
      }
      setDetectMsg(null);
      setRect(found);
    } catch {
      setDetectMsg('Could not analyse this page.');
    }
  }, [canvas.canvasRef, setRect]);

  const targetPages = useMemo(() => (applyMode === 'current' ? [page] : applyMode === 'custom' ? customPages : undefined), [applyMode, page, customPages]);
  const targetCount = targetPages ? targetPages.length : numPages;
  const isFull = rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1;

  const onApply = useCallback(() => {
    if (!file) return;
    const box = rect;
    const pages = targetPages;
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', null);
      const data = await ctx.getBytes(file.id);
      ctx.setStage('Processing...', null);
      const out = await cropPdf(data, { box, pages });
      ctx.setStage('Generating PDF...', null);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(file.name, '-cropped'), blob, mimeType: 'application/pdf', pageCount: numPages || undefined }] };
    }, 'Analyzing...');
  }, [workflow, file, rect, targetPages, numPages]);

  const wMm = ptToMm(rect.width * pageWidthPt);
  const hMm = ptToMm(rect.height * pageHeightPt);
  const summary = !loaded
    ? 'Loading document...'
    : isFull
      ? 'Drag the handles to choose the crop area.'
      : targetCount === 0
        ? 'Choose at least one page.'
        : `Crop to ${Math.round(rect.width * 100)}% × ${Math.round(rect.height * 100)}%${pageWidthPt ? ` (${wMm.toFixed(0)} × ${hMm.toFixed(0)} mm)` : ''} on ${targetCount} of ${numPages} page${numPages === 1 ? '' : 's'}.`;

  const handleSize = 28;
  const stripBadge = useCallback((p: number) => (applyMode === 'all' || (applyMode === 'current' && p === page) || (applyMode === 'custom' && customPages.includes(p)) ? 'crop' : undefined), [applyMode, page, customPages]);

  return (
    <ToolWorkflow
      workflow={workflow}
      wide
      resultTitle="Crop applied"
      resultDescription="Your cropped PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<CropRoundedIcon />}
          actionDisabled={!loaded || isFull || targetCount === 0}
          onAction={onApply}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Crop area"
          options={
            <>
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">Dimensions</Typography>
                  <ToggleButtonGroup exclusive size="small" value={unit} onChange={(_, v: Unit | null) => v && setUnit(v)} aria-label="Units">
                    <ToggleButton value="percent" aria-label="Percent" sx={{ px: 1.5, minHeight: 32 }}>
                      %
                    </ToggleButton>
                    <ToggleButton value="mm" aria-label="Millimetres" sx={{ px: 1.5, minHeight: 32 }} disabled={!pageWidthPt}>
                      mm
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  <NumberField id="crop-left" label="Left" unit={unitLabel} value={toUnit(rect.x, 'x')} onCommit={commitField('x', 'x')} />
                  <NumberField id="crop-top" label="Top" unit={unitLabel} value={toUnit(rect.y, 'y')} onCommit={commitField('y', 'y')} />
                  <NumberField id="crop-width" label="Width" unit={unitLabel} value={toUnit(rect.width, 'x')} onCommit={commitField('width', 'x')} />
                  <NumberField id="crop-height" label="Height" unit={unitLabel} value={toUnit(rect.height, 'y')} onCommit={commitField('height', 'y')} />
                </Box>
                {pageWidthPt > 0 && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                    Page {ptToMm(pageWidthPt).toFixed(0)} × {ptToMm(pageHeightPt).toFixed(0)} mm · result {wMm.toFixed(1)} × {hMm.toFixed(1)} mm
                  </Typography>
                )}
              </Box>

              <Stack spacing={1}>
                <Typography variant="subtitle2">Presets</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button variant="outlined" size="small" startIcon={<ContentCutRoundedIcon />} onClick={() => setRect({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })} sx={{ minHeight: 40 }}>
                    Trim margins 5%
                  </Button>
                  <Button variant="outlined" size="small" startIcon={<AutoFixHighRoundedIcon />} onClick={autoDetect} disabled={!cw} sx={{ minHeight: 40 }}>
                    Auto-detect margins
                  </Button>
                  <Button variant="text" color="inherit" size="small" startIcon={<RestartAltRoundedIcon />} onClick={() => setRect(FULL_RECT)} disabled={isFull} sx={{ minHeight: 40 }}>
                    Reset
                  </Button>
                </Stack>
                {detectMsg && (
                  <Typography variant="caption" color="warning.main" role="status">
                    {detectMsg}
                  </Typography>
                )}
              </Stack>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Apply to
                </Typography>
                <ToggleButtonGroup exclusive fullWidth size="small" value={applyMode} onChange={(_, v: ApplyMode | null) => v && setApplyMode(v)} aria-label="Apply to">
                  <ToggleButton value="current" sx={{ minHeight: 44, textTransform: 'none' }}>
                    Current page
                  </ToggleButton>
                  <ToggleButton value="all" sx={{ minHeight: 44, textTransform: 'none' }}>
                    All pages
                  </ToggleButton>
                  <ToggleButton value="custom" sx={{ minHeight: 44, textTransform: 'none' }}>
                    Custom
                  </ToggleButton>
                </ToggleButtonGroup>
                {applyMode === 'custom' && (
                  <Box sx={{ mt: 1.5 }}>
                    <PageSelectionInput totalPages={numPages} value={customPages} onChange={setCustomPages} id="crop-pages" />
                  </Box>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">
                Tip: focus the crop area and use the arrow keys to move it by 1% (Shift = 5%, Alt = resize). The same area is applied to every selected page.
              </Typography>
            </>
          }
        >
          <Stack spacing={1.5}>
            {error && <ErrorState error={error} title="Could not open this PDF" onRetry={workflow.reset} retryLabel="Choose another file" />}
            {loading && !loaded && <Skeleton variant="rounded" height={480} />}
            {loaded && (
              <>
                <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                    {file?.name}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <IconButton aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                      <ChevronLeftRoundedIcon />
                    </IconButton>
                    <Typography variant="body2" sx={{ minWidth: 90, textAlign: 'center' }} aria-live="polite">
                      Page {page} of {numPages}
                    </Typography>
                    <IconButton aria-label="Next page" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>
                      <ChevronRightRoundedIcon />
                    </IconButton>
                  </Stack>
                </Stack>

                <Box ref={wrapRef} sx={{ width: '100%', display: 'flex', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 3, p: { xs: 1, sm: 2 }, minHeight: 240 }}>
                  <Box
                    ref={areaRef}
                    tabIndex={0}
                    role="application"
                    aria-label={`Crop area: left ${Math.round(rect.x * 100)}%, top ${Math.round(rect.y * 100)}%, width ${Math.round(rect.width * 100)}%, height ${Math.round(rect.height * 100)}%. Use arrow keys to move.`}
                    onKeyDown={onKeyDown}
                    sx={{
                      position: 'relative',
                      lineHeight: 0,
                      boxShadow: 3,
                      bgcolor: '#fff',
                      maxWidth: '100%',
                      touchAction: 'none',
                      userSelect: 'none',
                      outline: 'none',
                      '&:focus-visible': { boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.4)}` },
                    }}
                  >
                    <canvas ref={canvas.canvasRef} role="img" aria-label={`Page ${page}`} style={{ display: 'block', maxWidth: '100%', opacity: canvas.loading ? 0.5 : 1, transition: 'opacity 150ms ease' }} />
                    {!cw && <Skeleton variant="rectangular" width={Math.max(200, maxWidth)} height={Math.max(280, maxWidth * 1.3)} />}
                    {cw > 0 && (
                      <>
                        {/* dimmed area outside the crop rectangle */}
                        <Box aria-hidden sx={{ position: 'absolute', left: 0, top: 0, width: cw, height: rect.y * ch, bgcolor: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
                        <Box aria-hidden sx={{ position: 'absolute', left: 0, top: (rect.y + rect.height) * ch, width: cw, height: Math.max(0, ch - (rect.y + rect.height) * ch), bgcolor: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
                        <Box aria-hidden sx={{ position: 'absolute', left: 0, top: rect.y * ch, width: rect.x * cw, height: rect.height * ch, bgcolor: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
                        <Box aria-hidden sx={{ position: 'absolute', left: (rect.x + rect.width) * cw, top: rect.y * ch, width: Math.max(0, cw - (rect.x + rect.width) * cw), height: rect.height * ch, bgcolor: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
                      </>
                    )}
                    {cw > 0 && (
                      <Box
                        data-testid="crop-rect"
                        onPointerDown={onPointerDown('move')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        sx={{
                          position: 'absolute',
                          left: rect.x * cw,
                          top: rect.y * ch,
                          width: rect.width * cw,
                          height: rect.height * ch,
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          cursor: 'move',
                          backgroundImage:
                            'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
                          backgroundSize: '33.34% 33.34%',
                        }}
                      >
                        {HANDLES.map((h) => (
                          <Tooltip key={h.id} title={`Resize ${h.label}`} enterDelay={600}>
                            <Box
                              role="presentation"
                              onPointerDown={onPointerDown(h.id)}
                              onPointerMove={onPointerMove}
                              onPointerUp={onPointerUp}
                              onPointerCancel={onPointerUp}
                              style={h.style}
                              sx={{ position: 'absolute', width: handleSize, height: handleSize, display: 'grid', placeItems: 'center', cursor: h.cursor, touchAction: 'none' }}
                            >
                              <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: 'background.paper', border: '2px solid', borderColor: 'primary.main', boxShadow: 1 }} />
                            </Box>
                          </Tooltip>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
                {canvas.error && <ErrorState error={canvas.error} title="Preview unavailable" />}
                <PageStrip loaded={loaded} docKey={docKey} numPages={numPages} current={page} onChange={setPage} aspectFor={(p) => aspectFromInfo(info?.pages, p)} badgeFor={stripBadge} ariaLabel="Pages" />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
