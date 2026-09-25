import { Box, Chip, FormControl, FormControlLabel, FormLabel, List, ListItem, ListItemIcon, ListItemText, Paper, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import { useCallback, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';
import { useAppSelector } from '@/store/hooks';
import PdfSummaryCard from './PdfSummaryCard';
import ServerToolNotice from './ServerToolNotice';
import { booleanOf, engineLabel, objectOf, stringOf, type ResultExtra } from './resultMeta';

const tool = TOOL_BY_ID['pdf-to-pdfa'];

type PdfaLevel = '1b' | '2b' | '3b';

const LEVELS: { value: PdfaLevel; label: string; hint: string }[] = [
  { value: '1b', label: 'PDF/A-1b', hint: 'Oldest and most widely accepted; no transparency or JPEG 2000.' },
  { value: '2b', label: 'PDF/A-2b (recommended)', hint: 'Modern standard: supports transparency, layers and better compression.' },
  { value: '3b', label: 'PDF/A-3b', hint: 'Like 2b, but also allows embedding attachments of any type.' },
];

interface PdfaCheck {
  name: string;
  passed: boolean;
  message?: string;
}

function readChecks(validation: ResultExtra | undefined): PdfaCheck[] {
  const raw = validation?.checks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({ name: String(c.name ?? 'Check'), passed: Boolean(c.passed), message: typeof c.message === 'string' ? c.message : undefined }));
}

function ValidationReport({ extra }: { extra: ResultExtra | undefined }) {
  const validation = objectOf(extra, 'validation');
  if (!validation) return null;
  const valid = booleanOf(validation, 'valid') ?? false;
  const validator = stringOf(validation, 'validator');
  const checks = readChecks(validation);
  const engine = engineLabel(stringOf(extra, 'engine'));
  const level = stringOf(extra, 'level');

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} component="section" aria-label="Validation report" data-testid="pdfa-report">
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Validation report
        </Typography>
        <Chip
          size="small"
          color={valid ? 'success' : 'warning'}
          icon={valid ? <CheckCircleRoundedIcon /> : <CancelRoundedIcon />}
          label={valid ? 'Valid' : 'Needs attention'}
          data-testid="pdfa-status"
        />
        {level && <Chip size="small" variant="outlined" label={`PDF/A-${level}`} />}
      </Stack>
      {checks.length > 0 ? (
        <List dense disablePadding aria-label="Checks">
          {checks.map((c, i) => (
            <ListItem key={`${c.name}-${i}`} disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 32, mt: 0.25, color: c.passed ? 'success.main' : 'error.main' }}>
                {c.passed ? <CheckCircleRoundedIcon fontSize="small" aria-label="Passed" /> : <CancelRoundedIcon fontSize="small" aria-label="Failed" />}
              </ListItemIcon>
              <ListItemText primary={c.name} secondary={c.message} slotProps={{ primary: { variant: 'body2', fontWeight: 600 }, secondary: { variant: 'caption' } }} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No individual checks were reported.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5 }}>
        {validator && (
          <Typography variant="caption" color="text.secondary">
            Validator: {validator === 'verapdf' ? 'veraPDF' : 'built-in checks (not a full veraPDF validation)'}
          </Typography>
        )}
        {engine && (
          <Typography variant="caption" color="text.secondary">
            Engine: {engine}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function PdfToPdfaTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const [level, setLevel] = useState<PdfaLevel>('2b');

  const onConvert = useCallback(() => {
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/convert/pdf-to-pdfa',
          fields: { level },
          processingStage: 'Converting to PDF/A...',
        }),
      'Uploading...',
    );
  }, [workflow, level]);

  const validation = objectOf(workflow.result?.extra, 'validation');
  const valid = booleanOf(validation, 'valid');

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle={valid === false ? 'Converted with warnings' : 'Conversion complete'}
      resultDescription={valid === false ? 'The file was converted, but some checks did not pass. See the report below.' : 'Your PDF/A file is ready for archiving.'}
      downloadLabel="Download PDF/A"
      resultExtra={<ValidationReport extra={workflow.result?.extra} />}
      configure={
        file && (
          <ConfigureLayout
            actionLabel="Convert to PDF/A"
            actionIcon={<ArchiveRoundedIcon />}
            actionDisabled={doc?.status === 'error'}
            onAction={onConvert}
            summary={`The file will be converted to PDF/A-${level} and validated.`}
            onBack={workflow.reset}
            options={
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Conformance level
                </FormLabel>
                <RadioGroup value={level} onChange={(e) => setLevel(e.target.value as PdfaLevel)} name="pdfa-level">
                  {LEVELS.map((l) => (
                    <Box key={l.value} sx={{ mb: 1 }}>
                      <FormControlLabel value={l.value} control={<Radio />} label={l.label} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                        {l.hint}
                      </Typography>
                    </Box>
                  ))}
                </RadioGroup>
              </FormControl>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice needs={['ghostscript']} message="Ghostscript is not installed on the server. The built-in converter embeds fonts and metadata, but some documents may not pass every PDF/A check." />
              <PdfSummaryCard file={file} />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  What PDF/A does
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  PDF/A (ISO 19005) is a self-contained format for long-term archiving: fonts are embedded, colors are defined, encryption and external
                  references are removed, and metadata is added. After converting, we run a set of checks and show you a validation report.
                </Typography>
              </Paper>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
