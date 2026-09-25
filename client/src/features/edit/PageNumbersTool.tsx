import {
  Box,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import NorthWestRoundedIcon from '@mui/icons-material/NorthWestRounded';
import NorthRoundedIcon from '@mui/icons-material/NorthRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import SouthRoundedIcon from '@mui/icons-material/SouthRounded';
import SouthEastRoundedIcon from '@mui/icons-material/SouthEastRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import ErrorState from '@/components/ErrorState';
import PageSelectionInput from '@/components/PageSelectionInput';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument, pdfCacheKey } from '@/hooks/usePdfDocument';
import { TOOL_BY_ID } from '@/constants/tools';
import { addPageNumbers, formatPageNumber, withSuffix, type NumberPosition } from '@pdfly/core';
import type { LoadedPdf } from '@/services/pdfjs';
import { PageStrip, aspectFromInfo, useElementWidth, usePageCanvas, useStdTextWidth } from './pagePreview';
import { STD_FONT_FAMILY, numberPosition, type StdFontName } from './placement';

const tool = TOOL_BY_ID['page-numbers'];

const POSITIONS: { value: NumberPosition; label: string; icon: React.ReactNode }[] = [
  { value: 'top-left', label: 'Top left', icon: <NorthWestRoundedIcon /> },
  { value: 'top-center', label: 'Top center', icon: <NorthRoundedIcon /> },
  { value: 'top-right', label: 'Top right', icon: <NorthEastRoundedIcon /> },
  { value: 'bottom-left', label: 'Bottom left', icon: <SouthWestRoundedIcon /> },
  { value: 'bottom-center', label: 'Bottom center', icon: <SouthRoundedIcon /> },
  { value: 'bottom-right', label: 'Bottom right', icon: <SouthEastRoundedIcon /> },
];

const FORMAT_PRESETS: { value: string; label: string }[] = [
  { value: '{n}', label: '1' },
  { value: 'Page {n}', label: 'Page 1' },
  { value: 'Page {n} of {total}', label: 'Page 1 of N' },
  { value: '{n} / {total}', label: '1 / N' },
  { value: '- {n} -', label: '- 1 -' },
];
const CUSTOM = '__custom__';

export const COLOR_SWATCHES = ['#000000', '#333333', '#666666', '#9e9e9e', '#1565c0', '#c62828', '#2e7d32'];

const schema = z.object({
  position: z.enum(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']),
  startNumber: z.number().int('Must be a whole number').min(0, 'Must be 0 or more').max(999999, 'Too large'),
  font: z.enum(['Helvetica', 'TimesRoman', 'Courier']),
  fontSize: z.number().min(8).max(36),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #333333'),
  margin: z.number().min(10).max(80),
  format: z.string().trim().min(1, 'Format cannot be empty').max(80, 'Keep the format under 80 characters'),
  pagesMode: z.enum(['all', 'custom']),
  pages: z.array(z.number().int()),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  position: 'bottom-center',
  startNumber: 1,
  font: 'Helvetica',
  fontSize: 12,
  color: '#333333',
  margin: 28,
  format: '{n}',
  pagesMode: 'all',
  pages: [],
};

/** Colour picker: a few swatches plus the native colour input. Shared with the watermark tool. */
export function ColorField({ value, onChange, label = 'Colour', swatches = COLOR_SWATCHES, id = 'color-field' }: { value: string; onChange: (v: string) => void; label?: string; swatches?: string[]; id?: string }) {
  const theme = useTheme();
  return (
    <FormControl component="fieldset" fullWidth>
      <FormLabel component="legend" sx={{ fontSize: 13, mb: 0.75 }}>
        {label}
      </FormLabel>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        {swatches.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase();
          return (
            <Tooltip key={c} title={c}>
              <Box
                component="button"
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={active}
                onClick={() => onChange(c)}
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  bgcolor: c,
                  border: '2px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  boxShadow: active ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
                  cursor: 'pointer',
                  p: 0,
                  '&:focus-visible': { outline: 'none', boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.5)}` },
                }}
              />
            </Tooltip>
          );
        })}
        <Box
          component="label"
          htmlFor={id}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ml: 0.5, cursor: 'pointer', fontSize: 13, color: 'text.secondary' }}
        >
          <Box
            component="input"
            id={id}
            type="color"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
            aria-label="Custom colour"
            sx={{ width: 36, height: 28, p: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }}
          />
          Custom
        </Box>
      </Stack>
    </FormControl>
  );
}

function NumberPreview({ loaded, docKey, numPages, pageInfo, values }: { loaded: LoadedPdf | null; docKey: string; numPages: number; pageInfo: { width: number; height: number; rotation: number }[] | undefined; values: FormValues }) {
  const [page, setPage] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(wrapRef);
  const maxWidth = Math.min(containerWidth || 0, 640);
  const canvas = usePageCanvas(loaded, page, maxWidth);
  const total = numPages + values.startNumber - 1;
  const text = formatPageNumber(values.format || '{n}', values.startNumber + (page - 1), total);
  const textWidth = useStdTextWidth(values.font as StdFontName, text, values.fontSize);
  const numbered = values.pagesMode === 'all' || values.pages.includes(page);

  const placement = canvas.pageWidthPt
    ? numberPosition({ position: values.position, margin: values.margin, fontSize: values.fontSize, textWidth, pageW: canvas.pageWidthPt, pageH: canvas.pageHeightPt })
    : null;
  const s = canvas.scale;

  return (
    <Stack spacing={1}>
      <Box ref={wrapRef} sx={{ width: '100%', display: 'flex', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 3, p: { xs: 1, sm: 2 }, minHeight: 200 }}>
        <Box sx={{ position: 'relative', lineHeight: 0, boxShadow: 3, bgcolor: '#fff', maxWidth: '100%' }}>
          <canvas ref={canvas.canvasRef} role="img" aria-label={`Preview of page ${page}`} style={{ display: 'block', maxWidth: '100%', opacity: canvas.loading ? 0.5 : 1, transition: 'opacity 150ms ease' }} />
          {!canvas.width && <Skeleton variant="rectangular" width={Math.max(200, maxWidth)} height={Math.max(280, maxWidth * 1.3)} />}
          {placement && numbered && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: placement.x * s,
                top: placement.y * s,
                width: placement.textWidth * s,
                height: placement.fontSize * s,
                lineHeight: `${placement.fontSize * s}px`,
                fontSize: placement.fontSize * s,
                fontFamily: STD_FONT_FAMILY[values.font as StdFontName],
                color: values.color,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                outline: '1px dashed',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              }}
            >
              {text}
            </Box>
          )}
          {placement && !numbered && (
            <Typography variant="caption" sx={{ position: 'absolute', top: 8, left: 8, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff' }}>
              This page will not be numbered
            </Typography>
          )}
        </Box>
      </Box>
      {canvas.error && <ErrorState error={canvas.error} title="Preview unavailable" />}
      <PageStrip loaded={loaded} docKey={docKey} numPages={numPages} current={page} onChange={setPage} aspectFor={(p) => aspectFromInfo(pageInfo, p)} ariaLabel="Preview page" />
    </Stack>
  );
}

export default function PageNumbersTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const fileId = file?.id ?? null;
  const { loaded, numPages, loading, error, info } = usePdfDocument(fileId, 'input');
  const docKey = fileId ? pdfCacheKey('input', fileId) : '';

  const { control, watch, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
    mode: 'onChange',
  });
  const values = watch();
  const [customFormat, setCustomFormat] = useState(false);
  const presetValue = customFormat ? CUSTOM : FORMAT_PRESETS.some((p) => p.value === values.format) ? values.format : CUSTOM;

  const targetCount = values.pagesMode === 'all' ? numPages : values.pages.length;

  const onApply = useMemo(
    () =>
      handleSubmit((v) => {
        if (!file) return;
        void workflow.run(async (ctx) => {
          ctx.setStage('Analyzing...', null);
          const data = await ctx.getBytes(file.id);
          ctx.setStage('Processing...', null);
          const out = await addPageNumbers(data, {
            position: v.position,
            startNumber: v.startNumber,
            font: v.font,
            fontSize: v.fontSize,
            color: v.color,
            margin: v.margin,
            format: v.format,
            pages: v.pagesMode === 'custom' ? v.pages : undefined,
          });
          ctx.setStage('Generating PDF...', null);
          const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
          return { outputs: [{ name: withSuffix(file.name, '-numbered'), blob, mimeType: 'application/pdf', pageCount: numPages || undefined }] };
        }, 'Analyzing...');
      }),
    [handleSubmit, workflow, file, numPages],
  );

  const onPagesChange = useCallback((pages: number[]) => setValue('pages', pages, { shouldValidate: true }), [setValue]);

  const summary = !loaded
    ? 'Loading document...'
    : targetCount === 0
      ? 'Choose at least one page to number.'
      : `${targetCount} of ${numPages} page${numPages === 1 ? '' : 's'} will be numbered (${formatPageNumber(values.format || '{n}', values.startNumber, numPages + values.startNumber - 1)} ...).`;

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Page numbers added"
      resultDescription="Your numbered PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<FormatListNumberedRoundedIcon />}
          actionDisabled={!loaded || Object.keys(formState.errors).length > 0 || targetCount === 0}
          onAction={() => void onApply()}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Numbering"
          options={
            <Box component="form" onSubmit={(e) => e.preventDefault()} noValidate>
              <Stack spacing={2.5}>
                <Controller
                  name="position"
                  control={control}
                  render={({ field }) => (
                    <FormControl component="fieldset">
                      <FormLabel component="legend" sx={{ fontSize: 13, mb: 0.75 }}>
                        Position
                      </FormLabel>
                      <ToggleButtonGroup
                        exclusive
                        value={field.value}
                        onChange={(_, v: NumberPosition | null) => v && field.onChange(v)}
                        aria-label="Position"
                        sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, '& .MuiToggleButtonGroup-grouped': { border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', m: 0, minHeight: 44 } }}
                      >
                        {POSITIONS.map((p) => (
                          <ToggleButton key={p.value} value={p.value} aria-label={p.label}>
                            <Tooltip title={p.label}>{p.icon as React.ReactElement}</Tooltip>
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                    </FormControl>
                  )}
                />

                <Stack direction="row" spacing={1.5}>
                  <Controller
                    name="startNumber"
                    control={control}
                    render={({ field, fieldState }) => (
                      <TextField
                        label="Start at"
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? NaN : Number(e.target.value))}
                        onBlur={field.onBlur}
                        error={Boolean(fieldState.error)}
                        helperText={fieldState.error?.message}
                        slotProps={{ htmlInput: { min: 0, step: 1, inputMode: 'numeric' } }}
                        fullWidth
                      />
                    )}
                  />
                  <Controller
                    name="font"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="pn-font-label">Font</InputLabel>
                        <Select labelId="pn-font-label" label="Font" value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                          <MenuItem value="Helvetica" sx={{ fontFamily: STD_FONT_FAMILY.Helvetica }}>
                            Helvetica
                          </MenuItem>
                          <MenuItem value="TimesRoman" sx={{ fontFamily: STD_FONT_FAMILY.TimesRoman }}>
                            Times
                          </MenuItem>
                          <MenuItem value="Courier" sx={{ fontFamily: STD_FONT_FAMILY.Courier }}>
                            Courier
                          </MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Stack>

                <Controller
                  name="fontSize"
                  control={control}
                  render={({ field }) => (
                    <Box>
                      <Typography id="pn-size-label" variant="body2" sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Font size</span>
                        <span>{field.value} pt</span>
                      </Typography>
                      <Slider aria-labelledby="pn-size-label" min={8} max={36} step={1} value={field.value} onChange={(_, v) => field.onChange(v as number)} valueLabelDisplay="auto" />
                    </Box>
                  )}
                />

                <Controller name="color" control={control} render={({ field }) => <ColorField value={field.value} onChange={field.onChange} id="pn-color" />} />

                <Controller
                  name="margin"
                  control={control}
                  render={({ field }) => (
                    <Box>
                      <Typography id="pn-margin-label" variant="body2" sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Margin from edge</span>
                        <span>{field.value} pt</span>
                      </Typography>
                      <Slider aria-labelledby="pn-margin-label" min={10} max={80} step={1} value={field.value} onChange={(_, v) => field.onChange(v as number)} valueLabelDisplay="auto" />
                    </Box>
                  )}
                />

                <Controller
                  name="format"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Stack spacing={1.5}>
                      <FormControl fullWidth>
                        <InputLabel id="pn-format-label">Format</InputLabel>
                        <Select
                          labelId="pn-format-label"
                          label="Format"
                          value={presetValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === CUSTOM) {
                              setCustomFormat(true);
                            } else {
                              setCustomFormat(false);
                              field.onChange(v);
                            }
                          }}
                        >
                          {FORMAT_PRESETS.map((p) => (
                            <MenuItem key={p.value} value={p.value}>
                              {p.label}
                            </MenuItem>
                          ))}
                          <MenuItem value={CUSTOM}>Custom...</MenuItem>
                        </Select>
                      </FormControl>
                      {presetValue === CUSTOM && (
                        <TextField
                          label="Custom format"
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                          onBlur={field.onBlur}
                          error={Boolean(fieldState.error)}
                          helperText={fieldState.error?.message ?? 'Use {n} for the page number and {total} for the page count, e.g. "Sheet {n}/{total}".'}
                          fullWidth
                          autoFocus
                        />
                      )}
                    </Stack>
                  )}
                />

                <Controller
                  name="pagesMode"
                  control={control}
                  render={({ field }) => (
                    <FormControl component="fieldset">
                      <FormLabel component="legend" sx={{ fontSize: 13 }}>
                        Pages to number
                      </FormLabel>
                      <RadioGroup row value={field.value} onChange={(e) => field.onChange(e.target.value)}>
                        <FormControlLabel value="all" control={<Radio />} label="All pages" />
                        <FormControlLabel value="custom" control={<Radio />} label="Selected pages" />
                      </RadioGroup>
                      {field.value === 'custom' && (
                        <Box sx={{ mt: 1 }}>
                          <PageSelectionInput totalPages={numPages} value={values.pages} onChange={onPagesChange} label="Pages" id="pn-pages" />
                          {values.pages.length === 0 && <FormHelperText error>Enter at least one page.</FormHelperText>}
                        </Box>
                      )}
                    </FormControl>
                  )}
                />
              </Stack>
            </Box>
          }
        >
          <Stack spacing={2}>
            {error && <ErrorState error={error} title="Could not open this PDF" onRetry={workflow.reset} retryLabel="Choose another file" />}
            {loading && !loaded && <Skeleton variant="rounded" height={420} />}
            {loaded && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {file?.name} · {numPages} page{numPages === 1 ? '' : 's'} · live preview
                </Typography>
                <NumberPreview loaded={loaded} docKey={docKey} numPages={numPages} pageInfo={info?.pages} values={values} />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
