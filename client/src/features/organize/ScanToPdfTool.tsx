import { Alert, Box, Button, Chip, FormControlLabel, MenuItem, Slider, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CropRoundedIcon from '@mui/icons-material/CropRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileCard from '@/components/FileCard';
import CameraCapture, { hasLiveCamera } from '@/components/CameraCapture';
import ImageCropDialog from '@/components/ImageCropDialog';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { fileRegistry } from '@/services/fileRegistry';
import { dropzoneAccept, normalizeImageForPdf } from '@/utils/file';
import { formatBytes } from '@/utils/format';
import type { FileMeta } from '@/types';
import { imagesToPdf, type ImageInput, type Orientation, type PageSizeName } from '@pdfly/core';
import { SCAN_MARGIN_POINTS, cropToPixels, enhanceFilter, scanFileName, type CropRect, type ScanMargin } from './organizePages';

const tool = TOOL_BY_ID['scan-to-pdf'];

type ScanPageSize = Extract<PageSizeName, 'A4' | 'Letter' | 'Legal' | 'Fit'>;
const PAGE_SIZE_OPTIONS: { value: ScanPageSize; label: string }[] = [
  { value: 'A4', label: 'A4' },
  { value: 'Letter', label: 'Letter' },
  { value: 'Legal', label: 'Legal' },
  { value: 'Fit', label: 'Fit to image' },
];
const MAX_DIMENSION = 4000;
const IMAGE_ACCEPT = Object.values(dropzoneAccept(['image'])).flat().join(',');

// ---------------------------------------------------------------------------
// Image rendering (crop + enhance) via canvas
// ---------------------------------------------------------------------------

/** Manual pixel filter for browsers without CanvasRenderingContext2D.filter (older Safari). */
function applyFilterManually(ctx: CanvasRenderingContext2D, width: number, height: number, enhance: boolean, grayscale: boolean) {
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const contrast = enhance ? 1.25 : 1;
  const brightness = enhance ? 1.05 : 1;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (enhance) {
      r = ((r - 128) * contrast + 128) * brightness;
      g = ((g - 128) * contrast + 128) * brightness;
      b = ((b - 128) * contrast + 128) * brightness;
    }
    if (grayscale) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = g = b = l;
    }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
}

async function renderScanImage(
  blob: Blob,
  opts: { crop: CropRect | null; enhance: boolean; grayscale: boolean; quality: number },
): Promise<{ data: Uint8Array; mimeType: 'image/jpeg' }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const region = opts.crop ? cropToPixels(opts.crop, bitmap.width, bitmap.height) : { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
    let w = region.sw;
    let h = region.sh;
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const s = MAX_DIMENSION / Math.max(w, h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not supported in this browser.');
    const filter = enhanceFilter(opts.enhance, opts.grayscale);
    const supportsFilter = 'filter' in ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (supportsFilter && filter !== 'none') ctx.filter = filter;
    ctx.drawImage(bitmap, region.sx, region.sy, region.sw, region.sh, 0, 0, w, h);
    if (supportsFilter) ctx.filter = 'none';
    else if (filter !== 'none') applyFilterManually(ctx, w, h, opts.enhance, opts.grayscale);
    const out: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image conversion failed'))), 'image/jpeg', opts.quality),
    );
    canvas.width = 0;
    canvas.height = 0;
    return { data: new Uint8Array(await out.arrayBuffer()), mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------
// Sortable page card
// ---------------------------------------------------------------------------

function ScanPreview({ file, crop, filter }: { file: FileMeta; crop: CropRect | null; filter: string }) {
  const url = fileRegistry.objectUrl(file.id);
  const clip = crop ? `inset(${(crop.y * 100).toFixed(2)}% ${((1 - crop.x - crop.width) * 100).toFixed(2)}% ${((1 - crop.y - crop.height) * 100).toFixed(2)}% ${(crop.x * 100).toFixed(2)}%)` : undefined;
  return (
    <Box
      component="img"
      src={url}
      alt={file.name}
      draggable={false}
      sx={{
        maxWidth: '100%',
        maxHeight: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        transform: `rotate(${file.rotation}deg)`,
        transition: 'transform 200ms ease',
        filter: filter === 'none' ? undefined : filter,
        clipPath: clip,
      }}
    />
  );
}

function ScanCardInner(props: {
  file: FileMeta;
  index: number;
  sortable: boolean;
  crop: CropRect | null;
  filter: string;
  onRemove: (id: string) => void;
  onRotate: (id: string) => void;
  onCrop: (id: string) => void;
}) {
  const { file, index, sortable, crop, filter, onRemove, onRotate, onCrop } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled: !sortable });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: 'relative' as const };
  return (
    <Box ref={setNodeRef} style={style}>
      <FileCard
        file={file}
        index={index}
        onRemove={onRemove}
        onRotate={onRotate}
        isDragging={isDragging}
        dragHandleProps={sortable ? { ...attributes, ...listeners } : undefined}
        preview={<ScanPreview file={file} crop={crop} filter={filter} />}
      />
      <Button
        size="small"
        variant="contained"
        color="inherit"
        startIcon={<CropRoundedIcon />}
        onClick={() => onCrop(file.id)}
        aria-label={`Crop page ${index + 1}`}
        sx={{ position: 'absolute', top: 18, right: 18, minHeight: 36, bgcolor: 'background.paper', color: 'text.primary', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}
      >
        Crop
      </Button>
      {crop && <Chip size="small" color="primary" label="Cropped" sx={{ position: 'absolute', top: 22, left: 18, height: 22, fontSize: 11, fontWeight: 700 }} />}
    </Box>
  );
}
const ScanCard = memo(ScanCardInner);

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export default function ScanToPdfTool() {
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files } = workflow;

  const [crops, setCrops] = useState<Record<string, CropRect | null>>({});
  const [enhance, setEnhance] = useState(false);
  const [grayscale, setGrayscale] = useState(false);
  const [pageSize, setPageSize] = useState<ScanPageSize>('A4');
  const [orientation, setOrientation] = useState<Orientation | 'auto'>('auto');
  const [margin, setMargin] = useState<ScanMargin>('small');
  const [quality, setQuality] = useState(0.85);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState<string | null>(null);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const openNativeCamera = useCallback(() => cameraInputRef.current?.click(), []);
  const openCamera = useCallback(() => {
    if (hasLiveCamera()) setCameraOpen(true);
    else openNativeCamera();
  }, [openNativeCamera]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (list.length) void workflow.addFiles(list);
  };

  const removeFile = useCallback(
    (id: string) => {
      workflow.removeFile(id);
      setCrops((c) => {
        if (!(id in c)) return c;
        const next = { ...c };
        delete next[id];
        return next;
      });
    },
    [workflow],
  );
  const rotateFile = useCallback((id: string) => workflow.rotateFile(id, 90), [workflow]);
  const openCrop = useCallback((id: string) => setCropTarget(id), []);

  const filter = useMemo(() => enhanceFilter(enhance, grayscale), [enhance, grayscale]);
  const cropFile = cropTarget ? files.find((f) => f.id === cropTarget) : undefined;
  const cropSrc = cropFile ? (fileRegistry.objectUrl(cropFile.id) ?? null) : null;
  const croppedCount = files.filter((f) => crops[f.id]).length;
  const totalSize = files.reduce((n, f) => n + f.size, 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortable = files.length > 1;
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = files.map((f) => f.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    workflow.setOrder(arrayMove(ids, from, to));
  };

  const onCreate = useCallback(() => {
    const settings = { crops, enhance, grayscale, pageSize, orientation, margin, quality };
    void workflow.run(async (ctx) => {
      const images: ImageInput[] = [];
      const n = ctx.files.length;
      for (let i = 0; i < n; i++) {
        if (ctx.signal.aborted) throw { code: 'CANCELLED', message: 'The operation was cancelled.' };
        const f = ctx.files[i];
        ctx.setStage('Processing...', i / n);
        const blob = ctx.getBlob(f.id);
        const crop = settings.crops[f.id] ?? null;
        const needsCanvas = Boolean(crop) || settings.enhance || settings.grayscale;
        const img = needsCanvas
          ? await renderScanImage(blob, { crop, enhance: settings.enhance, grayscale: settings.grayscale, quality: settings.quality })
          : await normalizeImageForPdf(blob, { quality: settings.quality, maxDimension: MAX_DIMENSION });
        images.push({ data: img.data, mimeType: img.mimeType, rotation: f.rotation, name: f.name });
        // Yield to the browser between images so the UI stays responsive.
        await new Promise((r) => setTimeout(r, 0));
      }
      ctx.setStage('Generating PDF...', null);
      const data = await imagesToPdf(images, {
        pageSize: settings.pageSize,
        orientation: settings.orientation,
        margin: SCAN_MARGIN_POINTS[settings.margin],
        fit: 'fit',
        title: 'Scan',
      });
      return {
        outputs: [{ name: scanFileName(), blob: new Blob([data as BlobPart], { type: 'application/pdf' }), mimeType: 'application/pdf', pageCount: images.length }],
      };
    }, 'Processing...');
  }, [workflow, crops, enhance, grayscale, pageSize, orientation, margin, quality]);

  const cameraButton = (
    <Button variant="outlined" size="large" startIcon={<PhotoCameraRoundedIcon />} onClick={openCamera} sx={{ minWidth: 160 }}>
      Take photo
    </Button>
  );

  return (
    <>
      <ToolWorkflow
        workflow={workflow}
        uploadTitle="Drop your scans or photos here"
        uploadExtraActions={cameraButton}
        resultTitle="PDF created"
        resultDescription="Your scanned document is ready."
        downloadLabel="Download PDF"
        processingHint="Large photos can take a moment to process."
        configure={
          <ConfigureLayout
            actionLabel={tool.actionLabel}
            actionIcon={<PictureAsPdfRoundedIcon />}
            actionDisabled={files.length === 0}
            onAction={onCreate}
            summary={`${files.length} page${files.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}${croppedCount ? ` · ${croppedCount} cropped` : ''}${enhance ? ' · enhanced' : ''}${grayscale ? ' · grayscale' : ''}`}
            onBack={workflow.reset}
            backLabel="Start over"
            optionsTitle="PDF options"
            options={
              <>
                <TextField select label="Page size" value={pageSize} onChange={(e) => setPageSize(e.target.value as ScanPageSize)} fullWidth>
                  {PAGE_SIZE_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }} id="scan-orientation-label">
                    Orientation
                  </Typography>
                  <ToggleButtonGroup exclusive fullWidth size="small" value={orientation} onChange={(_, v: Orientation | 'auto' | null) => v && setOrientation(v)} aria-labelledby="scan-orientation-label" disabled={pageSize === 'Fit'}>
                    <ToggleButton value="auto" sx={{ textTransform: 'none', minHeight: 40 }}>Auto</ToggleButton>
                    <ToggleButton value="portrait" sx={{ textTransform: 'none', minHeight: 40 }}>Portrait</ToggleButton>
                    <ToggleButton value="landscape" sx={{ textTransform: 'none', minHeight: 40 }}>Landscape</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }} id="scan-margin-label">
                    Margin
                  </Typography>
                  <ToggleButtonGroup exclusive fullWidth size="small" value={margin} onChange={(_, v: ScanMargin | null) => v && setMargin(v)} aria-labelledby="scan-margin-label">
                    <ToggleButton value="none" sx={{ textTransform: 'none', minHeight: 40 }}>None</ToggleButton>
                    <ToggleButton value="small" sx={{ textTransform: 'none', minHeight: 40 }}>Small</ToggleButton>
                    <ToggleButton value="medium" sx={{ textTransform: 'none', minHeight: 40 }}>Medium</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" id="scan-quality-label">
                    JPEG quality: {Math.round(quality * 100)}%
                  </Typography>
                  <Slider
                    value={quality}
                    min={0.4}
                    max={1}
                    step={0.05}
                    onChange={(_, v) => setQuality(Array.isArray(v) ? v[0] : v)}
                    aria-labelledby="scan-quality-label"
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                  />
                </Box>
                <FormControlLabel control={<Switch checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />} label="Auto-enhance (contrast and brightness)" />
                <FormControlLabel control={<Switch checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />} label="Grayscale" />
              </>
            }
          >
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {files.length} page{files.length === 1 ? '' : 's'}
                  {sortable && ' · Drag to reorder'}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" startIcon={<AddPhotoAlternateRoundedIcon />} onClick={() => filesInputRef.current?.click()}>
                    Add page
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<PhotoCameraRoundedIcon />} onClick={openCamera}>
                    Take photo
                  </Button>
                </Stack>
              </Box>
              {files.length === 0 && <Alert severity="info">Add at least one image or take a photo to create a PDF.</Alert>}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={files.map((f) => f.id)} strategy={rectSortingStrategy}>
                  <Box
                    role="list"
                    aria-label="Scanned pages"
                    sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } }}
                  >
                    {files.map((f, i) => (
                      <Box key={f.id} role="listitem">
                        <ScanCard file={f} index={i} sortable={sortable} crop={crops[f.id] ?? null} filter={filter} onRemove={removeFile} onRotate={rotateFile} onCrop={openCrop} />
                      </Box>
                    ))}
                  </Box>
                </SortableContext>
              </DndContext>
              <Typography variant="caption" color="text.secondary">
                Tip: use Rotate on a card to turn it 90°, and Crop to keep just the page area. Crops are applied before rotation.
              </Typography>
            </Stack>
          </ConfigureLayout>
        }
      />

      {/* Hidden inputs: regular image picker and the native camera on mobile. */}
      <input ref={filesInputRef} type="file" multiple accept={IMAGE_ACCEPT} hidden aria-label="Add image files" onChange={onInputChange} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden aria-label="Take a photo with the device camera" onChange={onInputChange} />

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => void workflow.addFiles([file])}
        onFallback={() => {
          setCameraOpen(false);
          openNativeCamera();
        }}
      />

      <ImageCropDialog
        open={Boolean(cropFile)}
        src={cropSrc}
        value={cropFile ? (crops[cropFile.id] ?? null) : null}
        title={cropFile ? `Crop "${cropFile.name}"` : 'Crop image'}
        onClose={() => setCropTarget(null)}
        onApply={(rect) => {
          if (cropFile) setCrops((c) => ({ ...c, [cropFile.id]: rect }));
          setCropTarget(null);
        }}
      />
    </>
  );
}
