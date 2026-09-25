import { Alert, Box, Button, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import FileDownloadDoneRoundedIcon from '@mui/icons-material/FileDownloadDoneRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import DeselectRoundedIcon from '@mui/icons-material/DeselectRounded';
import FlipCameraAndroidRoundedIcon from '@mui/icons-material/FlipCameraAndroidRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
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
import { extractPages, splitPdf, withSuffix } from '@pdfly/core';

const tool = TOOL_BY_ID['extract-pages'];

export default function ExtractPagesTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const pdf = usePdfDocument(file?.id ?? null, 'input');
  const total = pdf.numPages;
  const [separate, setSeparate] = useState(false);

  const keys = useMemo(() => Array.from({ length: total }, (_, i) => String(i + 1)), [total]);
  const selection = usePageSelection(keys);
  const kept = useMemo(() => selection.selectedList.map(Number), [selection.selectedList]);
  const count = kept.length;

  const gridPages: GridPage[] = useMemo(
    () =>
      file
        ? keys.map((k) => {
            const isKept = selection.selected.has(k);
            return {
              key: k,
              docKey: `input:${file.id}`,
              loaded: pdf.loaded,
              pageNumber: Number(k),
              rotation: 0,
              label: k,
              dimmed: count > 0 && !isKept,
              badge: isKept ? <Chip size="small" color="success" label="Keep" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} /> : undefined,
            };
          })
        : [],
    [file, keys, pdf.loaded, selection.selected, count],
  );

  const onExtract = useCallback(() => {
    const pages = kept;
    const asSeparate = separate;
    void workflow.run(async (ctx) => {
      const input = ctx.files[0];
      ctx.setStage('Analyzing...', null);
      const bytes = await ctx.getBytes(input.id);
      ctx.setStage('Processing...', null);
      if (asSeparate) {
        const outs = await splitPdf(bytes, { type: 'pages', pages }, input.name);
        ctx.setStage('Generating PDF...', 1);
        return {
          outputs: outs.map((o) => ({
            name: o.name,
            blob: new Blob([o.data as BlobPart], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
            pageCount: 1,
          })),
        };
      }
      const data = await extractPages(bytes, pages);
      ctx.setStage('Generating PDF...', 1);
      return {
        outputs: [
          {
            name: withSuffix(input.name, '-extracted'),
            blob: new Blob([data as BlobPart], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
            pageCount: pages.length,
          },
        ],
      };
    }, 'Analyzing...');
  }, [workflow, kept, separate]);

  const canRun = Boolean(file) && !pdf.error && total > 0 && count > 0;
  const summary = pdf.error
    ? 'This PDF could not be opened.'
    : total
      ? count
        ? separate
          ? `${count} page${count === 1 ? '' : 's'} of ${total} will be saved as ${count} separate PDF${count === 1 ? '' : 's'}.`
          : `${count} of ${total} page${total === 1 ? '' : 's'} will be extracted into one PDF.`
        : `Select the pages to extract (${total} page${total === 1 ? '' : 's'}).`
      : 'Reading pages...';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Pages extracted"
      resultDescription={separate ? 'Your PDFs are ready. Download them individually or all at once as a ZIP.' : 'Your new PDF with the selected pages is ready.'}
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={count ? `Extract ${count} page${count === 1 ? '' : 's'}` : tool.actionLabel}
          actionIcon={<FileDownloadDoneRoundedIcon />}
          actionDisabled={!canRun}
          onAction={onExtract}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Pages to extract"
          options={
            <>
              <PageSelectionInput
                totalPages={total}
                value={kept}
                onChange={(pages) => selection.set(pages.map(String))}
                label="Pages to keep"
                helperText={`Click thumbnails or type, e.g. 1-3, 5 (of ${total})`}
                id="extract-pages"
              />
              <FormControlLabel
                control={<Switch checked={separate} onChange={(e) => setSeparate(e.target.checked)} />}
                label="Extract each page as a separate PDF"
              />
              {count === 0 && total > 0 && <Alert severity="info">Select the pages you want to keep. Shift-click selects a range.</Alert>}
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
                    {count ? ` · ${count} selected` : ''}
                  </Typography>
                  <Button size="small" startIcon={<SelectAllRoundedIcon />} onClick={selection.selectAll} disabled={!total || count === total}>
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
                <PageGrid pages={gridPages} selected={selection.selected} onToggleSelect={selection.toggle} size="sm" ariaLabel="Pages of the PDF (click to select pages to keep)" />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
