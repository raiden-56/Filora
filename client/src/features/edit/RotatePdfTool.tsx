import { Box, Button, Chip, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import Rotate90DegreesCwRoundedIcon from '@mui/icons-material/Rotate90DegreesCwRounded';
import { useCallback, useMemo, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import PageGrid, { type GridPage } from '@/components/PageGrid';
import ErrorState from '@/components/ErrorState';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument, pdfCacheKey } from '@/hooks/usePdfDocument';
import { usePageSelection } from '@/hooks/usePageSelection';
import { TOOL_BY_ID } from '@/constants/tools';
import { rotatePdf, normalizeAngle, withSuffix } from '@pdfly/core';
import { aspectFromInfo } from './pagePreview';

const tool = TOOL_BY_ID.rotate;

function norm(a: number) {
  return normalizeAngle(a);
}

export default function RotatePdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const fileId = file?.id ?? null;
  const { loaded, numPages, loading, error, info } = usePdfDocument(fileId, 'input');
  const docKey = fileId ? pdfCacheKey('input', fileId) : '';

  /** accumulated clockwise rotation per page number (only non-zero entries kept) */
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const keys = useMemo(() => Array.from({ length: numPages }, (_, i) => String(i + 1)), [numPages]);
  const selection = usePageSelection(keys);
  const selectedPages = useMemo(() => selection.selectedList.map(Number), [selection.selectedList]);
  const hasSelection = selectedPages.length > 0;
  const targetPages = hasSelection ? selectedPages : keys.map(Number);

  const applyDelta = useCallback((pages: number[], delta: number) => {
    setRotations((prev) => {
      const next = { ...prev };
      for (const p of pages) {
        const v = norm((next[p] ?? 0) + delta);
        if (v === 0) delete next[p];
        else next[p] = v;
      }
      return next;
    });
  }, []);

  const setAngle = useCallback((pages: number[], angle: number) => {
    setRotations((prev) => {
      const next = { ...prev };
      for (const p of pages) {
        const v = norm(angle);
        if (v === 0) delete next[p];
        else next[p] = v;
      }
      return next;
    });
  }, []);

  const onRotate = useCallback((key: string, delta: number) => applyDelta([Number(key)], delta), [applyDelta]);

  // Value of the "Rotate all / selected" group: the common angle of the target pages, if uniform.
  const groupValue = useMemo(() => {
    if (!targetPages.length) return null;
    const first = rotations[targetPages[0]] ?? 0;
    return targetPages.every((p) => (rotations[p] ?? 0) === first) && first !== 0 ? first : null;
  }, [rotations, targetPages]);

  const pages: GridPage[] = useMemo(
    () =>
      keys.map((k) => {
        const p = Number(k);
        const rotation = rotations[p] ?? 0;
        return {
          key: k,
          docKey,
          loaded,
          pageNumber: p,
          rotation,
          label: k,
          aspect: aspectFromInfo(info?.pages, p),
          badge: rotation ? <Chip size="small" color="primary" label={`${rotation}°`} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} /> : undefined,
        };
      }),
    [keys, rotations, docKey, loaded, info?.pages],
  );

  const rotatedCount = Object.keys(rotations).length;

  const onApply = useCallback(() => {
    if (!file) return;
    const plan = rotations;
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', 0);
      let data = await ctx.getBytes(file.id);
      // group pages by their rotation delta -> one rotatePdf call per distinct angle
      const groups = new Map<number, number[]>();
      for (const [k, v] of Object.entries(plan)) {
        const angle = norm(v);
        if (!angle) continue;
        const list = groups.get(angle) ?? [];
        list.push(Number(k));
        groups.set(angle, list);
      }
      const entries = [...groups.entries()];
      ctx.setStage('Processing...', 0);
      for (let i = 0; i < entries.length; i++) {
        const [angle, list] = entries[i];
        data = await rotatePdf(data, { angle, pages: list.sort((a, b) => a - b) });
        ctx.setStage('Processing...', (i + 1) / entries.length);
        if (ctx.signal.aborted) throw { code: 'CANCELLED', message: 'Cancelled' };
      }
      ctx.setStage('Generating PDF...', null);
      const blob = new Blob([data as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(file.name, '-rotated'), blob, mimeType: 'application/pdf', pageCount: numPages || undefined }] };
    }, 'Analyzing...');
  }, [workflow, file, rotations, numPages]);

  const scopeLabel = hasSelection ? `${selectedPages.length} selected` : 'all';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Rotation applied"
      resultDescription="Your rotated PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<Rotate90DegreesCwRoundedIcon />}
          actionDisabled={!loaded || rotatedCount === 0}
          onAction={onApply}
          summary={rotatedCount === 0 ? 'Rotate pages using the buttons to get started.' : `${rotatedCount} of ${numPages} page${numPages === 1 ? '' : 's'} will be rotated.`}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Rotate"
          options={
            <>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Rotate {scopeLabel} pages
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={groupValue}
                  onChange={(_, v: number | null) => {
                    if (v !== null) setAngle(targetPages, v);
                  }}
                  aria-label={`Rotate ${scopeLabel} pages`}
                  disabled={!loaded}
                >
                  <ToggleButton value={90} aria-label="Rotate 90 degrees clockwise" sx={{ minHeight: 44 }}>
                    90°
                  </ToggleButton>
                  <ToggleButton value={180} aria-label="Rotate 180 degrees" sx={{ minHeight: 44 }}>
                    180°
                  </ToggleButton>
                  <ToggleButton value={270} aria-label="Rotate 270 degrees clockwise" sx={{ minHeight: 44 }}>
                    270°
                  </ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                  {hasSelection ? 'Applies to the selected pages. Clear the selection to rotate every page.' : 'Applies to every page. Select pages in the grid to rotate only those.'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Tooltip title={hasSelection ? 'Rotate selected pages 90° counter-clockwise' : 'Select pages first'}>
                  <span style={{ flex: 1 }}>
                    <Button fullWidth variant="outlined" startIcon={<RotateLeftRoundedIcon />} disabled={!hasSelection} onClick={() => applyDelta(selectedPages, -90)} sx={{ minHeight: 44 }}>
                      Selected −90°
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={hasSelection ? 'Rotate selected pages 90° clockwise' : 'Select pages first'}>
                  <span style={{ flex: 1 }}>
                    <Button fullWidth variant="outlined" startIcon={<RotateRightRoundedIcon />} disabled={!hasSelection} onClick={() => applyDelta(selectedPages, 90)} sx={{ minHeight: 44 }}>
                      Selected +90°
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={selection.selectAll} disabled={!numPages}>
                  Select all
                </Button>
                <Button size="small" onClick={selection.clear} disabled={!hasSelection}>
                  Clear selection
                </Button>
              </Stack>
              <Button variant="text" color="inherit" startIcon={<RestartAltRoundedIcon />} onClick={() => setRotations({})} disabled={rotatedCount === 0}>
                Reset all rotations
              </Button>
              <Typography variant="caption" color="text.secondary">
                Tip: click a page to select it, shift-click to select a range. Use the arrows under each page to rotate it individually.
              </Typography>
            </>
          }
        >
          <Stack spacing={2}>
            {error && <ErrorState error={error} title="Could not open this PDF" onRetry={workflow.reset} retryLabel="Choose another file" />}
            {loading && !loaded && (
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} variant="rounded" sx={{ aspectRatio: '0.75', height: 'auto' }} />
                ))}
              </Box>
            )}
            {loaded && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {file?.name} · {numPages} page{numPages === 1 ? '' : 's'}
                  {hasSelection ? ` · ${selectedPages.length} selected` : ''}
                </Typography>
                <PageGrid pages={pages} selected={selection.selected} onToggleSelect={selection.toggle} onRotate={onRotate} ariaLabel="Pages to rotate" />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
