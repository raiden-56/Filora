import { Alert, Box, Stack, Typography } from '@mui/material';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useCallback, useEffect, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';
import { getServerCapabilities, type ServerCapabilities } from '@/services/api';
import { acceptLabel, dropzoneAccept } from '@/utils/file';

// ------------------------------------------------------------------ capabilities (module cache)

let capabilitiesPromise: Promise<ServerCapabilities | null> | null = null;

/** Fetch server capabilities once per session; a failure resolves to null and is retried on the next mount. */
function loadCapabilities(): Promise<ServerCapabilities | null> {
  if (!capabilitiesPromise) {
    capabilitiesPromise = getServerCapabilities().catch(() => {
      capabilitiesPromise = null;
      return null;
    });
  }
  return capabilitiesPromise;
}

function useServerCapabilities(): ServerCapabilities | null | undefined {
  // undefined = loading, null = unreachable
  const [caps, setCaps] = useState<ServerCapabilities | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadCapabilities().then((c) => {
      if (active) setCaps(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return caps;
}

// ------------------------------------------------------------------ shared tool

export interface OfficeToPdfToolProps {
  toolId: 'word-to-pdf' | 'ppt-to-pdf' | 'excel-to-pdf';
  endpoint: string;
  /** e.g. "Word document", "presentation", "spreadsheet" */
  kindLabel: string;
}

/**
 * Shared implementation for the Office -> PDF tools. Files are uploaded to the server,
 * converted (LibreOffice when available) and the resulting PDFs are downloaded back.
 */
export default function OfficeToPdfTool({ toolId, endpoint, kindLabel }: OfficeToPdfToolProps) {
  const tool = TOOL_BY_ID[toolId];
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files } = workflow;
  const inputRef = useRef<HTMLInputElement>(null);
  const caps = useServerCapabilities();

  const onConvert = useCallback(() => {
    void workflow.run((ctx) => processViaServer(ctx, { endpoint, processingStage: 'Converting...' }), 'Uploading...');
  }, [workflow, endpoint]);

  const plural = files.length === 1 ? '' : 's';
  const ttl = caps?.fileTtlMinutes;

  return (
    <ToolWorkflow
      workflow={workflow}
      uploadTitle={`Drop your ${kindLabel}${tool.multiple ? 's' : ''} here`}
      resultTitle="Conversion complete"
      resultDescription={files.length > 1 ? 'Your PDFs are ready.' : 'Your PDF is ready.'}
      downloadLabel={files.length > 1 ? 'Download All (ZIP)' : 'Download PDF'}
      processingHint="Complex documents with many pages or images can take up to a minute."
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
                Each {kindLabel} becomes one PDF that keeps the page layout of the original. Fonts that are not installed on the server are substituted.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Supported: {acceptLabel(tool.accept)}.
              </Typography>
            </Stack>
          }
        >
          <Stack spacing={2}>
            <Alert severity="info">
              Conversion happens securely on the server. Uploaded files and results are deleted automatically
              {ttl ? ` after ${ttl} minutes` : ''}.
            </Alert>
            {caps && !caps.libreoffice && (
              <Alert severity="warning">LibreOffice is not installed on the server – conversion uses a simplified engine, formatting may differ.</Alert>
            )}
            {caps === null && (
              <Alert severity="warning">The server could not be reached right now. You can still try, but the conversion may fail.</Alert>
            )}
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
