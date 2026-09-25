import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  addAnnotation,
  removeAnnotation,
  selectAnnotation,
  setEditorTool,
  updateAnnotation,
  type Annotation,
  type AnnotationType,
  type EditorTool,
  type Point,
} from '@/store/slices/editorSlice';
import {
  annotationBounds,
  arrowHead,
  clamp01,
  handlePositions,
  hitHandle,
  hitTestAll,
  isLineType,
  lineEndpointPatch,
  movedPatch,
  normalizeRect,
  resizedPatch,
  simplifyPoints,
  type HandleId,
  type LineHandleId,
} from './editorGeometry';
import { commitPatch, FONT_CSS, geometryOf } from './editorHistory';
import { imageStore, storeImage } from './editorImageStore';
import type { PickedImage } from './editorImageDialog';

const DEFAULT_TEXT = 'Type here';
const CHECKBOX_PT = 16;

export interface EditorPageOverlayProps {
  page: number;
  widthPx: number;
  heightPx: number;
  scale: number;
  /** image/signature waiting to be placed on the page */
  pendingImage: PickedImage | null;
  onImagePlaced: () => void;
  /** open the image/signature dialog (image tool active but nothing picked yet) */
  onRequestImage: (kind: 'image' | 'signature') => void;
  /** whiteout variant of the rectangle tool */
  whiteout: boolean;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
}

type Draft =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'draw'; points: Point[] }
  | null;

interface DragState {
  mode: 'move' | 'resize' | 'endpoint' | 'draft' | 'place';
  id?: string;
  handle?: HandleId | LineHandleId;
  startFx: number;
  startFy: number;
  original?: Annotation;
  lastPatch?: Partial<Annotation>;
  moved: boolean;
}

const HANDLE_CURSOR: Record<HandleId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function toolCursor(tool: EditorTool): string {
  switch (tool) {
    case 'select':
      return 'default';
    case 'text':
      return 'text';
    case 'erase':
      return 'pointer';
    default:
      return 'crosshair';
  }
}

/**
 * Interactive SVG overlay for one page: renders the page's annotations and handles the
 * pointer interactions of the active tool. Everything is stored as page fractions.
 */
export default function EditorPageOverlay({ page, widthPx, heightPx, scale, pendingImage, onImagePlaced, onRequestImage, whiteout, editingId, onEditingChange }: EditorPageOverlayProps) {
  const dispatch = useAppDispatch();
  const tool = useAppSelector((s) => s.editor.tool);
  const style = useAppSelector((s) => s.editor.style);
  const selectedId = useAppSelector((s) => s.editor.selectedId);
  const all = useAppSelector((s) => s.editor.annotations);
  const annotations = all.filter((a) => a.page === page);
  const selected = annotations.find((a) => a.id === selectedId);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);

  const ptW = useCallback((pt: number) => (pt * scale) / widthPx, [scale, widthPx]);
  const ptH = useCallback((pt: number) => (pt * scale) / heightPx, [scale, heightPx]);
  const aspect = widthPx / heightPx;

  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { fx: 0, fy: 0 };
    return { fx: clamp01((e.clientX - r.left) / r.width), fy: clamp01((e.clientY - r.top) / r.height) };
  };

  const baseStyle = () => ({ color: style.color, opacity: style.opacity, strokeWidth: style.strokeWidth });

  const placeText = (fx: number, fy: number) => {
    const width = Math.min(0.4, Math.max(0.1, 1 - fx));
    const height = Math.min(1 - fy, ptH(style.fontSize * 1.5));
    const action = addAnnotation({ type: 'text', page, x: fx, y: fy, width, height, ...baseStyle(), text: DEFAULT_TEXT, fontSize: style.fontSize, fontFamily: style.fontFamily });
    dispatch(action);
    dispatch(setEditorTool('select'));
    dispatch(selectAnnotation(action.payload.id));
    onEditingChange(action.payload.id);
  };

  const placeCheckbox = (fx: number, fy: number) => {
    const w = ptW(CHECKBOX_PT);
    const h = ptH(CHECKBOX_PT);
    const action = addAnnotation({ type: 'checkbox', page, x: clamp01(Math.min(fx, 1 - w)), y: clamp01(Math.min(fy, 1 - h)), width: w, height: h, ...baseStyle(), fill: style.fill, checked: true });
    dispatch(action);
    dispatch(setEditorTool('select'));
    dispatch(selectAnnotation(action.payload.id));
  };

  const placeImage = (kind: 'image' | 'signature', x: number, y: number, width: number | null) => {
    if (!pendingImage) return;
    const imgAspect = pendingImage.width / Math.max(1, pendingImage.height);
    let w = width ?? 0.3;
    let h = (w * widthPx) / imgAspect / heightPx;
    if (h > 0.9) {
      h = 0.9;
      w = (h * heightPx * imgAspect) / widthPx;
    }
    w = Math.min(w, 1);
    const fx = clamp01(Math.min(x, 1 - w));
    const fy = clamp01(Math.min(y, 1 - h));
    const imageId = storeImage(pendingImage.dataUrl);
    const action = addAnnotation({ type: kind, page, x: fx, y: fy, width: w, height: h, color: style.color, opacity: style.opacity, strokeWidth: 0, imageId });
    dispatch(action);
    onImagePlaced();
    dispatch(setEditorTool('select'));
    dispatch(selectAnnotation(action.payload.id));
  };

  const finishDraft = (d: Draft, fx: number, fy: number) => {
    if (!d) return;
    if (d.kind === 'draw') {
      const points = simplifyPoints(d.points, widthPx, heightPx, 1);
      const b = annotationBounds({ type: 'draw', points } as Annotation);
      dispatch(addAnnotation({ type: 'draw', page, x: b.x, y: b.y, width: b.width, height: b.height, ...baseStyle(), points }));
      return;
    }
    const minPx = 3;
    if (d.kind === 'line') {
      if (Math.hypot((fx - d.x0) * widthPx, (fy - d.y0) * heightPx) < minPx) return;
      const b = normalizeRect(d.x0, d.y0, fx, fy);
      dispatch(addAnnotation({ type: tool as 'line' | 'arrow', page, ...b, ...baseStyle(), x1: d.x0, y1: d.y0, x2: fx, y2: fy }));
      return;
    }
    const r = normalizeRect(d.x0, d.y0, fx, fy);
    if (r.width * widthPx < minPx || r.height * heightPx < minPx) {
      if (tool === 'image' || tool === 'signature') placeImage(tool, d.x0, d.y0, null);
      return;
    }
    if (tool === 'image' || tool === 'signature') {
      placeImage(tool, r.x, r.y, r.width);
      return;
    }
    const type = tool as AnnotationType;
    if (type === 'highlight') {
      dispatch(addAnnotation({ type, page, ...r, color: style.color, opacity: Math.min(style.opacity, 0.6), strokeWidth: 0 }));
    } else if (type === 'rect' && whiteout) {
      dispatch(addAnnotation({ type, page, ...r, color: '#FFFFFF', fill: '#FFFFFF', opacity: 1, strokeWidth: 0 }));
    } else if (type === 'rect' || type === 'ellipse') {
      dispatch(addAnnotation({ type, page, ...r, ...baseStyle(), fill: style.fill }));
    } else {
      dispatch(addAnnotation({ type, page, ...r, ...baseStyle() }));
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (editingId) return; // the textarea handles its own events; blur commits
    const { fx, fy } = toFrac(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    switch (tool) {
      case 'select': {
        if (selected) {
          if (isLineType(selected.type)) {
            const x1 = (selected.x1 ?? selected.x) * widthPx;
            const y1 = (selected.y1 ?? selected.y) * heightPx;
            const x2 = (selected.x2 ?? selected.x + selected.width) * widthPx;
            const y2 = (selected.y2 ?? selected.y + selected.height) * heightPx;
            const px = fx * widthPx;
            const py = fy * heightPx;
            const which: LineHandleId | null = Math.hypot(px - x1, py - y1) <= 10 ? 'p1' : Math.hypot(px - x2, py - y2) <= 10 ? 'p2' : null;
            if (which) {
              drag.current = { mode: 'endpoint', id: selected.id, handle: which, startFx: fx, startFy: fy, original: selected, moved: false };
              return;
            }
          } else {
            const h = hitHandle(annotationBounds(selected), fx, fy, widthPx, heightPx);
            if (h) {
              drag.current = { mode: 'resize', id: selected.id, handle: h, startFx: fx, startFy: fy, original: selected, moved: false };
              return;
            }
          }
        }
        const hit = hitTestAll(annotations, fx, fy, widthPx, heightPx);
        if (hit) {
          if (hit.id !== selectedId) dispatch(selectAnnotation(hit.id));
          drag.current = { mode: 'move', id: hit.id, startFx: fx, startFy: fy, original: hit, moved: false };
        } else if (selectedId) {
          dispatch(selectAnnotation(null));
        }
        return;
      }
      case 'erase': {
        const hit = hitTestAll(annotations, fx, fy, widthPx, heightPx);
        if (hit) dispatch(removeAnnotation(hit.id));
        return;
      }
      case 'text':
        placeText(fx, fy);
        return;
      case 'checkbox':
        placeCheckbox(fx, fy);
        return;
      case 'image':
      case 'signature':
        if (!pendingImage) {
          onRequestImage(tool);
          return;
        }
        drag.current = { mode: 'place', startFx: fx, startFy: fy, moved: false };
        setDraft({ kind: 'rect', x0: fx, y0: fy, x1: fx, y1: fy });
        return;
      case 'draw':
        drag.current = { mode: 'draft', startFx: fx, startFy: fy, moved: false };
        setDraft({ kind: 'draw', points: [{ x: fx, y: fy }] });
        return;
      case 'line':
      case 'arrow':
        drag.current = { mode: 'draft', startFx: fx, startFy: fy, moved: false };
        setDraft({ kind: 'line', x0: fx, y0: fy, x1: fx, y1: fy });
        return;
      default:
        // highlight, underline, strikeout, rect, ellipse
        drag.current = { mode: 'draft', startFx: fx, startFy: fy, moved: false };
        setDraft({ kind: 'rect', x0: fx, y0: fy, x1: fx, y1: fy });
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const { fx, fy } = toFrac(e);
    if (!d) {
      if (tool === 'select') {
        // hover cursor feedback
        let c: string | null = null;
        if (selected && !isLineType(selected.type)) {
          const h = hitHandle(annotationBounds(selected), fx, fy, widthPx, heightPx);
          if (h) c = HANDLE_CURSOR[h];
        }
        if (!c && hitTestAll(annotations, fx, fy, widthPx, heightPx)) c = 'move';
        if (c !== hoverCursor) setHoverCursor(c);
      }
      return;
    }
    const dx = fx - d.startFx;
    const dy = fy - d.startFy;
    if (!d.moved && Math.hypot(dx * widthPx, dy * heightPx) < 2) return;
    d.moved = true;
    switch (d.mode) {
      case 'move':
      case 'resize':
      case 'endpoint': {
        if (!d.original || !d.id) return;
        const patch =
          d.mode === 'move'
            ? movedPatch(d.original, dx, dy)
            : d.mode === 'resize'
              ? resizedPatch(d.original, d.handle as HandleId, dx, dy, aspect)
              : lineEndpointPatch(d.original, d.handle as LineHandleId, fx, fy);
        d.lastPatch = patch;
        dispatch(updateAnnotation({ id: d.id, patch, history: false }));
        return;
      }
      case 'draft':
      case 'place':
        setDraft((prev) => {
          if (!prev) return prev;
          if (prev.kind === 'draw') return { kind: 'draw', points: [...prev.points, { x: fx, y: fy }] };
          return { ...prev, x1: fx, y1: fy };
        });
        return;
    }
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
    if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'endpoint') {
      if (d.original && d.id) {
        if (d.moved && d.lastPatch) commitPatch(dispatch, d.id, geometryOf(d.original), d.lastPatch);
        else if (!d.moved && d.mode === 'move' && d.original.type === 'checkbox') {
          dispatch(updateAnnotation({ id: d.id, patch: { checked: !d.original.checked } }));
        }
      }
      return;
    }
    const current = draft;
    setDraft(null);
    if (d.mode === 'place') {
      if (!d.moved) placeImage(tool as 'image' | 'signature', d.startFx, d.startFy, null);
      else finishDraft(current, fx, fy);
      return;
    }
    if (current?.kind === 'draw') {
      finishDraft(current, fx, fy);
      return;
    }
    if (d.moved) finishDraft(current, fx, fy);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const { fx, fy } = toFrac(e);
    const hit = hitTestAll(annotations, fx, fy, widthPx, heightPx);
    if (hit?.type === 'text') {
      dispatch(selectAnnotation(hit.id));
      onEditingChange(hit.id);
    }
  };

  // Cancel an in-progress draft if the tool changes mid-drag.
  useEffect(() => {
    drag.current = null;
    setDraft(null);
  }, [tool]);

  const editing = editingId ? annotations.find((a) => a.id === editingId) : undefined;
  const cursor = tool === 'select' ? (hoverCursor ?? 'default') : toolCursor(tool);

  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid={`editor-overlay-${page}`}>
      <svg
        ref={svgRef}
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
        role="img"
        aria-label={`Annotation layer for page ${page}${annotations.length ? `, ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}` : ''}`}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor, userSelect: 'none', overflow: 'visible' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g style={{ pointerEvents: 'none' }}>
          {annotations.map((a) => (
            <AnnotationShape key={a.id} a={a} widthPx={widthPx} heightPx={heightPx} scale={scale} hidden={a.id === editingId} />
          ))}
          {draft && <DraftShape draft={draft} tool={tool} widthPx={widthPx} heightPx={heightPx} scale={scale} color={whiteout ? '#9CA3AF' : style.color} strokeWidth={style.strokeWidth} />}
          {selected && !editingId && <SelectionOutline a={selected} widthPx={widthPx} heightPx={heightPx} />}
        </g>
      </svg>
      {editing && (
        <TextEditor
          a={editing}
          widthPx={widthPx}
          heightPx={heightPx}
          scale={scale}
          onDone={() => onEditingChange(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function AnnotationShape({ a, widthPx, heightPx, scale, hidden }: { a: Annotation; widthPx: number; heightPx: number; scale: number; hidden?: boolean }) {
  const x = a.x * widthPx;
  const y = a.y * heightPx;
  const w = a.width * widthPx;
  const h = a.height * heightPx;
  const sw = Math.max(0, a.strokeWidth * scale);
  switch (a.type) {
    case 'text':
      if (hidden) return null;
      return (
        <foreignObject x={x} y={y} width={Math.max(1, w)} height={Math.max(1, h)} style={{ overflow: 'visible' }}>
          <div
            style={{
              fontFamily: FONT_CSS[a.fontFamily ?? 'Helvetica'],
              fontSize: (a.fontSize ?? 14) * scale,
              lineHeight: 1.2,
              color: a.color,
              opacity: a.opacity,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              width: '100%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            {a.text}
          </div>
        </foreignObject>
      );
    case 'image':
    case 'signature': {
      const url = a.imageId ? imageStore.get(a.imageId) : undefined;
      if (!url) return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#9CA3AF" strokeDasharray="4 3" />;
      return <image href={url} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity={a.opacity} />;
    }
    case 'draw': {
      const pts = (a.points ?? []).map((p) => `${p.x * widthPx},${p.y * heightPx}`).join(' ');
      if (a.points?.length === 1) return <circle cx={a.points[0].x * widthPx} cy={a.points[0].y * heightPx} r={Math.max(1, sw / 2)} fill={a.color} opacity={a.opacity} />;
      return <polyline points={pts} fill="none" stroke={a.color} strokeWidth={Math.max(0.5, sw)} strokeLinecap="round" strokeLinejoin="round" opacity={a.opacity} />;
    }
    case 'highlight':
      return <rect x={x} y={y} width={w} height={h} fill={a.color} opacity={a.opacity} style={{ mixBlendMode: 'multiply' }} />;
    case 'underline':
      return <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke={a.color} strokeWidth={Math.max(1, sw)} opacity={a.opacity} />;
    case 'strikeout':
      return <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={a.color} strokeWidth={Math.max(1, sw)} opacity={a.opacity} />;
    case 'rect':
      return <rect x={x} y={y} width={w} height={h} fill={a.fill ?? 'none'} stroke={sw > 0 ? a.color : 'none'} strokeWidth={sw} opacity={a.opacity} />;
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={a.fill ?? 'none'} stroke={sw > 0 ? a.color : 'none'} strokeWidth={sw} opacity={a.opacity} />;
    case 'line':
    case 'arrow': {
      const x1 = (a.x1 ?? a.x) * widthPx;
      const y1 = (a.y1 ?? a.y) * heightPx;
      const x2 = (a.x2 ?? a.x + a.width) * widthPx;
      const y2 = (a.y2 ?? a.y + a.height) * heightPx;
      const thick = Math.max(1, sw);
      if (a.type === 'arrow') {
        const head = arrowHead(x1, y1, x2, y2, thick);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const headLen = Math.max(8, thick * 4) * 0.8;
        return (
          <g opacity={a.opacity}>
            <line x1={x1} y1={y1} x2={x2 - ux * headLen} y2={y2 - uy * headLen} stroke={a.color} strokeWidth={thick} strokeLinecap="round" />
            <polygon points={head.map((p) => p.join(',')).join(' ')} fill={a.color} />
          </g>
        );
      }
      return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.color} strokeWidth={thick} strokeLinecap="round" opacity={a.opacity} />;
    }
    case 'checkbox': {
      const size = Math.min(w, h);
      return (
        <g opacity={a.opacity}>
          <rect x={x} y={y} width={size} height={size} fill={a.fill ?? 'none'} stroke={a.color} strokeWidth={Math.max(1, Math.min(sw, size / 8))} />
          {a.checked && <polyline points={`${x + size * 0.2},${y + size * 0.52} ${x + size * 0.42},${y + size * 0.75} ${x + size * 0.82},${y + size * 0.27}`} fill="none" stroke={a.color} strokeWidth={Math.max(1.5, size / 8)} strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      );
    }
    default:
      return null;
  }
}

function DraftShape({ draft, tool, widthPx, heightPx, scale, color, strokeWidth }: { draft: NonNullable<Draft>; tool: EditorTool; widthPx: number; heightPx: number; scale: number; color: string; strokeWidth: number }) {
  const sw = Math.max(1, strokeWidth * scale);
  if (draft.kind === 'draw') {
    return <polyline points={draft.points.map((p) => `${p.x * widthPx},${p.y * heightPx}`).join(' ')} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />;
  }
  if (draft.kind === 'line') {
    return <line x1={draft.x0 * widthPx} y1={draft.y0 * heightPx} x2={draft.x1 * widthPx} y2={draft.y1 * heightPx} stroke={color} strokeWidth={sw} strokeDasharray="6 4" />;
  }
  const r = normalizeRect(draft.x0, draft.y0, draft.x1, draft.y1);
  const x = r.x * widthPx;
  const y = r.y * heightPx;
  const w = r.width * widthPx;
  const h = r.height * heightPx;
  if (tool === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={color} strokeWidth={sw} strokeDasharray="6 4" />;
  if (tool === 'highlight') return <rect x={x} y={y} width={w} height={h} fill={color} opacity={0.35} />;
  return <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={Math.max(1, sw)} strokeDasharray="6 4" />;
}

function SelectionOutline({ a, widthPx, heightPx }: { a: Annotation; widthPx: number; heightPx: number }) {
  if (isLineType(a.type)) {
    const pts = [
      [(a.x1 ?? a.x) * widthPx, (a.y1 ?? a.y) * heightPx],
      [(a.x2 ?? a.x + a.width) * widthPx, (a.y2 ?? a.y + a.height) * heightPx],
    ];
    return (
      <g>
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={6} fill="#fff" stroke="#2563EB" strokeWidth={2} />
        ))}
      </g>
    );
  }
  const b = annotationBounds(a);
  const x = b.x * widthPx;
  const y = b.y * heightPx;
  const w = b.width * widthPx;
  const h = b.height * heightPx;
  return (
    <g>
      <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="none" stroke="#2563EB" strokeWidth={1.5} strokeDasharray="5 3" />
      {handlePositions(b).map((hd) => (
        <rect key={hd.id} x={hd.x * widthPx - 5} y={hd.y * heightPx - 5} width={10} height={10} rx={2} fill="#fff" stroke="#2563EB" strokeWidth={1.5} />
      ))}
    </g>
  );
}

function TextEditor({ a, widthPx, heightPx, scale, onDone }: { a: Annotation; widthPx: number; heightPx: number; scale: number; onDone: () => void }) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLTextAreaElement>(null);
  const original = useRef({ text: a.text ?? '', height: a.height });
  const [value, setValue] = useState(a.text ?? '');
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (value === DEFAULT_TEXT) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grow = (el: HTMLTextAreaElement) => {
    const needed = el.scrollHeight / heightPx;
    if (needed > a.height + 0.001) dispatch(updateAnnotation({ id: a.id, patch: { height: Math.min(1 - a.y, needed) }, history: false }));
  };

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const text = value.trim() ? value : '';
    const el = ref.current;
    const height = el ? Math.min(1 - a.y, Math.max(a.height, el.scrollHeight / heightPx)) : a.height;
    if (!text) {
      // Empty text boxes are removed (restore original first so undo works).
      dispatch(updateAnnotation({ id: a.id, patch: original.current, history: false }));
      dispatch(removeAnnotation(a.id));
    } else if (text !== original.current.text || height !== original.current.height) {
      commitPatch(dispatch, a.id, original.current, { text, height });
    }
    onDone();
  };

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        dispatch(updateAnnotation({ id: a.id, patch: { text: e.target.value }, history: false }));
        grow(e.target);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: a.x * widthPx,
        top: a.y * heightPx,
        width: Math.max(40, a.width * widthPx),
        height: Math.max(20, a.height * heightPx),
        fontFamily: FONT_CSS[a.fontFamily ?? 'Helvetica'],
        fontSize: (a.fontSize ?? 14) * scale,
        lineHeight: 1.2,
        color: a.color,
        opacity: a.opacity,
        background: 'rgba(255,255,255,0.85)',
        border: '1.5px solid #2563EB',
        borderRadius: 2,
        padding: 0,
        margin: 0,
        resize: 'none',
        outline: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
