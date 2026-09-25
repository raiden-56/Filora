import { useRef, useState } from 'react';
import { clamp01, moveRect, normalizeRect } from './editorGeometry';
import { defaultSize, type DraftField, type PaletteKind } from './formsTypes';

export interface FormsAddOverlayProps {
  page: number;
  widthPx: number;
  heightPx: number;
  scale: number;
  fields: DraftField[];
  activeKind: PaletteKind | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPlace: (kind: PaletteKind, page: number, rect: DraftField['rect']) => void;
  onMove: (id: string, rect: DraftField['rect']) => void;
}

const KIND_LABEL: Record<PaletteKind, string> = {
  text: 'Text',
  multiline: 'Multiline',
  checkbox: 'Checkbox',
  radio: 'Radio',
  dropdown: 'Dropdown',
  date: 'Date',
  signature: 'Signature',
};

interface Drag {
  mode: 'create' | 'move';
  id?: string;
  startFx: number;
  startFy: number;
  origin?: DraftField['rect'];
  moved: boolean;
}

/**
 * SVG overlay for the "Add fields" mode: drag to draw a new field rectangle, click to
 * select an existing one, drag a selected field to move it.
 */
export default function FormsAddOverlay({ page, widthPx, heightPx, scale, fields, activeKind, selectedId, onSelect, onPlace, onMove }: FormsAddOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pageFields = fields.filter((f) => f.page === page);

  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { fx: 0, fy: 0 };
    return { fx: clamp01((e.clientX - r.left) / r.width), fy: clamp01((e.clientY - r.top) / r.height) };
  };

  const fieldAt = (fx: number, fy: number) => {
    for (let i = pageFields.length - 1; i >= 0; i--) {
      const r = pageFields[i].rect;
      if (fx >= r.x && fx <= r.x + r.width && fy >= r.y && fy <= r.y + r.height) return pageFields[i];
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { fx, fy } = toFrac(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    const hit = fieldAt(fx, fy);
    if (hit && (!activeKind || hit.id === selectedId)) {
      onSelect(hit.id);
      drag.current = { mode: 'move', id: hit.id, startFx: fx, startFy: fy, origin: hit.rect, moved: false };
      return;
    }
    if (activeKind) {
      drag.current = { mode: 'create', startFx: fx, startFy: fy, moved: false };
      setDraft({ x0: fx, y0: fy, x1: fx, y1: fy });
      return;
    }
    onSelect(null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const { fx, fy } = toFrac(e);
    const dx = fx - d.startFx;
    const dy = fy - d.startFy;
    if (!d.moved && Math.hypot(dx * widthPx, dy * heightPx) < 3) return;
    d.moved = true;
    if (d.mode === 'create') setDraft((prev) => (prev ? { ...prev, x1: fx, y1: fy } : prev));
    else if (d.id && d.origin) onMove(d.id, moveRect(d.origin, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d) return;
    const { fx, fy } = toFrac(e);
    if (d.mode === 'create' && activeKind) {
      setDraft(null);
      const r = normalizeRect(d.startFx, d.startFy, fx, fy);
      if (d.moved && r.width * widthPx >= 6 && r.height * heightPx >= 6) {
        onPlace(activeKind, page, r);
      } else {
        const size = defaultSize(activeKind);
        const hFrac = (size.hPt * scale) / heightPx;
        const wFrac = size.wFrac || (size.hPt * scale) / widthPx;
        onPlace(activeKind, page, { x: clamp01(Math.min(d.startFx, 1 - wFrac)), y: clamp01(Math.min(d.startFy, 1 - hFrac)), width: Math.min(wFrac, 1), height: Math.min(hFrac, 1) });
      }
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid={`forms-add-overlay-${page}`}>
      <svg
        ref={svgRef}
        width={widthPx}
        height={heightPx}
        role="img"
        aria-label={`Form field layer for page ${page}, ${pageFields.length} new field${pageFields.length === 1 ? '' : 's'}`}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: activeKind ? 'crosshair' : 'default', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g style={{ pointerEvents: 'none' }}>
          {pageFields.map((f) => {
            const x = f.rect.x * widthPx;
            const y = f.rect.y * heightPx;
            const w = f.rect.width * widthPx;
            const h = f.rect.height * heightPx;
            const selected = f.id === selectedId;
            const rows = f.kind === 'radio' ? Math.max(1, f.options.length) : 1;
            return (
              <g key={f.id}>
                <rect x={x} y={y} width={w} height={h} fill={selected ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.10)'} stroke={selected ? '#1D4ED8' : '#2563EB'} strokeWidth={selected ? 2 : 1} strokeDasharray={f.kind === 'signature' ? '5 3' : undefined} rx={2} />
                {f.kind === 'radio' &&
                  Array.from({ length: rows }, (_, i) => {
                    const rh = h / rows;
                    const r = Math.min(rh, w) / 2 - 2;
                    return <circle key={i} cx={x + Math.min(rh, w) / 2} cy={y + rh * i + rh / 2} r={Math.max(2, r)} fill="none" stroke="#2563EB" />;
                  })}
                {f.kind === 'signature' && f.imageDataUrl && <image href={f.imageDataUrl} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />}
                <text x={x + 3} y={y - 3} fontSize={Math.max(9, 10 * scale)} fill="#1D4ED8" fontFamily="Helvetica, Arial, sans-serif">
                  {f.name || KIND_LABEL[f.kind]}
                </text>
              </g>
            );
          })}
          {draft && (() => {
            const r = normalizeRect(draft.x0, draft.y0, draft.x1, draft.y1);
            return <rect x={r.x * widthPx} y={r.y * heightPx} width={r.width * widthPx} height={r.height * heightPx} fill="rgba(37,99,235,0.12)" stroke="#2563EB" strokeDasharray="6 4" />;
          })()}
        </g>
      </svg>
    </div>
  );
}
