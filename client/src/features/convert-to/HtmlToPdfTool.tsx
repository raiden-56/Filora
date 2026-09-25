import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import UploadDropzone from '@/components/UploadDropzone';
import { useToolWorkflow, type ToolWorkflow as Workflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { useDebounce } from '@/hooks/useDebounce';
import { TOOL_BY_ID } from '@/constants/tools';
import { processViaServer } from '@/services/serverProcess';

const tool = TOOL_BY_ID['html-to-pdf'];

type Source = 'paste' | 'file' | 'url';

interface HtmlOptions {
  pageSize: 'A4' | 'A3' | 'Letter' | 'Legal';
  orientation: 'portrait' | 'landscape';
  /** millimetres */
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
  printBackground: boolean;
  scale: number;
}

interface HtmlFormState {
  source: Source;
  html: string;
  url: string;
  options: HtmlOptions;
}

const urlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL, e.g. https://example.com')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http:// and https:// URLs are supported');

function validateUrl(value: string): string | null {
  const r = urlSchema.safeParse(value);
  return r.success ? null : r.error.issues[0]?.message ?? 'Invalid URL';
}

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sample invoice</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; padding: 24px; }
      h1 { color: #ea580c; margin: 0 0 4px; }
      .muted { color: #6b7280; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
      th { background: #fff7ed; }
      tfoot td { font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>Invoice #1042</h1>
    <p class="muted">Issued 24 September 2026 · Due in 30 days</p>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>
        <tr><td>Design work</td><td>12 h</td><td>€ 960.00</td></tr>
        <tr><td>Hosting (annual)</td><td>1</td><td>€ 120.00</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2">Total</td><td>€ 1,080.00</td></tr></tfoot>
    </table>
  </body>
</html>`;

const DEFAULT_OPTIONS: HtmlOptions = {
  pageSize: 'A4',
  orientation: 'portrait',
  margin: 15,
  header: '',
  footer: '',
  pageNumbers: false,
  printBackground: true,
  scale: 1,
};

// ------------------------------------------------------------------ form

interface HtmlFormProps {
  workflow: Workflow;
  state: HtmlFormState;
  onChange: (patch: Partial<HtmlFormState>) => void;
  onOptions: (patch: Partial<HtmlOptions>) => void;
  onSubmit: () => void;
  /** whether the user tried to submit (shows validation for empty fields) */
  submitted: boolean;
}

function HtmlForm({ workflow, state, onChange, onOptions, onSubmit, submitted }: HtmlFormProps) {
  const { files } = workflow;
  const file = files[0];
  const { source, html, url, options } = state;
  const debouncedHtml = useDebounce(html, 300);

  const urlError = url.trim() ? validateUrl(url) : submitted && source === 'url' ? 'Enter a URL to convert' : null;
  const htmlError = submitted && source === 'paste' && !html.trim() ? 'Paste some HTML to convert' : null;

  const canSubmit = source === 'paste' ? html.trim().length > 0 : source === 'url' ? !validateUrl(url) : Boolean(file);

  const summary =
    source === 'paste'
      ? html.trim()
        ? `${html.length.toLocaleString()} characters of HTML will be rendered to PDF.`
        : 'Paste HTML to get started.'
      : source === 'url'
        ? url.trim()
          ? `The page at ${url.trim()} will be fetched and rendered.`
          : 'Enter a web address to convert.'
        : file
          ? `"${file.name}" will be converted to PDF.`
          : 'Upload an HTML file to convert.';

  const optionsPanel = (
    <>
      <FormControl fullWidth size="small">
        <InputLabel id="html-page-size">Page size</InputLabel>
        <Select labelId="html-page-size" label="Page size" value={options.pageSize} onChange={(e) => onOptions({ pageSize: e.target.value as HtmlOptions['pageSize'] })}>
          <MenuItem value="A4">A4</MenuItem>
          <MenuItem value="A3">A3</MenuItem>
          <MenuItem value="Letter">Letter</MenuItem>
          <MenuItem value="Legal">Legal</MenuItem>
        </Select>
      </FormControl>
      <FormControl fullWidth size="small">
        <InputLabel id="html-orientation">Orientation</InputLabel>
        <Select labelId="html-orientation" label="Orientation" value={options.orientation} onChange={(e) => onOptions({ orientation: e.target.value as HtmlOptions['orientation'] })}>
          <MenuItem value="portrait">Portrait</MenuItem>
          <MenuItem value="landscape">Landscape</MenuItem>
        </Select>
      </FormControl>
      <TextField
        label="Margins (mm)"
        type="number"
        size="small"
        value={options.margin}
        onChange={(e) => onOptions({ margin: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
        slotProps={{ htmlInput: { min: 0, max: 100, step: 1, inputMode: 'numeric' } }}
        fullWidth
      />
      <TextField label="Header text" size="small" value={options.header} onChange={(e) => onOptions({ header: e.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} fullWidth />
      <TextField label="Footer text" size="small" value={options.footer} onChange={(e) => onOptions({ footer: e.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} fullWidth />
      <FormControlLabel control={<Switch checked={options.pageNumbers} onChange={(e) => onOptions({ pageNumbers: e.target.checked })} />} label="Page numbers in footer" />
      <FormControlLabel control={<Switch checked={options.printBackground} onChange={(e) => onOptions({ printBackground: e.target.checked })} />} label="Print background graphics" />
      <Box>
        <Typography id="html-scale-label" variant="body2" sx={{ fontWeight: 600 }}>
          Scale: {Math.round(options.scale * 100)}%
        </Typography>
        <Slider
          value={options.scale}
          onChange={(_, v) => onOptions({ scale: Array.isArray(v) ? v[0] : v })}
          min={0.5}
          max={1.5}
          step={0.05}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
          aria-labelledby="html-scale-label"
          marks={[
            { value: 0.5, label: '50%' },
            { value: 1, label: '100%' },
            { value: 1.5, label: '150%' },
          ]}
        />
      </Box>
    </>
  );

  return (
    <ConfigureLayout
      actionLabel="Convert to PDF"
      actionIcon={<PictureAsPdfRoundedIcon />}
      actionDisabled={!canSubmit}
      onAction={onSubmit}
      summary={summary}
      onBack={file ? workflow.reset : undefined}
      backLabel="Start over"
      options={optionsPanel}
    >
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Tabs
            value={source}
            onChange={(_, v: Source) => onChange({ source: v })}
            variant="fullWidth"
            aria-label="HTML source"
            sx={{ borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 48 } }}
          >
            <Tab label="Paste HTML" value="paste" id="html-tab-paste" aria-controls="html-panel-paste" />
            <Tab label="Upload file" value="file" id="html-tab-file" aria-controls="html-panel-file" />
            <Tab label="From URL" value="url" id="html-tab-url" aria-controls="html-panel-url" />
          </Tabs>

          {source === 'paste' && (
            <Box role="tabpanel" id="html-panel-paste" aria-labelledby="html-tab-paste" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Paste a complete HTML document or a fragment. Inline CSS is supported.
                  </Typography>
                  <Button size="small" variant="text" onClick={() => onChange({ html: SAMPLE_HTML })}>
                    Load sample
                  </Button>
                </Box>
                <TextField
                  label="HTML"
                  multiline
                  minRows={10}
                  maxRows={24}
                  value={html}
                  onChange={(e) => onChange({ html: e.target.value })}
                  error={!!htmlError}
                  helperText={htmlError ?? undefined}
                  placeholder="<h1>Hello world</h1>"
                  fullWidth
                  slotProps={{
                    htmlInput: { spellCheck: false, 'aria-label': 'HTML code', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } },
                  }}
                />
                {debouncedHtml.trim() && (
                  <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      Preview
                    </Typography>
                    <Box
                      component="iframe"
                      title="HTML preview"
                      sandbox=""
                      srcDoc={debouncedHtml}
                      sx={{ width: '100%', height: 320, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      Scripts are disabled in the preview. The PDF is rendered on the server and may differ slightly.
                    </Typography>
                  </Box>
                )}
              </Stack>
            </Box>
          )}

          {source === 'file' && (
            <Box role="tabpanel" id="html-panel-file" aria-labelledby="html-tab-file" sx={{ p: 2 }}>
              {file ? (
                <FileList files={files} variant="list" onRemove={workflow.removeFile} onRename={workflow.renameFile} />
              ) : (
                <UploadDropzone accept={['html']} multiple={false} compact onFiles={(list) => void workflow.addFiles(list)} title="Drop your HTML file here" buttonLabel="Choose HTML File" />
              )}
            </Box>
          )}

          {source === 'url' && (
            <Box role="tabpanel" id="html-panel-url" aria-labelledby="html-tab-url" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <TextField
                  label="Web address"
                  type="url"
                  value={url}
                  onChange={(e) => onChange({ url: e.target.value })}
                  error={!!urlError}
                  helperText={urlError ?? 'Public pages only. The server fetches the page and renders it to PDF.'}
                  placeholder="https://example.com/article"
                  fullWidth
                  slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off' } }}
                />
                <Alert severity="info" variant="outlined">
                  Pages behind a login and pages that block automated access cannot be converted.
                </Alert>
              </Stack>
            </Box>
          )}
        </Paper>
        <Alert severity="info">Rendering happens securely on the server. Your content and the resulting PDF are deleted automatically.</Alert>
      </Stack>
    </ConfigureLayout>
  );
}

// ------------------------------------------------------------------ tool

export default function HtmlToPdfTool() {
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const [state, setState] = useState<HtmlFormState>({ source: 'paste', html: '', url: '', options: DEFAULT_OPTIONS });
  const [submitted, setSubmitted] = useState(false);

  const onChange = useCallback((patch: Partial<HtmlFormState>) => setState((s) => ({ ...s, ...patch })), []);
  const onOptions = useCallback((patch: Partial<HtmlOptions>) => setState((s) => ({ ...s, options: { ...s.options, ...patch } })), []);

  // Files can arrive from the Home page: show the file tab when the first one lands.
  const hasFile = workflow.files.length > 0;
  const hadFile = useRef(hasFile);
  useEffect(() => {
    if (hasFile && !hadFile.current) setState((s) => ({ ...s, source: 'file' }));
    hadFile.current = hasFile;
  }, [hasFile]);

  const onSubmit = useCallback(() => {
    setSubmitted(true);
    const { source, html, url, options } = state;
    if (source === 'paste' && !html.trim()) return;
    if (source === 'url' && validateUrl(url)) return;
    if (source === 'file' && !hasFile) return;

    const fields: Record<string, string | number | boolean | undefined> = {
      pageSize: options.pageSize,
      orientation: options.orientation,
      margin: options.margin,
      header: options.header.trim() || undefined,
      footer: options.footer.trim() || undefined,
      printBackground: options.printBackground,
      pageNumbers: options.pageNumbers,
      scale: options.scale,
    };
    if (source === 'paste') fields.html = html;
    if (source === 'url') fields.url = url.trim();

    void workflow.run(
      (ctx) =>
        processViaServer(ctx, {
          endpoint: '/convert/html-to-pdf',
          // No upload in paste/url mode: processViaServer would otherwise send every workflow file.
          files: source === 'file' ? undefined : [],
          fields,
          processingStage: 'Converting...',
        }),
      source === 'file' ? 'Uploading...' : 'Converting...',
    );
  }, [state, hasFile, workflow]);

  const form = <HtmlForm workflow={workflow} state={state} onChange={onChange} onOptions={onOptions} onSubmit={onSubmit} submitted={submitted} />;

  return (
    <ToolWorkflow
      workflow={workflow}
      upload={form}
      configure={form}
      stepLabels={['Content', 'Customize', 'Download']}
      resultTitle="PDF ready"
      resultDescription="Your web content was rendered to PDF."
      downloadLabel="Download PDF"
      processingHint="Pages with many images or web fonts can take a little longer."
    />
  );
}
