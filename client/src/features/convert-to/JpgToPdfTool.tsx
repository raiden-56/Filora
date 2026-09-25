import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import SortByAlphaRoundedIcon from '@mui/icons-material/SortByAlphaRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { fileRegistry } from '@/services/fileRegistry';
import { dropzoneAccept, normalizeImageForPdf, readImageSize } from '@/utils/file';
import type { FileMeta } from '@/types';
import { imagesToPdf, stripExtension, withSuffix, type ImageInput, type ImagesToPdfOptions } from '@pdfly/core';
import { MARGIN_PRESETS, PT_PER_MM, computeImagePlacement, contentBox, formatPageDims, mmToPt, resolvePageDims, type MarginPreset } from './pageLayout';

const tool = TOOL_BY_ID['jpg-to-pdf'];

// ------------------------------------------------------------------ options form

const optionsSchema = z
  .object({
    pageSize: z.enum(['A4', 'A3', 'Letter', 'Legal', 'Fit', 'Custom']),
    orientation: z.enum(['auto', 'portrait', 'landscape']),
    margin: z.enum(['none', 'small', 'medium', 'large']),
    fit: z.enum(['fit', 'fill', 'original']),
    quality: z.number().int().min(10).max(100),
    /** custom page size in millimetres */
    customWidth: z.coerce.number().min(10, 'Min 10 mm').max(5000, 'Max 5000 mm'),
    customHeight: z.coerce.number().min(10, 'Min 10 mm').max(5000, 'Max 5000 mm'),
    merge: z.boolean(),
    outputName: z.string().max(180, 'Name is too long'),
  })
  .strict();

type OptionsForm = z.infer<typeof optionsSchema>;

function toCoreOptions(v: OptionsForm): ImagesToPdfOptions {
  return {
    pageSize: v.pageSize,
    orientation: v.orientation,
    margin: MARGIN_PRESETS[v.margin as MarginPreset],
    fit: v.fit,
    customSize: v.pageSize === 'Custom' ? { width: mmToPt(v.customWidth), height: mmToPt(v.customHeight) } : undefined,
  };
}

/** Whether a source image must be re-encoded before it can be embedded with pdf-lib. */
function needsReencode(type: string, quality: number): boolean {
  if (type === 'image/jpeg') return quality < 100;
  if (type === 'image/png') return quality < 100;
  return true; // WEBP (or anything else) is not supported by pdf-lib
}

async function prepareImage(blob: Blob, quality: number): Promise<{ data: Uint8Array; mimeType: 'image/jpeg' | 'image/png' }> {
  if (!needsReencode(blob.type, quality)) {
    // Keep the original bytes: no quality loss.
    return { data: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type as 'image/jpeg' | 'image/png' };
  }
  const q = quality / 100;
  if (blob.type === 'image/png' && quality < 100) {
    // A PNG at reduced quality becomes a JPEG. normalizeImageForPdf keeps PNGs as PNG, so hand it
    // the same bytes labelled as JPEG; decoding is content based and the output is then JPEG.
    return normalizeImageForPdf(new Blob([blob], { type: 'image/jpeg' }), { quality: q });
  }
  // JPEG with reduced quality, or WEBP (converted to JPEG; quality 100 -> near lossless).
  return normalizeImageForPdf(blob, { quality: quality >= 100 ? 1 : q });
}

// ------------------------------------------------------------------ live preview

const PREVIEW_BOX = 220;

interface PreviewProps {
  file?: FileMeta;
  size?: { width: number; height: number };
  values: OptionsForm;
}

function PagePreview({ file, size, values }: PreviewProps) {
  const url = file ? fileRegistry.objectUrl(file.id) : undefined;
  const rotation = ((file?.rotation ?? 0) % 360 + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  const baseW = size?.width ?? 800;
  const baseH = size?.height ?? 600;
  const imgW = swapped ? baseH : baseW;
  const imgH = swapped ? baseW : baseH;
  const margin = MARGIN_PRESETS[values.margin as MarginPreset];
  const [pageW, pageH] = resolvePageDims({
    pageSize: values.pageSize,
    orientation: values.orientation,
    customWidth: mmToPt(Number(values.customWidth) || 210),
    customHeight: mmToPt(Number(values.customHeight) || 297),
    imgW,
    imgH,
    margin,
  });
  const scale = Math.min(PREVIEW_BOX / pageW, PREVIEW_BOX / pageH);
  const rect = computeImagePlacement({ imgW, imgH, pageW, pageH, margin, fit: values.fit });
  const clip = contentBox(pageW, pageH, margin);
  const px = (v: number) => Math.round(v * scale * 100) / 100;

  return (
    <Box>
      <Box sx={{ display: 'grid', placeItems: 'center', p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
        <Box
          role="img"
          aria-label={`Preview: ${file ? file.name : 'image'} on a ${formatPageDims(pageW, pageH)} page`}
          sx={{
            position: 'relative',
            width: px(pageW),
            height: px(pageH),
            bgcolor: '#fff',
            boxShadow: 3,
            overflow: 'hidden',
            transition: 'width 150ms ease, height 150ms ease',
          }}
        >
          {margin > 0 && (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: px(clip.x),
                top: px(clip.y),
                width: px(clip.width),
                height: px(clip.height),
                outline: '1px dashed',
                outlineColor: 'divider',
                pointerEvents: 'none',
              }}
            />
          )}
          <Box sx={{ position: 'absolute', left: px(clip.x), top: px(clip.y), width: px(clip.width), height: px(clip.height), overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', left: px(rect.x - clip.x), top: px(rect.y - clip.y), width: px(rect.width), height: px(rect.height) }}>
              {url ? (
                <Box
                  component="img"
                  src={url}
                  alt=""
                  draggable={false}
                  sx={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: swapped ? px(rect.height) : px(rect.width),
                    height: swapped ? px(rect.width) : px(rect.height),
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    display: 'block',
                  }}
                />
              ) : (
                <Box sx={{ width: '100%', height: '100%', bgcolor: 'action.selected' }} />
              )}
            </Box>
          </Box>
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Page 1 · {formatPageDims(pageW, pageH)}
        {size ? ` · image ${size.width} × ${size.height} px` : ''}
      </Typography>
    </Box>
  );
}

// ------------------------------------------------------------------ tool

export default function JpgToPdfTool() {
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files, settings } = workflow;
  const inputRef = useRef<HTMLInputElement>(null);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});

  const { control, watch, handleSubmit, formState } = useForm<OptionsForm>({
    resolver: zodResolver(optionsSchema),
    mode: 'onChange',
    defaultValues: {
      pageSize: settings.defaultPageSize,
      orientation: settings.defaultOrientation,
      margin: 'none',
      fit: 'fit',
      quality: settings.imageQuality,
      customWidth: 210,
      customHeight: 297,
      merge: true,
      outputName: '',
    },
  });
  const values = watch();

  // Read intrinsic image sizes (for the preview and the "Fit to image" page size).
  useEffect(() => {
    let cancelled = false;
    for (const f of files) {
      if (sizes[f.id]) continue;
      const blob = fileRegistry.get(f.id);
      if (!blob) continue;
      readImageSize(blob)
        .then((s) => {
          if (!cancelled) setSizes((prev) => (prev[f.id] ? prev : { ...prev, [f.id]: s }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const first = files[0];
  const broken = useMemo(() => files.filter((f) => f.error), [files]);

  const onConvert = useCallback(
    (v: OptionsForm) => {
      void workflow.run(async (ctx) => {
        const opts = toCoreOptions(v);
        const total = ctx.files.length;
        ctx.setStage('Processing images...', 0);
        const images: ImageInput[] = [];
        for (let i = 0; i < total; i++) {
          const f = ctx.files[i];
          if (ctx.signal.aborted) throw { code: 'CANCELLED', message: 'The operation was cancelled.' };
          const blob = ctx.getBlob(f.id);
          let prepared: { data: Uint8Array; mimeType: 'image/jpeg' | 'image/png' };
          try {
            prepared = await prepareImage(blob, v.quality);
          } catch {
            throw new Error(`"${f.name}" could not be read as an image.`);
          }
          images.push({ ...prepared, rotation: f.rotation, name: f.name });
          ctx.setStage('Processing images...', (i + 1) / total);
        }

        ctx.setStage('Generating PDF...', null);
        const userName = v.outputName.trim();
        if (v.merge || images.length === 1) {
          const base = userName || (total === 1 ? stripExtension(ctx.files[0].name) : `images-${total}`);
          const data = await imagesToPdf(images, { ...opts, title: base });
          const blob = new Blob([data as BlobPart], { type: 'application/pdf' });
          return { outputs: [{ name: withSuffix(base, ''), blob, mimeType: 'application/pdf', pageCount: images.length }] };
        }
        const outputs = [];
        for (let i = 0; i < images.length; i++) {
          ctx.setStage('Generating PDF...', i / images.length);
          const base = stripExtension(ctx.files[i].name);
          const data = await imagesToPdf([images[i]], { ...opts, title: base });
          outputs.push({
            name: withSuffix(userName ? `${userName}-${i + 1}` : base, ''),
            blob: new Blob([data as BlobPart], { type: 'application/pdf' }),
            mimeType: 'application/pdf',
            pageCount: 1,
          });
        }
        return { outputs };
      }, 'Processing images...');
    },
    [workflow],
  );

  const sortByName = () =>
    workflow.setOrder([...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f) => f.id));

  const marginPt = MARGIN_PRESETS[values.margin as MarginPreset];
  const outputSummary = values.merge
    ? `${files.length} image${files.length === 1 ? '' : 's'} → 1 PDF with ${files.length} page${files.length === 1 ? '' : 's'}`
    : `${files.length} image${files.length === 1 ? '' : 's'} → ${files.length} PDF${files.length === 1 ? '' : 's (ZIP)'}`;

  const options = (
    <>
      <Controller
        name="pageSize"
        control={control}
        render={({ field }) => (
          <FormControl fullWidth size="small">
            <InputLabel id="jpg-page-size">Page size</InputLabel>
            <Select labelId="jpg-page-size" label="Page size" {...field}>
              <MenuItem value="A4">A4 (210 × 297 mm)</MenuItem>
              <MenuItem value="A3">A3 (297 × 420 mm)</MenuItem>
              <MenuItem value="Letter">Letter (8.5 × 11 in)</MenuItem>
              <MenuItem value="Legal">Legal (8.5 × 14 in)</MenuItem>
              <MenuItem value="Fit">Fit to image</MenuItem>
              <MenuItem value="Custom">Custom…</MenuItem>
            </Select>
          </FormControl>
        )}
      />
      {values.pageSize === 'Custom' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <Controller
            name="customWidth"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                label="Width (mm)"
                type="number"
                size="small"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                slotProps={{ htmlInput: { min: 10, max: 5000, step: 1, inputMode: 'decimal' } }}
              />
            )}
          />
          <Controller
            name="customHeight"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                label="Height (mm)"
                type="number"
                size="small"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                slotProps={{ htmlInput: { min: 10, max: 5000, step: 1, inputMode: 'decimal' } }}
              />
            )}
          />
        </Box>
      )}
      <Controller
        name="orientation"
        control={control}
        render={({ field }) => (
          <FormControl fullWidth size="small" disabled={values.pageSize === 'Fit'}>
            <InputLabel id="jpg-orientation">Orientation</InputLabel>
            <Select labelId="jpg-orientation" label="Orientation" {...field}>
              <MenuItem value="auto">Auto (match image)</MenuItem>
              <MenuItem value="portrait">Portrait</MenuItem>
              <MenuItem value="landscape">Landscape</MenuItem>
            </Select>
          </FormControl>
        )}
      />
      <Controller
        name="margin"
        control={control}
        render={({ field }) => (
          <FormControl fullWidth size="small">
            <InputLabel id="jpg-margin">Margin</InputLabel>
            <Select labelId="jpg-margin" label="Margin" {...field}>
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="small">Small (6 mm)</MenuItem>
              <MenuItem value="medium">Medium (13 mm)</MenuItem>
              <MenuItem value="large">Large (19 mm)</MenuItem>
            </Select>
          </FormControl>
        )}
      />
      <Controller
        name="fit"
        control={control}
        render={({ field }) => (
          <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ fontSize: 13 }}>
              Image fit
            </FormLabel>
            <RadioGroup {...field} aria-label="Image fit">
              <FormControlLabel value="fit" control={<Radio size="small" />} label="Fit to page (keep whole image)" />
              <FormControlLabel value="fill" control={<Radio size="small" />} label="Fill page (crop edges)" />
              <FormControlLabel value="original" control={<Radio size="small" />} label="Original size" />
            </RadioGroup>
          </FormControl>
        )}
      />
      <Controller
        name="quality"
        control={control}
        render={({ field }) => (
          <Box>
            <Typography id="jpg-quality-label" variant="body2" sx={{ fontWeight: 600 }}>
              Image quality: {field.value}%
            </Typography>
            <Slider
              value={field.value}
              onChange={(_, val) => field.onChange(Array.isArray(val) ? val[0] : val)}
              min={10}
              max={100}
              step={5}
              valueLabelDisplay="auto"
              aria-labelledby="jpg-quality-label"
              marks={[
                { value: 10, label: '10' },
                { value: 100, label: '100' },
              ]}
            />
            <Typography variant="caption" color="text.secondary">
              {field.value >= 100 ? 'Originals are embedded without re-encoding (WEBP is converted).' : 'Images are re-encoded as JPEG to reduce file size.'}
            </Typography>
          </Box>
        )}
      />
      <Controller
        name="merge"
        control={control}
        render={({ field }) => (
          <FormControlLabel
            control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
            label={field.value ? 'Merge all images into one PDF' : 'One PDF per image'}
          />
        )}
      />
      <Controller
        name="outputName"
        control={control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            label="Output file name"
            placeholder={files.length === 1 ? stripExtension(files[0].name) : `images-${files.length}`}
            helperText={fieldState.error?.message ?? '.pdf is added automatically'}
            error={!!fieldState.error}
            size="small"
            fullWidth
          />
        )}
      />
      <Button variant="outlined" startIcon={<SortByAlphaRoundedIcon />} onClick={sortByName} disabled={files.length < 2}>
        Sort by name
      </Button>
    </>
  );

  return (
    <ToolWorkflow
      workflow={workflow}
      uploadTitle="Drop your images here"
      resultTitle="PDF ready"
      resultDescription={values.merge ? 'Your images were combined into a PDF.' : 'One PDF was created for each image.'}
      downloadLabel={values.merge || files.length === 1 ? 'Download PDF' : 'Download All (ZIP)'}
      processingHint="Everything happens in your browser; large photos can take a moment."
      configure={
        <ConfigureLayout
          actionLabel="Convert to PDF"
          actionIcon={<PictureAsPdfRoundedIcon />}
          actionDisabled={files.length === 0 || broken.length > 0 || Object.keys(formState.errors).length > 0}
          onAction={() => void handleSubmit(onConvert)()}
          summary={outputSummary}
          onBack={workflow.reset}
          backLabel="Start over"
          options={options}
        >
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' } }}>
              <PagePreview file={first} size={first ? sizes[first.id] : undefined} values={values} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Live preview
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Shows how the first image will be placed on the page
                  {marginPt ? ` with a ${Math.round(marginPt / PT_PER_MM)} mm margin` : ''}. The preview updates as you change the options.
                </Typography>
              </Box>
            </Paper>
            <FileList
              files={files}
              variant="grid"
              onRemove={workflow.removeFile}
              onRename={workflow.renameFile}
              onRotate={(id) => workflow.rotateFile(id, 90)}
              onReorder={workflow.setOrder}
              onAddMore={() => inputRef.current?.click()}
              addMoreLabel="Add more images"
            />
            <Typography variant="caption" color="text.secondary">
              Tip: drag the handle on a card (or focus it and use Space + arrow keys) to change the page order. Rotate turns an image 90° clockwise.
            </Typography>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={Object.values(dropzoneAccept(['image'])).flat().join(',')}
              hidden
              aria-label="Add more images"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (list.length) void workflow.addFiles(list);
              }}
            />
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}

