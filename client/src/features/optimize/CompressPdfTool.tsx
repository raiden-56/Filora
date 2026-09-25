import { Alert, Box, LinearProgress, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import CompressRoundedIcon from '@mui/icons-material/CompressRounded';
import { useCallback, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';
import { useAppSelector } from '@/store/hooks';
import { formatBytes } from '@/utils/format';
import type { CompressionLevel } from '@/store/slices/settingsSlice';
import PdfSummaryCard from '@/features/convert-from/PdfSummaryCard';
import ServerToolNotice from '@/features/convert-from/ServerToolNotice';
import { engineLabel, numberOf, stringOf, type ResultExtra } from '@/features/convert-from/resultMeta';

const tool = TOOL_BY_ID.compress;

const LEVELS: { value: CompressionLevel; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'best quality' },
  { value: 'medium', label: 'Medium', hint: 'recommended' },
  { value: 'high', label: 'High', hint: 'smallest file' },
];

function CompressionSummary({ extra }: { extra: ResultExtra | undefined }) {
  const originalSize = numberOf(extra, 'originalSize');
  const compressedSize = numberOf(extra, 'compressedSize');
  if (originalSize === undefined || compressedSize === undefined) return null;
  const reduction = numberOf(extra, 'reductionPercent') ?? (originalSize > 0 ? Math.round(Math.max(0, 1 - compressedSize / originalSize) * 100) : 0);
  const ratio = originalSize > 0 ? Math.min(100, Math.round((compressedSize / originalSize) * 100)) : 100;
  const engine = engineLabel(stringOf(extra, 'engine'));
  const level = stringOf(extra, 'level');

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 2 }} component="section" aria-label="Compression result" data-testid="compress-summary">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1.4fr' }, gap: 2, alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Original size
          </Typography>
          <Typography variant="h6">{formatBytes(originalSize)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Compressed size
          </Typography>
          <Typography variant="h6">{formatBytes(compressedSize)}</Typography>
        </Box>
        <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, textAlign: { xs: 'left', sm: 'right' } }}>
          <Typography variant="h3" component="p" sx={{ color: reduction > 0 ? 'success.main' : 'text.secondary', fontWeight: 800, lineHeight: 1.1 }} data-testid="reduction">
            Reduced by {reduction}%
          </Typography>
        </Box>
      </Box>
      <Box sx={{ mt: 2.5 }}>
        <LinearProgress
          variant="determinate"
          value={ratio}
          color={reduction > 0 ? 'success' : 'inherit'}
          aria-label={`Compressed file is ${ratio}% of the original size`}
          sx={{ height: 12, borderRadius: 6 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {ratio}% of original
          </Typography>
          {(engine || level) && (
            <Typography variant="caption" color="text.secondary">
              {level ? `${level.charAt(0).toUpperCase()}${level.slice(1)} compression` : ''}
              {engine ? `${level ? ' · ' : ''}Engine: ${engine}` : ''}
            </Typography>
          )}
        </Box>
      </Box>
      {reduction === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          This PDF is already well optimized, so we could not make it smaller without losing quality. You can try the High level, but the result may be similar.
        </Alert>
      )}
    </Paper>
  );
}

export default function CompressPdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const [level, setLevel] = useState<CompressionLevel>(workflow.settings.compressionLevel);

  const onCompress = useCallback(() => {
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/pdf/compress',
          fields: { level },
          processingStage: 'Optimizing...',
        }),
      'Uploading...',
    );
  }, [workflow, level]);

  const selected = LEVELS.find((l) => l.value === level);

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Compression complete"
      resultDescription="Your smaller PDF is ready."
      downloadLabel="Download PDF"
      resultExtra={<CompressionSummary extra={workflow.result?.extra} />}
      configure={
        file && (
          <ConfigureLayout
            actionLabel="Compress PDF"
            actionIcon={<CompressRoundedIcon />}
            actionDisabled={doc?.status === 'error'}
            onAction={onCompress}
            summary={`Original size: ${formatBytes(file.size)} · ${selected?.label ?? 'Medium'} compression (${selected?.hint ?? 'recommended'}).`}
            onBack={workflow.reset}
            options={
              <Box>
                <Typography id="compression-level-label" variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Compression level
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  orientation="vertical"
                  value={level}
                  onChange={(_, v: CompressionLevel | null) => v && setLevel(v)}
                  aria-labelledby="compression-level-label"
                >
                  {LEVELS.map((l) => (
                    <ToggleButton key={l.value} value={l.value} sx={{ justifyContent: 'space-between', textTransform: 'none', minHeight: 52, px: 2 }}>
                      <Typography component="span" variant="body2" sx={{ fontWeight: 700 }}>
                        {l.label}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary">
                        {l.hint}
                      </Typography>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {level === 'low' && 'Keeps images close to the original. Mostly removes duplicate data and unused objects.'}
                  {level === 'medium' && 'Downsamples images to screen resolution. Good balance for email and web.'}
                  {level === 'high' && 'Aggressively downsamples images. Best for text documents and previews.'}
                </Typography>
              </Box>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice needs={['ghostscript']} message="Ghostscript is not installed on the server. The built-in optimizer will be used, which mainly recompresses images and removes unused data." />
              <PdfSummaryCard file={file}>
                <Typography variant="body2" color="text.secondary">
                  Original size: <strong>{formatBytes(file.size)}</strong>
                </Typography>
              </PdfSummaryCard>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
