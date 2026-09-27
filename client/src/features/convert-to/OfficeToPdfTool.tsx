import { Alert, Box, Stack, Typography } from '@mui/material';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useCallback, useRef } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { officeToPdf, type OfficeKind } from '@/engines/office';
import { acceptLabel, dropzoneAccept } from '@/utils/file';
import { withSuffix } from '@pdfly/core';

export interface OfficeToPdfToolProps {
  toolId: 'word-to-pdf' | 'ppt-to-pdf' | 'excel-to-pdf';
  kind: OfficeKind;
  /** e.g. "Word document", "presentation", "spreadsheet" */
  kindLabel: string;
}

/**
 * Shared implementation for the Office -> PDF tools. Every file is converted in the browser
 * with the built-in converter (text, lists, tables and images; simplified layout).
 */
export default function OfficeToPdfTool({ toolId, kind, kindLabel }: OfficeToPdfToolProps) {
  const tool = TOOL_BY_ID[toolId];
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files } = workflow;
  const inputRef = useRef<HTMLInputElement>(null);

  const onConvert = useCallback(() => {
    void workflow.run(async (ctx) => {
      const outputs = [];
      const warnings = new Set<string>();
      for (let i = 0; i < ctx.files.length; i++) {
        const f = ctx.files[i];
        ctx.setStage(ctx.files.length > 1 ? `Converting ${i + 1} of ${ctx.files.length}...` : 'Converting...', ctx.files.length > 1 ? i / ctx.files.length : null);
        const bytes = await ctx.getBytes(f.id);
        const r = await officeToPdf(bytes, f.name, kind, { signal: ctx.signal });
        for (const w of r.warnings) warnings.add(ctx.files.length > 1 ? `${f.name}: ${w}` : w);
        outputs.push({ name: withSuffix(f.name, '', 'pdf'), blob: new Blob([r.pdf as BlobPart], { type: 'application/pdf' }), mimeType: 'application/pdf' });
      }
      return { outputs, extra: { engine: 'js' }, warnings: [...warnings] };
    }, 'Converting...');
  }, [workflow, kind]);

  const plural = files.length === 1 ? '' : 's';

  return (
    <ToolWorkflow
      workflow={workflow}
      uploadTitle={`Drop your ${kindLabel}${tool.multiple ? 's' : ''} here`}
      resultTitle="Conversion complete"
      resultDescription={files.length > 1 ? 'Your PDFs are ready.' : 'Your PDF is ready.'}
      downloadLabel={files.length > 1 ? 'Download All (ZIP)' : 'Download PDF'}
      processingHint="Documents with many pages or images can take a moment."
      configure={
        <ConfigureLayout
          actionLabel="Convert to PDF"
          actionIcon={<PictureAsPdfRoundedIcon />}
          actionDisabled={files.length === 0}
          onAction={onConvert}
          summary={`${files.length} ${kindLabel}${plural} will be converted to PDF.`}
          onBack={workflow.reset}
          backLabel="Start over"
          optionsTitle="How it works"
          options={
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Each {kindLabel} becomes one PDF with its text, headings, lists, tables and images. The original page layout, fonts and
                colours are simplified because the conversion happens entirely in your browser.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Supported: {acceptLabel(tool.accept)}.
              </Typography>
            </Stack>
          }
        >
          <Stack spacing={2}>
            <Alert severity="info">Conversion happens in your browser. Nothing is uploaded, and the files never leave your device.</Alert>
            <FileList
              files={files}
              variant="list"
              onRemove={workflow.removeFile}
              onRename={workflow.renameFile}
              onReorder={files.length > 1 ? workflow.setOrder : undefined}
              onAddMore={tool.multiple ? () => inputRef.current?.click() : undefined}
              addMoreLabel="Add more"
            />
            <Box>
              <input
                ref={inputRef}
                type="file"
                multiple={tool.multiple}
                accept={Object.values(dropzoneAccept(tool.accept)).flat().join(',')}
                hidden
                aria-label={`Add more ${kindLabel}s`}
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (list.length) void workflow.addFiles(list);
                }}
              />
            </Box>
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
