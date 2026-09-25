import { Box, Button, MenuItem, Slider, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';

const PEN_COLORS = ['#111827', '#1D4ED8', '#DC2626'];

/** Crop a canvas to the bounding box of its non-transparent pixels. Returns null when empty. */
export function trimCanvas(source: HTMLCanvasElement, padding = 8): HTMLCanvasElement | null {
  const ctx = source.getContext('2d');
  if (!ctx) return null;
  const { width, height } = source;
  if (!width || !height) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return source;
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')?.drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export interface SignaturePadProps {
  /** Called with a PNG data URL when the user confirms. */
  onCommit: (dataUrl: string) => void;
  commitLabel?: string;
  height?: number;
}

/**
 * Freehand signature pad (pointer events, works with mouse, touch and pen). The
 * signature is exported as a trimmed transparent PNG data URL.
 */
export function SignaturePad({ onCommit, commitLabel = 'Use signature', height = 220 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(2.5);
  const [empty, setEmpty] = useState(true);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const colorRef = useRef(color);
  colorRef.current = color;
  const widthRef = useRef(width);
  widthRef.current = width;

  // Size the canvas to its container (HiDPI aware), preserving strokes on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(wrap.clientWidth));
      const snapshot = canvas.width && canvas.height ? canvas.toDataURL() : null;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (snapshot) {
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, w, height);
          img.src = snapshot;
        }
      }
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    return () => ro?.disconnect();
  }, [height]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      ctx.fillStyle = colorRef.current;
      ctx.beginPath();
      ctx.arc(p.x, p.y, widthRef.current / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    setEmpty(false);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = widthRef.current * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    last.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setEmpty(true);
  }, []);

  const commit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const trimmed = trimCanvas(canvas);
    if (!trimmed) return;
    onCommit(trimmed.toDataURL('image/png'));
  };

  return (
    <Stack spacing={1.5}>
      <Box
        ref={wrapRef}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: '#fff', overflow: 'hidden', position: 'relative', backgroundImage: 'linear-gradient(transparent 70%, rgba(0,0,0,0.08) 70%, rgba(0,0,0,0.08) 71%, transparent 71%)' }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Signature drawing area. Draw your signature with the mouse, finger or pen."
          style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {empty && (
          <Typography variant="body2" color="text.disabled" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            Sign here
          </Typography>
        )}
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Stack direction="row" spacing={1} alignItems="center" role="radiogroup" aria-label="Pen color">
          {PEN_COLORS.map((c) => (
            <Box
              key={c}
              component="button"
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Pen color ${c}`}
              onClick={() => setColor(c)}
              sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: c, border: 3, borderColor: color === c ? 'primary.main' : 'transparent', cursor: 'pointer', p: 0, outlineOffset: 2 }}
            />
          ))}
        </Stack>
        <Box sx={{ flex: 1, minWidth: 140, px: 1 }}>
          <Typography variant="caption" id="pen-width-label">
            Pen width
          </Typography>
          <Slider aria-labelledby="pen-width-label" min={1} max={8} step={0.5} value={width} onChange={(_, v) => setWidth(v as number)} size="small" />
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" color="inherit" onClick={clear} disabled={empty}>
            Clear
          </Button>
          <Button variant="contained" onClick={commit} disabled={empty}>
            {commitLabel}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

const SIGNATURE_FONTS = [
  { id: 'cursive', label: 'Cursive', css: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", "Apple Chancery", cursive' },
  { id: 'script', label: 'Script', css: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive' },
  { id: 'serif', label: 'Serif italic', css: 'Georgia, "Times New Roman", serif' },
];

/** Render typed text as a transparent PNG data URL. */
export function renderTypedSignature(text: string, fontCss: string, color: string, italic = false): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const size = 72;
  const font = `${italic ? 'italic ' : ''}${size}px ${fontCss}`;
  ctx.font = font;
  const metrics = ctx.measureText(trimmed);
  canvas.width = Math.ceil(metrics.width + size);
  canvas.height = Math.ceil(size * 1.6);
  const c2 = canvas.getContext('2d');
  if (!c2) return null;
  c2.font = font;
  c2.fillStyle = color;
  c2.textBaseline = 'middle';
  c2.fillText(trimmed, size / 2, canvas.height / 2);
  const trimmedCanvas = trimCanvas(canvas, 6);
  return (trimmedCanvas ?? canvas).toDataURL('image/png');
}

export interface TypedSignatureProps {
  onCommit: (dataUrl: string) => void;
  commitLabel?: string;
}

export function TypedSignature({ onCommit, commitLabel = 'Use signature' }: TypedSignatureProps) {
  const [text, setText] = useState('');
  const [fontId, setFontId] = useState(SIGNATURE_FONTS[0].id);
  const [color, setColor] = useState(PEN_COLORS[0]);
  const font = SIGNATURE_FONTS.find((f) => f.id === fontId) ?? SIGNATURE_FONTS[0];
  return (
    <Stack spacing={2}>
      <TextField label="Your name" value={text} onChange={(e) => setText(e.target.value)} autoFocus fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField select label="Style" value={fontId} onChange={(e) => setFontId(e.target.value)} sx={{ minWidth: 160 }}>
          {SIGNATURE_FONTS.map((f) => (
            <MenuItem key={f.id} value={f.id} sx={{ fontFamily: f.css }}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1} alignItems="center" role="radiogroup" aria-label="Ink color">
          {PEN_COLORS.map((c) => (
            <Box
              key={c}
              component="button"
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Ink color ${c}`}
              onClick={() => setColor(c)}
              sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: c, border: 3, borderColor: color === c ? 'primary.main' : 'transparent', cursor: 'pointer', p: 0 }}
            />
          ))}
        </Stack>
      </Stack>
      <Box aria-label="Signature preview" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: '#fff', minHeight: 96, display: 'grid', placeItems: 'center', px: 2, overflow: 'hidden' }}>
        <Typography sx={{ fontFamily: font.css, fontStyle: fontId === 'serif' ? 'italic' : 'normal', fontSize: 40, color, whiteSpace: 'nowrap' }}>
          {text.trim() || 'Preview'}
        </Typography>
      </Box>
      <Box>
        <Button
          variant="contained"
          disabled={!text.trim()}
          onClick={() => {
            const url = renderTypedSignature(text, font.css, color, fontId === 'serif');
            if (url) onCommit(url);
          }}
        >
          {commitLabel}
        </Button>
      </Box>
    </Stack>
  );
}

export interface SignaturePickerProps {
  onCommit: (dataUrl: string) => void;
  commitLabel?: string;
}

/** Draw / Type tabs producing a PNG data URL. Reused by the editor and the forms tool. */
export function SignaturePicker({ onCommit, commitLabel }: SignaturePickerProps) {
  const [tab, setTab] = useState(0);
  return (
    <Stack spacing={2}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Signature method">
        <Tab label="Draw" id="sig-tab-draw" aria-controls="sig-panel-draw" />
        <Tab label="Type" id="sig-tab-type" aria-controls="sig-panel-type" />
      </Tabs>
      <Box role="tabpanel" id={tab === 0 ? 'sig-panel-draw' : 'sig-panel-type'} aria-labelledby={tab === 0 ? 'sig-tab-draw' : 'sig-tab-type'}>
        {tab === 0 ? <SignaturePad onCommit={onCommit} commitLabel={commitLabel} /> : <TypedSignature onCommit={onCommit} commitLabel={commitLabel} />}
      </Box>
    </Stack>
  );
}
