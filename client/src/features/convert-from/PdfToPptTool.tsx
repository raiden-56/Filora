import { FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
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

const tool = TOOL_BY_ID['pdf-to-ppt'];

type PptMode = 'both' | 'image' | 'text';

const MODE_OPTIONS: { value: PptMode; label: string; hint: string }[] = [
  { value: 'both', label: 'Slide image + editable text', hint: 'Faithful look with a text box you can edit.' },
  { value: 'image', label: 'Slide image only', hint: 'Each page becomes a picture. Smallest effort, not editable.' },
  { value: 'text', label: 'Editable text only', hint: 'Extracted text in editable boxes. Layout may differ.' },
];

const DPI_OPTIONS: { value: number; label: string }[] = [
  { value: 96, label: '96 dpi – small file' },
  { value: 150, label: '150 dpi – balanced (recommended)' },
  { value: 220, label: '220 dpi – sharp on large screens' },
];

export default function PdfToPptTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const [mode, setMode] = useState<PptMode>('both');
  const [dpi, setDpi] = useState(150);

  const onConvert = useCallback(() => {
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/convert/pdf-to-ppt',
          fields: { mode, dpi },
          processingStage: 'Converting...',
        }),
      'Uploading...',
    );
  }, [workflow, mode, dpi]);

  const slides = numberOf(workflow.result?.extra, 'slides');
  const pageCount = doc?.pageCount ?? 0;
  const selectedMode = MODE_OPTIONS.find((m) => m.value === mode);

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Conversion complete"
      resultDescription={slides ? `Your presentation with ${slides} slide${slides === 1 ? '' : 's'} is ready.` : 'Your presentation is ready.'}
      downloadLabel="Download PPTX"
      resultExtra={
        slides ? (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {slides} slide{slides === 1 ? '' : 's'} created · {selectedMode?.label.toLowerCase()}
              {mode !== 'text' ? ` · ${dpi} dpi` : ''}
            </Typography>
          </Paper>
        ) : null
      }
      configure={
        file && (
          <ConfigureLayout
            actionLabel="Convert to PowerPoint"
            actionIcon={<SlideshowRoundedIcon />}
            actionDisabled={doc?.status === 'error'}
            onAction={onConvert}
            summary={pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} → ${pageCount} slide${pageCount === 1 ? '' : 's'}.` : 'Each page becomes one slide.'}
            onBack={workflow.reset}
            options={
              <>
                <FormControl fullWidth>
                  <InputLabel id="ppt-mode-label">Slide content</InputLabel>
                  <Select labelId="ppt-mode-label" id="ppt-mode" label="Slide content" value={mode} onChange={(e) => setMode(e.target.value as PptMode)}>
                    {MODE_OPTIONS.map((m) => (
                      <MenuItem key={m.value} value={m.value}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
                  {selectedMode?.hint}
                </Typography>
                <FormControl fullWidth disabled={mode === 'text'}>
                  <InputLabel id="ppt-dpi-label">Image resolution</InputLabel>
                  <Select labelId="ppt-dpi-label" id="ppt-dpi" label="Image resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                    {DPI_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice />
              <PdfSummaryCard file={file} />
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
