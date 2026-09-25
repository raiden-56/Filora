import { Alert, Box, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
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
import { numberOf } from './resultMeta';

const tool = TOOL_BY_ID['pdf-to-excel'];

export default function PdfToExcelTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const [sheetPerPage, setSheetPerPage] = useState(true);

  const onConvert = useCallback(() => {
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/convert/pdf-to-excel',
          fields: { sheetPerPage },
          processingStage: 'Detecting tables...',
        }),
      'Uploading...',
    );
  }, [workflow, sheetPerPage]);

  const extra = workflow.result?.extra;
  const tablesFound = numberOf(extra, 'tablesFound');
  const sheets = numberOf(extra, 'sheets');
  const pageCount = doc?.pageCount ?? 0;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Conversion complete"
      resultDescription="Your Excel workbook is ready."
      downloadLabel="Download XLSX"
      resultExtra={
        tablesFound !== undefined || sheets !== undefined ? (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="excel-meta">
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Tables found
                </Typography>
                <Typography variant="h5">{tablesFound ?? '–'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Sheets
                </Typography>
                <Typography variant="h5">{sheets ?? '–'}</Typography>
              </Box>
            </Box>
            {tablesFound === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                No tables were detected. The text of each page was placed in rows so you can still work with it.
              </Alert>
            )}
          </Paper>
        ) : null
      }
      configure={
        file && (
          <ConfigureLayout
            actionLabel="Convert to Excel"
            actionIcon={<TableChartRoundedIcon />}
            actionDisabled={doc?.status === 'error'}
            onAction={onConvert}
            summary={pageCount ? `Tables from ${pageCount} page${pageCount === 1 ? '' : 's'} will be exported to XLSX.` : 'Tables will be exported to XLSX.'}
            onBack={workflow.reset}
            options={
              <>
                <FormControlLabel
                  control={<Switch checked={sheetPerPage} onChange={(e) => setSheetPerPage(e.target.checked)} />}
                  label="One sheet per page"
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
                  {sheetPerPage ? 'Each PDF page gets its own worksheet.' : 'All rows are collected in a single worksheet.'}
                </Typography>
              </>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice />
              <PdfSummaryCard file={file} />
              <Alert severity="info">Works best with PDFs that contain real text tables. Scanned tables need OCR first.</Alert>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
