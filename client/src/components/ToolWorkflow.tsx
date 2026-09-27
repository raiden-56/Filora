import { Box, Button, Chip, Container, Stack, Typography, alpha } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { ToolWorkflow as Workflow } from '@/hooks/useToolWorkflow';
import { CATEGORY_BY_ID, categoryPath } from '@/constants/tools';
import StepIndicator from './StepIndicator';
import UploadDropzone from './UploadDropzone';
import ProcessingIndicator from './ProcessingIndicator';
import ResultScreen from './ResultScreen';
import ErrorState from './ErrorState';
import ToolIcon from './ToolIcon';
import ToolSidebar from './ToolSidebar';

export interface ToolWorkflowProps {
  workflow: Workflow;
  /** Step 2 content. Receives nothing; read from `workflow`. */
  configure: ReactNode;
  /** Custom upload step (default: dropzone) */
  upload?: ReactNode;
  /** Extra actions in the dropzone (e.g. camera) */
  uploadExtraActions?: ReactNode;
  uploadTitle?: string;
  /** Extra content for the result screen */
  resultExtra?: ReactNode;
  resultTitle?: string;
  resultDescription?: string;
  downloadLabel?: string;
  /** Use the full width (editors) instead of the centered column */
  wide?: boolean;
  /** hide the tool sidebar (default false on desktop) */
  hideSidebar?: boolean;
  processingHint?: string;
  stepLabels?: [string, string, string];
}

/**
 * Consistent 3-step layout used by every tool: Upload -> Customize/Process -> Download.
 */
export default function ToolWorkflow({
  workflow,
  configure,
  upload,
  uploadExtraActions,
  uploadTitle,
  resultExtra,
  resultTitle,
  resultDescription,
  downloadLabel,
  wide = false,
  hideSidebar = false,
  processingHint,
  stepLabels,
}: ToolWorkflowProps) {
  const { tool, step, stage, progress, error, result } = workflow;
  const category = CATEGORY_BY_ID[tool.category];

  const content = (
    <>
      {step === 'upload' && (
        <Box data-testid="step-upload">
          {upload ?? (
            <UploadDropzone
              accept={tool.accept}
              multiple={tool.multiple}
              onFiles={(files) => void workflow.addFiles(files)}
              title={uploadTitle ?? (tool.multiple ? `Drop your ${tool.accept.includes('pdf') ? 'PDF files' : 'files'} here` : `Drop your ${tool.accept.includes('pdf') ? 'PDF' : 'file'} here`)}
              buttonLabel={tool.accept.includes('pdf') ? (tool.multiple ? 'Choose PDF Files' : 'Choose PDF') : tool.multiple ? 'Choose Files' : 'Choose File'}
              extraActions={uploadExtraActions}
            />
          )}
          {error && (
            <Box sx={{ mt: 2 }}>
              <ErrorState error={error} onDismiss={workflow.clearError} />
            </Box>
          )}
        </Box>
      )}

      {step === 'configure' && (
        <Box data-testid="step-configure">
          {error && (
            <Box sx={{ mb: 2 }}>
              <ErrorState error={error} onDismiss={workflow.clearError} />
            </Box>
          )}
          {configure}
        </Box>
      )}

      {step === 'processing' && (
        <Box data-testid="step-processing" sx={{ py: { xs: 2, sm: 6 } }}>
          <ProcessingIndicator stage={stage} progress={progress} onCancel={workflow.cancel} hint={processingHint} />
        </Box>
      )}

      {step === 'done' && result && (
        <ResultScreen
          result={result}
          title={resultTitle}
          description={resultDescription}
          downloadLabel={downloadLabel}
          onDownload={workflow.downloadOutput}
          onDownloadAll={workflow.downloadAll}
          onStartAgain={workflow.reset}
        >
          {resultExtra}
        </ResultScreen>
      )}
    </>
  );

  return (
    <Container maxWidth={wide ? 'xl' : 'lg'} sx={{ py: { xs: 2.5, sm: 4 } }}>
      <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {!hideSidebar && !wide && (
          // Stretch to the full column height so the sticky menu inside has room to stay in place.
          <Box sx={{ width: 240, flexShrink: 0, alignSelf: 'stretch', display: { xs: 'none', lg: 'block' } }}>
            <ToolSidebar currentToolId={tool.id} />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Button component={RouterLink} to={categoryPath(category)} size="small" color="inherit" startIcon={<ArrowBackRoundedIcon />} sx={{ color: 'text.secondary', ml: -1 }}>
              {category.name}
            </Button>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: { xs: 2, sm: 3 } }}>
            <Box sx={{ width: 52, height: 52, borderRadius: '16px', display: 'grid', placeItems: 'center', bgcolor: alpha(category.color, 0.12), color: category.color, flexShrink: 0, '& svg': { fontSize: 28 } }}>
              <ToolIcon name={tool.icon} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h1" sx={{ mb: 0.5 }}>
                {tool.name}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {tool.longDescription}
              </Typography>
              <Chip
                icon={<ShieldRoundedIcon />}
                label="Processed in your browser · files never leave your device"
                size="small"
                variant="outlined"
                sx={{ mt: 1, color: 'text.secondary' }}
              />
            </Box>
          </Box>
          <StepIndicator step={step} labels={stepLabels} />
          {content}
        </Box>
      </Box>
    </Container>
  );
}
