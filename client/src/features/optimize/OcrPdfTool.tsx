import { Alert, Box, Button, Chip, Collapse, FormControl, FormControlLabel, InputLabel, MenuItem, OutlinedInput, Paper, Select, Stack, Switch, Typography } from '@mui/material';
import DocumentScannerRoundedIcon from '@mui/icons-material/DocumentScannerRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import { useCallback, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import { useToolWorkflow, type ToolWorkflow as Workflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { OCR_LANGUAGES } from '@/constants/limits';
import { processViaServer } from '@/services/serverProcess';
import { useAppSelector } from '@/store/hooks';
import PdfSummaryCard from '@/features/convert-from/PdfSummaryCard';
import ServerToolNotice from '@/features/convert-from/ServerToolNotice';
import { engineLabel, numberOf, stringListOf, stringOf, type ResultExtra } from '@/features/convert-from/resultMeta';

const tool = TOOL_BY_ID.ocr;

const DPI_OPTIONS: { value: number; label: string }[] = [
  { value: 150, label: '150 dpi – fastest' },
  { value: 200, label: '200 dpi – balanced (recommended)' },
  { value: 300, label: '300 dpi – most accurate, slower' },
];

const LANGUAGE_NAME: Record<string, string> = Object.fromEntries(OCR_LANGUAGES.map((l) => [l.code, l.name]));

function OcrSummary({ workflow }: { workflow: Workflow }) {
  const extra: ResultExtra | undefined = workflow.result?.extra;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const processed = numberOf(extra, 'pagesProcessed');
  const skipped = numberOf(extra, 'pagesSkipped');
  const characters = numberOf(extra, 'characters');
  const preview = stringOf(extra, 'textPreview');
  const engine = engineLabel(stringOf(extra, 'engine'));
  const languages = stringListOf(extra, 'languages');
  if (processed === undefined && !preview) return null;

  const copy = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      workflow.notify('Text copied to clipboard.', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      workflow.notify('Could not copy to the clipboard.', 'error');
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} component="section" aria-label="OCR result" data-testid="ocr-summary">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Pages processed
          </Typography>
          <Typography variant="h5">{processed ?? '–'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Pages skipped (had text)
          </Typography>
          <Typography variant="h5">{skipped ?? 0}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            Characters recognized
          </Typography>
          <Typography variant="h5">{characters !== undefined ? characters.toLocaleString() : '–'}</Typography>
        </Box>
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        {languages.map((l) => (
          <Chip key={l} size="small" variant="outlined" label={LANGUAGE_NAME[l] ?? l} />
        ))}
        {engine && <Chip size="small" variant="outlined" label={`Engine: ${engine}`} />}
      </Stack>
      {preview !== undefined && (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button size="small" onClick={() => setOpen((o) => !o)} startIcon={open ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />} aria-expanded={open} aria-controls="ocr-text-preview">
              {open ? 'Hide text preview' : 'Show text preview'}
            </Button>
            <Button size="small" onClick={() => void copy()} startIcon={<ContentCopyRoundedIcon />} disabled={!preview}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </Stack>
          <Collapse in={open}>
            <Box
              id="ocr-text-preview"
              component="pre"
              tabIndex={0}
              sx={{ mt: 1, p: 1.5, m: 0, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace', fontSize: 13, bgcolor: 'action.hover', borderRadius: 1.5 }}
            >
              {preview || 'No text was recognized.'}
            </Box>
          </Collapse>
        </Box>
      )}
    </Paper>
  );
}

export default function OcrPdfTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const doc = useAppSelector((s) => (file ? s.pdf.docs[file.id] : undefined));
  const defaultLanguage = OCR_LANGUAGES.some((l) => l.code === workflow.settings.defaultLanguage) ? workflow.settings.defaultLanguage : 'eng';
  const [languages, setLanguages] = useState<string[]>([defaultLanguage]);
  const [skipText, setSkipText] = useState(true);
  const [dpi, setDpi] = useState(200);
  const [includeText, setIncludeText] = useState(true);

  const onRun = useCallback(() => {
    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/pdf/ocr',
          fields: { languages, dpi, skipText, includeText },
          processingStage: 'Recognizing text...',
        }),
      'Uploading...',
    );
  }, [workflow, languages, dpi, skipText, includeText]);

  const pageCount = doc?.pageCount ?? 0;
  const estimate = pageCount ? `${pageCount * 5}–${pageCount * 10} s` : '5–10 s per page';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="OCR complete"
      resultDescription={workflow.outputs.length > 1 ? 'Your searchable PDF and the extracted text are ready.' : 'Your searchable PDF is ready.'}
      downloadLabel={workflow.outputs.length > 1 ? 'Download All (ZIP)' : 'Download PDF'}
      processingHint="Text recognition takes roughly 5–10 seconds per page."
      resultExtra={<OcrSummary workflow={workflow} />}
      configure={
        file && (
          <ConfigureLayout
            actionLabel={languages.length ? 'Run OCR' : 'Choose a language'}
            actionIcon={<DocumentScannerRoundedIcon />}
            actionDisabled={!languages.length || doc?.status === 'error'}
            onAction={onRun}
            summary={pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} · estimated ${estimate}.` : `Estimated time: ${estimate}.`}
            onBack={workflow.reset}
            options={
              <>
                <FormControl fullWidth>
                  <InputLabel id="ocr-languages-label">Languages</InputLabel>
                  <Select
                    labelId="ocr-languages-label"
                    id="ocr-languages"
                    multiple
                    value={languages}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLanguages(typeof v === 'string' ? v.split(',') : v);
                    }}
                    input={<OutlinedInput label="Languages" />}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map((code) => (
                          <Chip key={code} size="small" label={LANGUAGE_NAME[code] ?? code} />
                        ))}
                      </Box>
                    )}
                  >
                    {OCR_LANGUAGES.map((l) => (
                      <MenuItem key={l.code} value={l.code} sx={{ minHeight: 44 }}>
                        {l.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
                  Pick every language that appears in the document. More languages make recognition slower.
                </Typography>
                <FormControl fullWidth>
                  <InputLabel id="ocr-dpi-label">Scan resolution</InputLabel>
                  <Select labelId="ocr-dpi-label" id="ocr-dpi" label="Scan resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                    {DPI_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel control={<Switch checked={skipText} onChange={(e) => setSkipText(e.target.checked)} />} label="Skip pages that already contain text" />
                <FormControlLabel control={<Switch checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} />} label="Also download extracted text (.txt)" />
              </>
            }
          >
            <Stack spacing={2}>
              <ServerToolNotice />
              <PdfSummaryCard file={file} />
              <Alert severity="warning">OCR may take a while: roughly 5–10 seconds per page depending on resolution and the number of languages. Keep this tab open.</Alert>
            </Stack>
          </ConfigureLayout>
        )
      }
    />
  );
}
