import { Alert, Chip, FormControl, FormControlLabel, FormLabel, Link, Paper, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import { useCallback, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID, toolPath } from '@/constants/tools';
import { pdfToWord } from '@/engines/pdfToWord';
import { useAppSelector } from '@/store/hooks';
import { stripExtension, withSuffix } from '@pdfly/core';
import PdfSummaryCard from './PdfSummaryCard';
import { engineLabel, stringOf } from './resultMeta';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const tool = TOOL_BY_ID['pdf-to-word'];

type WordMode = 'text' | 'layout';

export default function PdfToWordTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const [mode, setMode] = useState<WordMode>('text');

  const onConvert = useCallback(() => {
    void workflow.run(async (ctx) => {
      const input = ctx.files[0];
      const bytes = await ctx.getBytes(input.id);
      const r = await pdfToWord(bytes, stripExtension(input.name), { mode, signal: ctx.signal, onProgress: (stage, f) => ctx.setStage(stage, f) });
      return {
        outputs: [{ name: withSuffix(input.name, '', 'docx'), blob: r.blob, mimeType: DOCX_MIME, pageCount: r.pageCount }],
        extra: { engine: r.engine },
        warnings: r.warnings,
      };
    }, 'Converting...');
  }, [workflow, mode]);

  const engine = engineLabel(stringOf(workflow.result?.extra, 'engine'));
  const pageCount = doc?.pageCount ?? 0;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Conversion complete"
      resultDescription="Your Word document is ready."
      downloadLabel="Download DOCX"
      resultExtra={
        engine ? (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Converted with
            </Typography>
            <Chip size="small" label={engine} data-testid="engine-chip" />
            <Typography variant="body2" color="text.secondary">
              · {mode === 'text' ? 'editable text' : 'page layout'} mode
            </Typography>
          </Paper>
        ) : null
      }
      configure={
        file && (
          <ConfigureLayout
            actionLabel="Convert to Word"
            actionIcon={<DescriptionRoundedIcon />}
            actionDisabled={doc?.status === 'error'}
            onAction={onConvert}
            summary={pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} will be converted to DOCX.` : 'The PDF will be converted to DOCX.'}
            onBack={workflow.reset}
            options={
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Conversion mode
                </FormLabel>
                <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as WordMode)} name="word-mode">
                  <FormControlLabel value="text" control={<Radio />} label="Editable text (recommended)" />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
                    Flowing paragraphs you can edit freely. Best for reports and letters.
                  </Typography>
                  <FormControlLabel value="layout" control={<Radio />} label="Keep page layout (page images + text)" />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                    Each page becomes an image with the text on top. Looks identical, less editable.
                  </Typography>
                </RadioGroup>
              </FormControl>
            }
          >
            <Stack spacing={2}>
              <PdfSummaryCard file={file} />
              <Alert severity="info">
                Scanned PDFs contain no text layer, so the Word file would be empty. Run{' '}
                <Link component={RouterLink} to={toolPath('ocr-pdf')}>
                  OCR PDF
                </Link>{' '}
                first to recognize the text, then convert the result.
              </Alert>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
