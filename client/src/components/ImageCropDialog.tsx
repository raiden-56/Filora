import { Box, Button, Stack, Typography, alpha, useTheme } from '@mui/material';
import CropFreeRoundedIcon from '@mui/icons-material/CropFreeRounded';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Modal from './Modal';

/** Rectangle in fractions (0-1) of the image width/height, origin top-left. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageCropDialogProps {
  open: boolean;
  /** image URL (object URL or data URL) */
  src: string | null;
  /** current crop or null for the full image */
  value: CropRect | null;
  onClose: () => void;
  /** null = crop removed */
  onApply: (rect: CropRect | null) => void;
  title?: string;
}

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const MIN = 0.02;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];
type DragMode = { kind: 'move'; startX: number; startY: number; origin: CropRect } | { kind: 'resize'; handle: Handle; origin: CropRect } | { kind: 'draw'; startX: number; startY: number };

function clampRect(r: CropRect): CropRect {
  const width = Math.min(1, Math.max(MIN, r.width));
  const height = Math.min(1, Math.max(MIN, r.height));
  return { x: Math.min(1 - width, Math.max(0, r.x)), y: Math.min(1 - height, Math.max(0, r.y)), width, height };
}

function isFull(r: CropRect, eps = 0.005) {
  return r.x <= eps && r.y <= eps && r.width >= 1 - eps && r.height >= 1 - eps;
}

function resize(origin: CropRect, handle: Handle, px: number, py: number): CropRect {
  let { x, y, width, height } = origin;
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  if (handle.includes('w')) {
    const nx = Math.min(px, right - MIN);
    x = Math.max(0, nx);
    width = right - x;
  }
  if (handle.includes('e')) width = Math.max(MIN, Math.min(1, px) - origin.x);
  if (handle.includes('n')) {
    const ny = Math.min(py, bottom - MIN);
    y = Math.max(0, ny);
    height = bottom - y;
  }
  if (handle.includes('s')) height = Math.max(MIN, Math.min(1, py) - origin.y);
  return clampRect({ x, y, width, height });
}

const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
};

/**
 * Simple crop tool: drag on the image to draw a rectangle, drag the rectangle to move it and
 * drag the handles to resize. Works with mouse, touch and pen (pointer events) and supports
 * keyboard nudging (arrows move, Shift+arrows resize) when the crop rectangle is focused.
 */
export default function ImageCropDialog({ open, src, value, onClose, onApply, title = 'Crop image' }: ImageCropDialogProps) {
  const theme = useTheme();
  const [rect, setRect] = useState<CropRect>(value ?? FULL);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useEffect(() => {
    if (open) setRect(value ?? FULL);
  }, [open, value]);

  const toFraction = (clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const b = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (clientY - b.top) / b.height)) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, mode: 'draw' | 'move' | Handle) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = toFraction(e.clientX, e.clientY);
    if (mode === 'draw') dragRef.current = { kind: 'draw', startX: p.x, startY: p.y };
    else if (mode === 'move') dragRef.current = { kind: 'move', startX: p.x, startY: p.y, origin: rectRef.current };
    else dragRef.current = { kind: 'resize', handle: mode, origin: rectRef.current };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const p = toFraction(e.clientX, e.clientY);
    if (d.kind === 'draw') {
      const x = Math.min(d.startX, p.x);
      const y = Math.min(d.startY, p.y);
      setRect(clampRect({ x, y, width: Math.abs(p.x - d.startX), height: Math.abs(p.y - d.startY) }));
    } else if (d.kind === 'move') {
      setRect(clampRect({ ...d.origin, x: d.origin.x + (p.x - d.startX), y: d.origin.y + (p.y - d.startY) }));
    } else {
      setRect(resize(d.origin, d.handle, p.x, p.y));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;
    // A simple tap without dragging keeps the current crop.
    if (d.kind === 'draw') {
      const r = rectRef.current;
      if (r.width < MIN * 2 || r.height < MIN * 2) setRect(FULL);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const step = e.altKey ? 0.001 : 0.01;
    const r = rectRef.current;
    let next: CropRect | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = e.shiftKey ? { ...r, width: r.width - step } : { ...r, x: r.x - step };
        break;
      case 'ArrowRight':
        next = e.shiftKey ? { ...r, width: r.width + step } : { ...r, x: r.x + step };
        break;
      case 'ArrowUp':
        next = e.shiftKey ? { ...r, height: r.height - step } : { ...r, y: r.y - step };
        break;
      case 'ArrowDown':
        next = e.shiftKey ? { ...r, height: r.height + step } : { ...r, y: r.y + step };
        break;
      default:
        return;
    }
    e.preventDefault();
    setRect(clampRect(next));
  };

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const full = isFull(rect);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="md"
      id="crop-dialog"
      actions={
        <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {full ? 'Full image (no crop)' : `Crop: ${Math.round(rect.width * 100)}% × ${Math.round(rect.height * 100)}% of the image`}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setRect(FULL)} disabled={full} startIcon={<CropFreeRoundedIcon />}>
              Reset
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={() => onApply(full ? null : clampRect(rect))}>
              Apply
            </Button>
          </Stack>
        </Stack>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Drag on the image to draw the area to keep. Drag the box to move it and the handles to resize. Keyboard: focus the box, arrows move, Shift+arrows resize.
      </Typography>
      <Box sx={{ display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.common.black, 0.06), borderRadius: 2, p: 1, overflow: 'hidden' }}>
        <Box
          sx={{ position: 'relative', display: 'inline-block', lineHeight: 0, touchAction: 'none', userSelect: 'none', maxWidth: '100%' }}
          onPointerDown={(e) => onPointerDown(e, 'draw')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            <Box
              component="img"
              ref={imgRef}
              src={src}
              alt="Image to crop"
              draggable={false}
              sx={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', width: 'auto', height: 'auto', pointerEvents: 'none' }}
            />
          )}
          {/* Dimmed area outside the crop */}
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <Box
              sx={{
                position: 'absolute',
                left: pct(rect.x),
                top: pct(rect.y),
                width: pct(rect.width),
                height: pct(rect.height),
                boxShadow: `0 0 0 9999px ${alpha(theme.palette.common.black, 0.5)}`,
              }}
            />
          </Box>
          {/* Crop rectangle */}
          <Box
            role="group"
            aria-label={`Crop area: left ${Math.round(rect.x * 100)}%, top ${Math.round(rect.y * 100)}%, width ${Math.round(rect.width * 100)}%, height ${Math.round(rect.height * 100)}%`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => onPointerDown(e, 'move')}
            sx={{
              position: 'absolute',
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.width),
              height: pct(rect.height),
              border: `2px solid ${theme.palette.primary.main}`,
              boxSizing: 'border-box',
              cursor: 'move',
              outline: 'none',
              '&:focus-visible': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.5)}` },
              backgroundImage: `linear-gradient(${alpha('#fff', 0.35)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#fff', 0.35)} 1px, transparent 1px)`,
              backgroundSize: '33.33% 33.33%',
            }}
          >
            {HANDLES.map((h) => (
              <Box
                key={h}
                aria-hidden
                onPointerDown={(e) => onPointerDown(e, h)}
                sx={{
                  position: 'absolute',
                  left: HANDLE_POS[h].left,
                  top: HANDLE_POS[h].top,
                  width: 28,
                  height: 28,
                  transform: 'translate(-50%, -50%)',
                  cursor: HANDLE_POS[h].cursor,
                  display: 'grid',
                  placeItems: 'center',
                  '&::after': {
                    content: '""',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    border: '2px solid #fff',
                    boxShadow: 1,
                  },
                }}
              />
            ))}
          </Box>
        </Box>
      </Box>
    </Modal>
  );
}
