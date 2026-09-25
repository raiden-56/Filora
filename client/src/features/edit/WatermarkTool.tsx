import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import NorthWestRoundedIcon from '@mui/icons-material/NorthWestRounded';
import NorthRoundedIcon from '@mui/icons-material/NorthRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import WestRoundedIcon from '@mui/icons-material/WestRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import EastRoundedIcon from '@mui/icons-material/EastRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import SouthRoundedIcon from '@mui/icons-material/SouthRounded';
import SouthEastRoundedIcon from '@mui/icons-material/SouthEastRounded';
import GridOnRoundedIcon from '@mui/icons-material/GridOnRounded';
import BrandingWatermarkRoundedIcon from '@mui/icons-material/BrandingWatermarkRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import ErrorState from '@/components/ErrorState';
import PageSelectionInput from '@/components/PageSelectionInput';
import UploadDropzone from '@/components/UploadDropzone';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { usePdfDocument, pdfCacheKey } from '@/hooks/usePdfDocument';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import { TOOL_BY_ID } from '@/constants/tools';
import { addWatermark, formatBytes, withSuffix, type WatermarkPosition } from '@pdfly/core';
import type { LoadedPdf } from '@/services/pdfjs';
import { normalizeImageForPdf } from '@/utils/file';
import { PageStrip, aspectFromInfo, useElementWidth, usePageCanvas, useStdTextWidth } from './pagePreview';
import { STD_FONT_FAMILY, imageTileOrigins, imageWatermarkSize, textTileOrigins, watermarkBox, type StdFontName } from './placement';
import { ColorField } from './PageNumbersTool';

const tool = TOOL_BY_ID.watermark;

const WATERMARK_SWATCHES = ['#ff0000', '#c62828', '#1565c0', '#2e7d32', '#f57c00', '#333333', '#9e9e9e'];
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type PagesMode = 'all' | 'custom';

interface TextSettings {
  text: string;
  font: StdFontName;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  pagesMode: PagesMode;
  pages: number[];
}

interface ImageSettings {
  file: File | null;
  opacity: number;
  /** fraction of the page width 0.05-1 */
  scale: number;
  rotation: number;
  position: WatermarkPosition;
  pagesMode: PagesMode;
  pages: number[];
}

const TEXT_DEFAULTS: TextSettings = { text: 'CONFIDENTIAL', font: 'Helvetica', fontSize: 48, color: '#ff0000', opacity: 0.3, rotation: 45, position: 'center', pagesMode: 'all', pages: [] };
const IMAGE_DEFAULTS: ImageSettings = { file: null, opacity: 0.3, scale: 0.4, rotation: 0, position: 'center', pagesMode: 'all', pages: [] };

const POSITIONS: { value: WatermarkPosition; label: string; icon: React.ReactElement }[] = [
  { value: 'top-left', label: 'Top left', icon: <NorthWestRoundedIcon /> },
  { value: 'top-center', label: 'Top center', icon: <NorthRoundedIcon /> },
  { value: 'top-right', label: 'Top right', icon: <NorthEastRoundedIcon /> },
  { value: 'middle-left', label: 'Middle left', icon: <WestRoundedIcon /> },
  { value: 'center', label: 'Center', icon: <CenterFocusStrongRoundedIcon /> },
  { value: 'middle-right', label: 'Middle right', icon: <EastRoundedIcon /> },
  { value: 'bottom-left', label: 'Bottom left', icon: <SouthWestRoundedIcon /> },
  { value: 'bottom-center', label: 'Bottom center', icon: <SouthRoundedIcon /> },
  { value: 'bottom-right', label: 'Bottom right', icon: <SouthEastRoundedIcon /> },
];

function PositionPicker({ value, onChange }: { value: WatermarkPosition; onChange: (v: WatermarkPosition) => void }) {
  return (
    <FormControl component="fieldset" fullWidth>
      <FormLabel component="legend" sx={{ fontSize: 13, mb: 0.75 }}>
        Position
      </FormLabel>
      <ToggleButtonGroup
        exclusive
        value={value}
        onChange={(_, v: WatermarkPosition | null) => v && onChange(v)}
        aria-label="Position"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, '& .MuiToggleButtonGroup-grouped': { border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', m: 0, minHeight: 44 } }}
      >
        {POSITIONS.map((p) => (
          <ToggleButton key={p.value} value={p.value} aria-label={p.label}>
            <Tooltip title={p.label}>{p.icon}</Tooltip>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButton
        value="tile"
        selected={value === 'tile'}
        onChange={() => onChange(value === 'tile' ? 'center' : 'tile')}
        aria-label="Tile across the page"
        fullWidth
        size="small"
        sx={{ mt: 0.5, minHeight: 40, gap: 1, textTransform: 'none' }}
      >
        <GridOnRoundedIcon fontSize="small" /> Tile across the page
      </ToggleButton>
    </FormControl>
  );
}

function LabeledSlider({ id, label, valueLabel, hint, ...slider }: { id: string; label: string; valueLabel: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <Box>
      <Typography id={id} variant="body2" sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{valueLabel}</span>
      </Typography>
      <Slider aria-labelledby={id} min={slider.min} max={slider.max} step={slider.step} value={slider.value} onChange={(_, v) => slider.onChange(v as number)} valueLabelDisplay="auto" />
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: -0.5 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function PagesPicker({ mode, pages, numPages, onMode, onPages, id }: { mode: PagesMode; pages: number[]; numPages: number; onMode: (m: PagesMode) => void; onPages: (p: number[]) => void; id: string }) {
  return (
    <FormControl component="fieldset">
      <FormLabel component="legend" sx={{ fontSize: 13 }}>
        Pages
      </FormLabel>
      <RadioGroup row value={mode} onChange={(e) => onMode(e.target.value as PagesMode)}>
        <FormControlLabel value="all" control={<Radio />} label="All pages" />
        <FormControlLabel value="custom" control={<Radio />} label="Selected pages" />
      </RadioGroup>
      {mode === 'custom' && (
        <Box sx={{ mt: 1 }}>
          <PageSelectionInput totalPages={numPages} value={pages} onChange={onPages} id={id} />
          {pages.length === 0 && <FormHelperText error>Enter at least one page.</FormHelperText>}
        </Box>
      )}
    </FormControl>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

type PreviewSpec = { kind: 'text'; s: TextSettings } | { kind: 'image'; s: ImageSettings; img: HTMLImageElement | null };

function drawWatermark(ctx: CanvasRenderingContext2D, spec: PreviewSpec, pageW: number, pageH: number, textWidth: number) {
  const rad = ((spec.s.rotation ?? 0) * Math.PI) / 180;
  ctx.globalAlpha = Math.min(1, Math.max(0, spec.s.opacity));
  if (spec.kind === 'text') {
    const { s } = spec;
    if (!s.text.trim()) return;
    ctx.font = `${s.fontSize}px ${STD_FONT_FAMILY[s.font]}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = s.color;
    const measured = ctx.measureText(s.text).width || 1;
    const fix = textWidth / measured; // match pdf-lib's Helvetica/Times/Courier metrics
    const paint = (x: number, y: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-rad); // canvas y is down: counter-clockwise on paper = negative here
      ctx.scale(fix, 1);
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    };
    if (s.position === 'tile') {
      for (const o of textTileOrigins(pageW, pageH, textWidth, s.fontSize)) paint(o.x, o.y);
    } else {
      const box = watermarkBox({ position: s.position, pageW, pageH, itemW: textWidth, itemH: s.fontSize });
      ctx.save();
      ctx.translate(box.cx, box.cy);
      ctx.rotate(-rad);
      ctx.scale(fix, 1);
      ctx.fillText(s.text, -textWidth / 2 / fix, s.fontSize / 2);
      ctx.restore();
    }
  } else {
    const { s, img } = spec;
    if (!img || !img.naturalWidth) return;
    const { width: w, height: h } = imageWatermarkSize(pageW, s.scale, img.naturalWidth, img.naturalHeight);
    if (s.position === 'tile') {
      for (const o of imageTileOrigins(pageW, pageH, w, h)) {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(-rad);
        ctx.drawImage(img, 0, -h, w, h);
        ctx.restore();
      }
    } else {
      const box = watermarkBox({ position: s.position, pageW, pageH, itemW: w, itemH: h });
      ctx.save();
      ctx.translate(box.cx, box.cy);
      ctx.rotate(-rad);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}

function WatermarkPreview({ loaded, docKey, numPages, pageInfo, spec }: { loaded: LoadedPdf | null; docKey: string; numPages: number; pageInfo: { width: number; height: number; rotation: number }[] | undefined; spec: PreviewSpec }) {
  const [page, setPage] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerWidth = useElementWidth(wrapRef);
  const maxWidth = Math.min(containerWidth || 0, 640);
  const canvas = usePageCanvas(loaded, page, maxWidth);
  const applies = spec.s.pagesMode === 'all' || spec.s.pages.includes(page);
  // exact pdf-lib metrics for the text width (image mode measures a dummy string, unused)
  const textWidth = useStdTextWidth(spec.kind === 'text' ? spec.s.font : 'Helvetica', spec.kind === 'text' ? spec.s.text : '', spec.kind === 'text' ? spec.s.fontSize : 12);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !canvas.width || !canvas.pageWidthPt) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.floor(canvas.width * dpr);
    el.height = Math.floor(canvas.height * dpr);
    el.style.width = `${canvas.width}px`;
    el.style.height = `${canvas.height}px`;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    if (!applies) return;
    ctx.setTransform(dpr * canvas.scale, 0, 0, dpr * canvas.scale, 0, 0);
    drawWatermark(ctx, spec, canvas.pageWidthPt, canvas.pageHeightPt, textWidth);
  }, [canvas.width, canvas.height, canvas.scale, canvas.pageWidthPt, canvas.pageHeightPt, spec, applies, textWidth]);

  return (
    <Stack spacing={1}>
      <Box ref={wrapRef} sx={{ width: '100%', display: 'flex', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 3, p: { xs: 1, sm: 2 }, minHeight: 200 }}>
        <Box sx={{ position: 'relative', lineHeight: 0, boxShadow: 3, bgcolor: '#fff', maxWidth: '100%' }}>
          <canvas ref={canvas.canvasRef} role="img" aria-label={`Preview of page ${page}`} style={{ display: 'block', maxWidth: '100%', opacity: canvas.loading ? 0.5 : 1, transition: 'opacity 150ms ease' }} />
          <canvas ref={overlayRef} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', maxWidth: '100%' }} />
          {!canvas.width && <Skeleton variant="rectangular" width={Math.max(200, maxWidth)} height={Math.max(280, maxWidth * 1.3)} />}
          {canvas.width > 0 && !applies && (
            <Typography variant="caption" sx={{ position: 'absolute', top: 8, left: 8, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', lineHeight: 1.5 }}>
              This page will not be watermarked
            </Typography>
          )}
        </Box>
      </Box>
      {canvas.error && <ErrorState error={canvas.error} title="Preview unavailable" />}
      <PageStrip loaded={loaded} docKey={docKey} numPages={numPages} current={page} onChange={setPage} aspectFor={(p) => aspectFromInfo(pageInfo, p)} ariaLabel="Preview page" />
    </Stack>
  );
}

/** Loads an HTMLImageElement for a File (null while loading / when absent). */
function useImageElement(file: File | null): HTMLImageElement | null {
  const url = useObjectUrl(file);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let alive = true;
    const el = new Image();
    el.onload = () => alive && setImg(el);
    el.onerror = () => alive && setImg(null);
    el.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return img;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export default function WatermarkTool() {
  const workflow = useToolWorkflow(tool);
  useIncomingFiles(workflow);
  const file = workflow.files[0];
  const fileId = file?.id ?? null;
  const { loaded, numPages, loading, error, info } = usePdfDocument(fileId, 'input');
  const docKey = fileId ? pdfCacheKey('input', fileId) : '';

  const [tab, setTab] = useState<'text' | 'image'>('text');
  const [text, setText] = useState<TextSettings>(TEXT_DEFAULTS);
  const [image, setImage] = useState<ImageSettings>(IMAGE_DEFAULTS);
  const [imageError, setImageError] = useState<string | null>(null);
  const img = useImageElement(image.file);

  const patchText = useCallback(<K extends keyof TextSettings>(key: K, value: TextSettings[K]) => setText((s) => ({ ...s, [key]: value })), []);
  const patchImage = useCallback(<K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => setImage((s) => ({ ...s, [key]: value })), []);

  const onImageFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!IMAGE_TYPES.has(f.type)) {
      setImageError(`"${f.name}" is not a PNG, JPG or WEBP image.`);
      return;
    }
    setImageError(null);
    setImage((s) => ({ ...s, file: f }));
  }, []);

  const spec: PreviewSpec = useMemo(() => (tab === 'text' ? { kind: 'text', s: text } : { kind: 'image', s: image, img }), [tab, text, image, img]);

  const current = tab === 'text' ? text : image;
  const targetCount = current.pagesMode === 'all' ? numPages : current.pages.length;
  const textEmpty = tab === 'text' && !text.text.trim();
  const imageMissing = tab === 'image' && !image.file;
  const disabled = !loaded || targetCount === 0 || textEmpty || imageMissing;

  const onApply = useCallback(() => {
    if (!file) return;
    const snapshot = tab === 'text' ? { kind: 'text' as const, s: text } : { kind: 'image' as const, s: image };
    void workflow.run(async (ctx) => {
      ctx.setStage('Analyzing...', null);
      const data = await ctx.getBytes(file.id);
      let out: Uint8Array;
      if (snapshot.kind === 'text') {
        const s = snapshot.s;
        ctx.setStage('Processing...', null);
        out = await addWatermark(data, {
          type: 'text',
          text: s.text,
          font: s.font,
          fontSize: s.fontSize,
          color: s.color,
          opacity: s.opacity,
          rotation: s.rotation,
          position: s.position,
          pages: s.pagesMode === 'custom' ? s.pages : undefined,
        });
      } else {
        const s = snapshot.s;
        if (!s.file) throw new Error('Please choose an image for the watermark.');
        ctx.setStage('Analyzing...', null);
        const { data: imgData, mimeType } = await normalizeImageForPdf(s.file, { preferPng: true });
        ctx.setStage('Processing...', null);
        out = await addWatermark(data, {
          type: 'image',
          image: imgData,
          imageType: mimeType,
          opacity: s.opacity,
          scale: s.scale,
          rotation: s.rotation,
          position: s.position,
          pages: s.pagesMode === 'custom' ? s.pages : undefined,
        });
      }
      ctx.setStage('Generating PDF...', null);
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
      return { outputs: [{ name: withSuffix(file.name, '-watermarked'), blob, mimeType: 'application/pdf', pageCount: numPages || undefined }] };
    }, 'Analyzing...');
  }, [workflow, file, tab, text, image, numPages]);

  const summary = !loaded
    ? 'Loading document...'
    : textEmpty
      ? 'Enter the watermark text.'
      : imageMissing
        ? 'Choose an image to use as the watermark.'
        : targetCount === 0
          ? 'Choose at least one page.'
          : `${tab === 'text' ? `"${text.text.trim()}"` : 'Image watermark'} will be ${current.position === 'tile' ? 'tiled across' : 'placed on'} ${targetCount} of ${numPages} page${numPages === 1 ? '' : 's'}.`;

  const rotationHint = 'Positive values rotate counter-clockwise (like pdf-lib).';

  return (
    <ToolWorkflow
      workflow={workflow}
      resultTitle="Watermark added"
      resultDescription="Your watermarked PDF is ready."
      downloadLabel="Download PDF"
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<BrandingWatermarkRoundedIcon />}
          actionDisabled={disabled}
          onAction={onApply}
          summary={summary}
          onBack={workflow.reset}
          backLabel="Change file"
          optionsTitle="Watermark"
          options={
            <>
              <Tabs value={tab} onChange={(_, v: 'text' | 'image') => setTab(v)} variant="fullWidth" aria-label="Watermark type" sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}>
                <Tab value="text" label="Text" icon={<TextFieldsRoundedIcon />} iconPosition="start" />
                <Tab value="image" label="Image" icon={<ImageRoundedIcon />} iconPosition="start" />
              </Tabs>

              {tab === 'text' && (
                <Stack spacing={2.5} role="tabpanel" aria-label="Text watermark settings">
                  <TextField label="Text" value={text.text} onChange={(e) => patchText('text', e.target.value)} error={textEmpty} helperText={textEmpty ? 'Text cannot be empty' : undefined} fullWidth slotProps={{ htmlInput: { maxLength: 120 } }} />
                  <FormControl fullWidth>
                    <InputLabel id="wm-font-label">Font</InputLabel>
                    <Select labelId="wm-font-label" label="Font" value={text.font} onChange={(e) => patchText('font', e.target.value as StdFontName)}>
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
                  <LabeledSlider id="wm-size" label="Font size" valueLabel={`${text.fontSize} pt`} min={12} max={200} step={1} value={text.fontSize} onChange={(v) => patchText('fontSize', v)} />
                  <ColorField value={text.color} onChange={(v) => patchText('color', v)} swatches={WATERMARK_SWATCHES} id="wm-color" />
                  <LabeledSlider id="wm-opacity" label="Opacity" valueLabel={`${Math.round(text.opacity * 100)}%`} min={0.05} max={1} step={0.05} value={text.opacity} onChange={(v) => patchText('opacity', v)} />
                  <LabeledSlider id="wm-rotation" label="Rotation" valueLabel={`${text.rotation}°`} min={-90} max={90} step={1} value={text.rotation} onChange={(v) => patchText('rotation', v)} hint={rotationHint} />
                  <PositionPicker value={text.position} onChange={(v) => patchText('position', v)} />
                  <PagesPicker mode={text.pagesMode} pages={text.pages} numPages={numPages} onMode={(m) => patchText('pagesMode', m)} onPages={(p) => patchText('pages', p)} id="wm-text-pages" />
                </Stack>
              )}

              {tab === 'image' && (
                <Stack spacing={2.5} role="tabpanel" aria-label="Image watermark settings">
                  {image.file ? (
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                      <Box sx={{ width: 56, height: 56, borderRadius: 1.5, bgcolor: 'action.hover', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                        {img ? <Box component="img" src={img.src} alt="" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ImageRoundedIcon color="disabled" />}
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {image.file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(image.file.size)}
                          {img ? ` · ${img.naturalWidth}×${img.naturalHeight}` : ''}
                          {image.file.type === 'image/webp' ? ' · converted to PNG' : ''}
                        </Typography>
                      </Box>
                      <IconButton aria-label="Remove image" onClick={() => patchImage('file', null)} size="small">
                        <CloseRoundedIcon />
                      </IconButton>
                    </Stack>
                  ) : (
                    <UploadDropzone accept={['image']} onFiles={onImageFiles} compact title="Drop an image here" buttonLabel="Choose image" hint="PNG, JPG or WEBP" id="wm-image-input" />
                  )}
                  {imageError && (
                    <Alert severity="error" onClose={() => setImageError(null)}>
                      {imageError}
                    </Alert>
                  )}
                  <LabeledSlider id="wm-img-opacity" label="Opacity" valueLabel={`${Math.round(image.opacity * 100)}%`} min={0.05} max={1} step={0.05} value={image.opacity} onChange={(v) => patchImage('opacity', v)} />
                  <LabeledSlider id="wm-img-scale" label="Size" valueLabel={`${Math.round(image.scale * 100)}% of page width`} min={0.05} max={1} step={0.01} value={image.scale} onChange={(v) => patchImage('scale', v)} />
                  <LabeledSlider id="wm-img-rotation" label="Rotation" valueLabel={`${image.rotation}°`} min={-90} max={90} step={1} value={image.rotation} onChange={(v) => patchImage('rotation', v)} hint={rotationHint} />
                  <PositionPicker value={image.position} onChange={(v) => patchImage('position', v)} />
                  <PagesPicker mode={image.pagesMode} pages={image.pages} numPages={numPages} onMode={(m) => patchImage('pagesMode', m)} onPages={(p) => patchImage('pages', p)} id="wm-image-pages" />
                </Stack>
              )}
              <Button size="small" color="inherit" onClick={() => (tab === 'text' ? setText(TEXT_DEFAULTS) : setImage((s) => ({ ...IMAGE_DEFAULTS, file: s.file })))}>
                Reset {tab} settings
              </Button>
            </>
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
                <WatermarkPreview loaded={loaded} docKey={docKey} numPages={numPages} pageInfo={info?.pages} spec={spec} />
              </>
            )}
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
