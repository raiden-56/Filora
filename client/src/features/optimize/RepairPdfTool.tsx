import { Alert, Chip, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material';
import BuildRoundedIcon from '@mui/icons-material/BuildRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useCallback } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';
import PdfSummaryCard from '@/features/convert-from/PdfSummaryCard';
import ServerToolNotice from '@/features/convert-from/ServerToolNotice';
import { engineLabel, numberOf, stringListOf, stringOf, type ResultExtra } from '@/features/convert-from/resultMeta';

const tool = TOOL_BY_ID.repair;

const STEPS = [
  'Scan the file structure and locate every object, even when the index (xref) is broken.',
  'Rebuild the cross-reference table and repair damaged streams where possible.',
  'Rewrite a clean copy of the document so it opens in any viewer.',
];

function RepairReport({ extra }: { extra: ResultExtra | undefined }) {
  const status = stringOf(extra, 'status');
  const notes = stringListOf(extra, 'notes');
  const engine = engineLabel(stringOf(extra, 'engine'));
  const pageCount = numberOf(extra, 'pageCount');
  if (!status && !notes.length && !engine) return null;
  return (
    <Stack spacing={2} sx={{ mb: 2 }}>
      {status === 'healthy' && (
        <Alert severity="info" icon={<InfoOutlinedIcon />}>
          We could not find any structural damage in this file. A freshly written copy is available below in case your viewer still has trouble with the original.
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Repair report" data-testid="repair-report">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: notes.length ? 1.5 : 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            What we found
          </Typography>
          {status && <Chip size="small" color={status === 'repaired' ? 'success' : 'default'} label={status === 'repaired' ? 'Repaired' : 'Healthy'} />}
          {pageCount !== undefined && <Chip size="small" variant="outlined" label={`${pageCount} page${pageCount === 1 ? '' : 's'}`} />}
        </Stack>
        {notes.length > 0 && (
          <List dense disablePadding aria-label="Repair notes">
            {notes.map((n, i) => (
              <ListItem key={i} disableGutters alignItems="flex-start">
                <ListItemIcon sx={{ minWidth: 30, mt: 0.25, color: 'success.main' }}>
                  <CheckCircleRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={n} slotProps={{ primary: { variant: 'body2' } }} />
              </ListItem>
            ))}
          </List>
        )}
        {engine && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Engine: {engine}
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}

export default function RepairPdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];

  const onRepair = useCallback(() => {
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing PDF...', null);
      return processViaServer(ctx, { endpoint: '/pdf/repair', processingStage: 'Repairing...' });
    }, 'Analyzing PDF...');
  }, [workflow]);

  const status = stringOf(workflow.result?.extra, 'status');

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle={status === 'healthy' ? 'No damage found' : 'Repair completed'}
      resultDescription={status === 'healthy' ? 'The file looks healthy. A clean copy is ready anyway.' : 'Your repaired PDF is ready.'}
      downloadLabel="Download PDF"
      processingHint="Damaged files can take a moment to analyze."
      resultExtra={<RepairReport extra={workflow.result?.extra} />}
      configure={
        file && (
          <ConfigureLayout
            actionLabel={workflow.error ? 'Try again' : 'Repair PDF'}
            actionIcon={<BuildRoundedIcon />}
            onAction={onRepair}
            summary={`"${file.name}" will be analyzed and rebuilt.`}
            onBack={workflow.reset}
            options={
              <Typography variant="body2" color="text.secondary">
                No settings needed. We keep all pages and content we can recover; nothing is removed on purpose.
              </Typography>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice />
              <PdfSummaryCard file={file} unreadableHint="Preview unavailable – the file could not be opened in the browser. That is expected for damaged PDFs; repair may still succeed." />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  What repair does
                </Typography>
                <List dense disablePadding>
                  {STEPS.map((s, i) => (
                    <ListItem key={i} disableGutters alignItems="flex-start">
                      <ListItemIcon sx={{ minWidth: 30, mt: 0.25, color: 'primary.main' }}>
                        <CheckCircleRoundedIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={s} slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }} />
                    </ListItem>
                  ))}
                </List>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Files that are truncated beyond recovery, encrypted, or not actually PDFs cannot be repaired.
                </Typography>
              </Paper>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
