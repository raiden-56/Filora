import { Alert, Box, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import { useCallback, useMemo, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import PageGrid, { type GridPage } from '@/components/PageGrid';
import PageSelectionInput from '@/components/PageSelectionInput';
import ErrorState from '@/components/ErrorState';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument } from '@/hooks/usePdfDocument';
import { usePageSelection } from '@/hooks/usePageSelection';
import { TOOL_BY_ID } from '@/constants/tools';
import { splitPdf, type SplitMode } from '@pdfly/core';
import { describeSplit, splitGroups } from './organizePages';

const tool = TOOL_BY_ID.split;

type Mode = SplitMode['type'];

const MODE_LABELS: Record<Mode, string> = {
  every: 'Every page',
  ranges: 'Page ranges',
  pages: 'Selected pages',
  chunk: 'Every N pages',
};

export default function SplitPdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const pdf = usePdfDocument(file?.id ?? null, 'input');
  const total = pdf.numPages;

  const [mode, setMode] = useState<Mode>('every');
  const [rangesText, setRangesText] = useState('');
  const [chunkSize, setChunkSize] = useState(2);

  const keys = useMemo(() => Array.from({ length: total }, (_, i) => String(i + 1)), [total]);
  const selection = usePageSelection(keys);
  const selectedPages = useMemo(() => selection.selectedList.map(Number), [selection.selectedList]);

  const splitMode: SplitMode = useMemo(() => {
    switch (mode) {
      case 'every':
        return { type: 'every' };
      case 'ranges':
        return { type: 'ranges', ranges: rangesText };
      case 'pages':
        return { type: 'pages', pages: selectedPages };
      case 'chunk':
        return { type: 'chunk', size: chunkSize };
    }
  }, [mode, rangesText, selectedPages, chunkSize]);

  // Preview of the groups the split will produce (also validates the range text).
  const { groups, error: modeError } = useMemo(() => {
    if (!total) return { groups: [] as number[][], error: null as string | null };
    try {
      const g = splitGroups(splitMode, total);
      if (mode === 'ranges' && rangesText.trim() && !g.length) return { groups: g, error: 'No pages match these ranges.' };
      return { groups: g, error: null };
    } catch {
      return { groups: [] as number[][], error: 'Use one range per line, e.g. 1-3, 5-7 or 10.' };
    }
  }, [splitMode, total, mode, rangesText]);

  const pageToGroup = useMemo(() => {
    const map = new Map<number, number>();
    if (mode === 'ranges' || mode === 'chunk') groups.forEach((g, gi) => g.forEach((p) => map.set(p, gi + 1)));
    return map;
  }, [groups, mode]);

  const gridPages: GridPage[] = useMemo(
    () =>
      file
        ? keys.map((k) => {
            const n = Number(k);
            const group = pageToGroup.get(n);
            return {
              key: k,
              docKey: `input:${file.id}`,
              loaded: pdf.loaded,
              pageNumber: n,
              rotation: 0,
              label: k,
              dimmed: (mode === 'ranges' && rangesText.trim() !== '' && !group) || (mode === 'pages' && selectedPages.length > 0 && !selection.selected.has(k)),
              badge: group ? <Chip size="small" label={`File ${group}`} color="primary" sx={{ height: 20, fontSize: 11 }} /> : undefined,
            };
          })
        : [],
    [file, keys, pdf.loaded, pageToGroup, mode, rangesText, selectedPages.length, selection.selected],
  );

  const canRun = Boolean(file) && total > 0 && !pdf.error && !modeError && groups.length > 0;

  const onSplit = useCallback(() => {
    const currentMode = splitMode;
    const expected = groups;
    void workflow.run(async (ctx) => {
      const input = ctx.files[0];
      ctx.setStage('Analyzing...', null);
      const bytes = await ctx.getBytes(input.id);
      ctx.setStage('Processing...', null);
      const outs = await splitPdf(bytes, currentMode, input.name);
      ctx.setStage('Generating PDF...', 1);
      return {
        outputs: outs.map((o, i) => ({
          name: o.name,
          blob: new Blob([o.data as BlobPart], { type: 'application/pdf' }),
          mimeType: 'application/pdf',
          pageCount: expected[i]?.length,
        })),
      };
    }, 'Analyzing...');
  }, [workflow, splitMode, groups]);

  const summary = pdf.error ? 'This PDF could not be opened.' : total ? describeSplit(groups.length, total) : 'Reading pages...';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Split complete"
      resultDescription="Your PDF files are ready. Download them one by one or all at once as a ZIP."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<CallSplitRoundedIcon />}
          actionDisabled={!canRun}
          onAction={onSplit}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Split mode"
          options={
            <>
              <ToggleButtonGroup
                exclusive
                value={mode}
                onChange={(_, v: Mode | null) => v && setMode(v)}
                aria-label="Split mode"
                orientation="vertical"
                fullWidth
                size="small"
              >
                {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                  <ToggleButton key={m} value={m} sx={{ justifyContent: 'flex-start', textTransform: 'none', minHeight: 44 }}>
                    {MODE_LABELS[m]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              {mode === 'every' && (
                <Typography variant="body2" color="text.secondary">
                  Each of the {total || '…'} pages becomes its own PDF file.
                </Typography>
              )}

              {mode === 'ranges' && (
                <TextField
                  label="Page ranges"
                  multiline
                  minRows={3}
                  fullWidth
                  value={rangesText}
                  onChange={(e) => setRangesText(e.target.value)}
                  placeholder={'1-3\n5-7\n10'}
                  error={Boolean(modeError)}
                  helperText={modeError ?? `One range per line. Pages 1-${total || '…'}.`}
                  slotProps={{ htmlInput: { 'aria-label': 'Page ranges, one per line' } }}
                />
              )}

              {mode === 'pages' && (
                <>
                  <PageSelectionInput
                    totalPages={total}
                    value={selectedPages}
                    onChange={(pages) => selection.set(pages.map(String))}
                    label="Pages to split out"
                    helperText={`Click thumbnails or type, e.g. 1-3, 5 (of ${total})`}
                    id="split-pages"
                  />
                  <Typography variant="caption" color="text.secondary">
                    Each selected page becomes a separate PDF. Shift-click selects a range.
                  </Typography>
                </>
              )}

              {mode === 'chunk' && (
                <TextField
                  label="Pages per file"
                  type="number"
                  fullWidth
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Math.max(1, Math.min(total || 9999, Math.floor(Number(e.target.value) || 1))))}
                  slotProps={{ htmlInput: { min: 1, max: total || undefined, inputMode: 'numeric' } }}
                  helperText={`Every ${chunkSize} page${chunkSize === 1 ? '' : 's'} become one file.`}
                />
              )}
            </>
          }
        >
          <Stack spacing={2}>
            {pdf.error && <ErrorState error={pdf.error} title="Cannot open this PDF" onRetry={workflow.reset} retryLabel="Choose another file" />}
            {!pdf.error && file && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                    {file.name}
                    {total ? ` · ${total} page${total === 1 ? '' : 's'}` : ''}
                  </Typography>
                  {mode === 'pages' && (
                    <Typography variant="caption" color="text.secondary">
                      {selectedPages.length} selected
                    </Typography>
                  )}
                </Box>
                {mode === 'pages' && selectedPages.length === 0 && total > 0 && <Alert severity="info">Click pages in the grid below to select the ones to split out.</Alert>}
                <PageGrid
                  pages={gridPages}
                  selected={mode === 'pages' ? selection.selected : undefined}
                  onToggleSelect={mode === 'pages' ? selection.toggle : undefined}
                  size="sm"
                  ariaLabel="Pages of the PDF"
                />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
