import { Alert, Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import SuccessState from './SuccessState';
import DownloadCard from './DownloadCard';
import Modal from './Modal';
import type { ToolResultMeta, OutputFileMeta } from '@/types';
import { formatBytes, formatDuration } from '@/utils/format';
import { outputRegistry } from '@/services/fileRegistry';
import { useObjectUrl } from '@/hooks/useObjectUrl';

const PDFViewer = lazy(() => import('./PDFViewer'));

export interface ResultScreenProps {
  result: ToolResultMeta;
  title?: string;
  description?: string;
  onDownload: (id: string) => void;
  onDownloadAll: () => void | Promise<void>;
  onStartAgain: () => void;
  /** extra content (stats, OCR text, validation report...) */
  children?: ReactNode;
  /** label for the primary download button */
  downloadLabel?: string;
}

function ImagePreview({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return url ? <Box component="img" src={url} alt="Preview" sx={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', mx: 'auto', borderRadius: 1 }} /> : null;
}

function TextPreview({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) void blob.text().then(setText);
  return (
    <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: 13, m: 0 }}>
      {text ?? 'Loading…'}
    </Box>
  );
}

export default function ResultScreen({ result, title, description, onDownload, onDownloadAll, onStartAgain, children, downloadLabel }: ResultScreenProps) {
  const [preview, setPreview] = useState<OutputFileMeta | null>(null);
  const multiple = result.outputs.length > 1;
  const totalOut = result.outputs.reduce((n, o) => n + o.size, 0);
  const totalIn = result.inputs.reduce((n, o) => n + o.size, 0);
  const primary = result.outputs[0];
  const canPreview = (o: OutputFileMeta) => o.mimeType === 'application/pdf' || o.mimeType.startsWith('image/') || o.mimeType.startsWith('text/');
  const previewBlob = preview ? outputRegistry.get(preview.id) : undefined;

  return (
    <Box data-testid="result-screen">
      <SuccessState title={title ?? 'Conversion complete'} description={description ?? (multiple ? `${result.outputs.length} files are ready.` : 'Your file is ready.')} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center" sx={{ mt: 3, mb: 3 }}>
        {primary && canPreview(primary) && !multiple && (
          <Button variant="outlined" size="large" startIcon={<VisibilityRoundedIcon />} onClick={() => setPreview(primary)}>
            Preview
          </Button>
        )}
        <Button
          variant="contained"
          size="large"
          startIcon={multiple ? <FolderZipRoundedIcon /> : <DownloadRoundedIcon />}
          onClick={() => void onDownloadAll()}
          data-testid="download-primary"
        >
          {multiple ? 'Download All (ZIP)' : (downloadLabel ?? 'Download')}
        </Button>
        <Button variant="text" size="large" color="inherit" startIcon={<ReplayRoundedIcon />} onClick={onStartAgain}>
          Start Again
        </Button>
      </Stack>

      {result.warnings && result.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {result.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </Alert>
      )}

      {children}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
          {multiple ? 'Output files' : 'Output file'}
        </Typography>
        <Stack spacing={1}>
          {result.outputs.map((o) => (
            <DownloadCard key={o.id} file={o} onDownload={onDownload} onPreview={canPreview(o) ? (id) => setPreview(result.outputs.find((x) => x.id === id) ?? null) : undefined} />
          ))}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 2 }}>
          <Stat label="Original" value={`${result.inputs.length} file${result.inputs.length === 1 ? '' : 's'} · ${formatBytes(totalIn)}`} />
          <Stat label="Output" value={`${result.outputs.length} file${result.outputs.length === 1 ? '' : 's'} · ${formatBytes(totalOut)}`} />
          <Stat label="Processing time" value={formatDuration(result.durationMs)} />
          <Stat label="Saved to" value={<RouterLink to="/my-files" style={{ color: 'inherit' }}>My Files</RouterLink>} />
        </Box>
      </Paper>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.name} maxWidth="lg" disablePadding={preview?.mimeType === 'application/pdf'} id="preview">
        {preview && previewBlob && preview.mimeType === 'application/pdf' && (
          <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}>Loading preview…</Box>}>
            <Box sx={{ height: { xs: 'calc(100vh - 64px)', sm: '75vh' } }}>
              <PDFViewer fileId={preview.id} ns="output" />
            </Box>
          </Suspense>
        )}
        {preview && previewBlob && preview.mimeType.startsWith('image/') && <ImagePreview blob={previewBlob} />}
        {preview && previewBlob && preview.mimeType.startsWith('text/') && <TextPreview blob={previewBlob} />}
      </Modal>
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
