import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import DeselectRoundedIcon from '@mui/icons-material/DeselectRounded';
import FlipCameraAndroidRoundedIcon from '@mui/icons-material/FlipCameraAndroidRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import { useCallback, useMemo } from 'react';
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
import { removePages, withSuffix } from '@pdfly/core';

const tool = TOOL_BY_ID['remove-pages'];

export default function RemovePagesTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const pdf = usePdfDocument(file?.id ?? null, 'input');
  const total = pdf.numPages;

  const keys = useMemo(() => Array.from({ length: total }, (_, i) => String(i + 1)), [total]);
  const selection = usePageSelection(keys);
  const removed = useMemo(() => selection.selectedList.map(Number), [selection.selectedList]);
  const count = removed.length;
  const allSelected = total > 0 && count === total;

  const gridPages: GridPage[] = useMemo(
    () =>
      file
        ? keys.map((k) => {
            const isRemoved = selection.selected.has(k);
            return {
              key: k,
              docKey: `input:${file.id}`,
              loaded: pdf.loaded,
              pageNumber: Number(k),
              rotation: 0,
              label: k,
              dimmed: isRemoved,
              badge: isRemoved ? <Chip size="small" color="error" label="Removed" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} /> : undefined,
            };
          })
        : [],
    [file, keys, pdf.loaded, selection.selected],
  );

  const onRemove = useCallback(() => {
    const pages = removed;
    const remaining = total - pages.length;
    void workflow.run(async (ctx) => {
      const input = ctx.files[0];
      ctx.setStage('Analyzing...', null);
      const bytes = await ctx.getBytes(input.id);
      ctx.setStage('Processing...', null);
      const data = await removePages(bytes, pages);
      ctx.setStage('Generating PDF...', 1);
      return {
        outputs: [
          {
            name: withSuffix(input.name, '-pages-removed'),
            blob: new Blob([data as BlobPart], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
            pageCount: remaining,
          },
        ],
      };
    }, 'Analyzing...');
  }, [workflow, removed, total]);

  const canRun = Boolean(file) && !pdf.error && total > 0 && count > 0 && !allSelected;
  const summary = pdf.error
    ? 'This PDF could not be opened.'
    : total
      ? `${count} of ${total} page${total === 1 ? '' : 's'} will be removed${count ? ` · ${total - count} will remain` : ''}.`
      : 'Reading pages...';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Pages removed"
      resultDescription="Your new PDF without the selected pages is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={count ? `Remove ${count} page${count === 1 ? '' : 's'}` : tool.actionLabel}
          actionIcon={<DeleteSweepRoundedIcon />}
          actionDisabled={!canRun}
          onAction={onRemove}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Pages to remove"
          options={
            <>
              <PageSelectionInput
                totalPages={total}
                value={removed}
                onChange={(pages) => selection.set(pages.map(String))}
                label="Pages to remove"
                helperText={`Click thumbnails or type, e.g. 1-3, 5 (of ${total})`}
                id="remove-pages"
              />
              {allSelected && <Alert severity="error">You cannot remove every page. Keep at least one page in the document.</Alert>}
              {!allSelected && count === 0 && total > 0 && <Alert severity="info">Select the pages you want to delete. Shift-click selects a range.</Alert>}
            </>
          }
        >
          <Stack spacing={2}>
            {pdf.error && <ErrorState error={pdf.error} title="Cannot open this PDF" onRetry={workflow.reset} retryLabel="Choose another file" />}
            {!pdf.error && file && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mr: 'auto', minWidth: 0 }} noWrap>
                    {file.name}
                    {total ? ` · ${total} page${total === 1 ? '' : 's'}` : ''}
                  </Typography>
                  <Button size="small" startIcon={<SelectAllRoundedIcon />} onClick={selection.selectAll} disabled={!total || allSelected}>
                    Select all
                  </Button>
                  <Button size="small" startIcon={<DeselectRoundedIcon />} onClick={selection.clear} disabled={!count}>
                    Clear
                  </Button>
                  <Button size="small" startIcon={<FlipCameraAndroidRoundedIcon />} onClick={selection.invert} disabled={!total}>
                    Invert
                  </Button>
                  <Button size="small" startIcon={<UndoRoundedIcon />} onClick={selection.undo} disabled={!selection.canUndo}>
                    Undo selection
                  </Button>
                </Box>
                <PageGrid pages={gridPages} selected={selection.selected} onToggleSelect={selection.toggle} size="sm" ariaLabel="Pages of the PDF (click to mark for removal)" />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
