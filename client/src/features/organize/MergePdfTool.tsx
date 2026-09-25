import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded';
import SortByAlphaRoundedIcon from '@mui/icons-material/SortByAlphaRounded';
import { useCallback, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { useAppSelector } from '@/store/hooks';
import { mergePdfs, stripExtension, withSuffix } from '@pdfly/core';
import { dropzoneAccept } from '@/utils/file';

const tool = TOOL_BY_ID.merge;

export default function MergePdfTool() {
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files } = workflow;
  const docs = useAppSelector((s) => s.pdf.docs);
  const [outputName, setOutputName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const totalPages = files.reduce((n, f) => n + (docs[f.id]?.pageCount ?? 0), 0);
  const broken = files.filter((f) => docs[f.id]?.status === 'error');

  const onMerge = useCallback(() => {
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', 0);
      const inputs: Uint8Array[] = [];
      for (let i = 0; i < ctx.files.length; i++) {
        inputs.push(await ctx.getBytes(ctx.files[i].id));
        ctx.setStage('Analyzing...', (i + 1) / ctx.files.length);
      }
      ctx.setStage('Generating PDF...', null);
      const base = outputName.trim() || `${stripExtension(ctx.files[0].name)}-merged`;
      const data = await mergePdfs(inputs, base);
      const blob = new Blob([data as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(base, ''), blob, mimeType: 'application/pdf', pageCount: totalPages || undefined }] };
    }, 'Analyzing...');
  }, [workflow, outputName, totalPages]);

  const sortByName = () => workflow.setOrder([...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f) => f.id));

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Merge complete"
      resultDescription="Your merged PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={files.length < 2 ? 'Add at least 2 PDFs' : 'Merge PDFs'}
          actionIcon={<CallMergeRoundedIcon />}
          actionDisabled={files.length < 2 || broken.length > 0}
          onAction={onMerge}
          summary={`${files.length} file${files.length === 1 ? '' : 's'}${totalPages ? ` · ${totalPages} pages` : ''} will be merged in the order shown.`}
          onBack={workflow.reset}
          backLabel="Start over"
          options={
            <>
              <TextField label="Output file name" placeholder="merged-document" value={outputName} onChange={(e) => setOutputName(e.target.value)} helperText=".pdf is added automatically" fullWidth />
              <Button variant="outlined" startIcon={<SortByAlphaRoundedIcon />} onClick={sortByName} disabled={files.length < 2}>
                Sort by name
              </Button>
              <Typography variant="caption" color="text.secondary">
                Tip: drag the handle on a card (or use the keyboard: focus the handle, press Space, arrow keys, Space) to change the order.
              </Typography>
            </>
          }
        >
          <Stack spacing={2}>
            {broken.length > 0 && (
              <Alert severity="error">
                {broken.length === 1 ? `"${broken[0].name}" could not be read. Remove it to continue.` : `${broken.length} files could not be read. Remove them to continue.`}
              </Alert>
            )}
            <FileList
              files={files}
              onRemove={workflow.removeFile}
              onRename={workflow.renameFile}
              onReorder={workflow.setOrder}
              onAddMore={() => inputRef.current?.click()}
              addMoreLabel="Add more PDFs"
            />
            <Box>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={Object.values(dropzoneAccept(['pdf'])).flat().join(',')}
                hidden
                aria-label="Add more PDF files"
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
