import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { Suspense } from 'react';
import { createAppStore } from '@/store';
import { addAnnotation, redo, removeAnnotation, selectAnnotation, undo, updateAnnotation, type Annotation } from '@/store/slices/editorSlice';
import {
  annotationBounds,
  arrowHead,
  fitPointsToBounds,
  handlePositions,
  hitHandle,
  hitTest,
  hitTestAll,
  lineEndpointPatch,
  movedPatch,
  normalizeRect,
  resizeRect,
  resizedPatch,
  simplifyPoints,
} from './editorGeometry';
import { commitPatch, geometryOf } from './editorHistory';
import { collectImages, imageStore, storeImage } from './editorImageStore';
import EditPdfTool from './EditPdfTool';

const W = 600;
const H = 800;

/** Round every number in a plain object so float noise does not fail equality checks. */
function near<T>(v: T): T {
  if (typeof v === 'number') return (Math.round(v * 1e9) / 1e9) as T;
  if (Array.isArray(v)) return v.map(near) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, near(x)])) as T;
  return v;
}

function ann(partial: Partial<Annotation> & { type: Annotation['type'] }): Annotation {
  return { id: 'a1', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1, color: '#000', opacity: 1, strokeWidth: 2, ...partial };
}

describe('editorGeometry', () => {
  it('normalizeRect orders corners and clamps to the page', () => {
    expect(near(normalizeRect(0.5, 0.6, 0.1, 0.2))).toEqual({ x: 0.1, y: 0.2, width: 0.4, height: 0.4 });
    const r = normalizeRect(-0.2, 0.5, 1.5, 0.7);
    expect(r.x).toBe(0);
    expect(r.width).toBe(1);
  });

  it('simplifyPoints drops points closer than the threshold but keeps the ends', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.0005, y: 0 }, // 0.3px away
      { x: 0.01, y: 0 }, // 6px away
      { x: 0.0101, y: 0 },
      { x: 0.02, y: 0 },
    ];
    const out = simplifyPoints(pts, W, H, 1);
    expect(out).toEqual([pts[0], pts[2], pts[4]]);
    expect(simplifyPoints([pts[0]], W, H)).toEqual([pts[0]]);
  });

  it('handlePositions returns 8 handles around the rect', () => {
    const hs = handlePositions({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    expect(hs).toHaveLength(8);
    expect(near(hs.find((h) => h.id === 'se'))).toEqual({ id: 'se', x: 0.3, y: 0.3 });
    expect(near(hs.find((h) => h.id === 'n'))).toEqual({ id: 'n', x: 0.2, y: 0.1 });
    expect(hitHandle({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0.3, 0.3, W, H)).toBe('se');
    expect(hitHandle({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0.2, 0.2, W, H)).toBeNull();
  });

  it('hitTest works for boxes, lines and drawings', () => {
    const box = ann({ type: 'rect' });
    expect(hitTest(box, 0.15, 0.15, W, H)).toBe(true);
    expect(hitTest(box, 0.5, 0.5, W, H)).toBe(false);
    const line = ann({ type: 'line', x1: 0, y1: 0, x2: 0.5, y2: 0.5 });
    expect(hitTest(line, 0.25, 0.25, W, H)).toBe(true);
    expect(hitTest(line, 0.25, 0.4, W, H)).toBe(false);
    const draw = ann({ type: 'draw', points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }] });
    expect(hitTest(draw, 0.2, 0.5, W, H)).toBe(true);
    expect(hitTest(draw, 0.2, 0.6, W, H)).toBe(false);
    // topmost wins
    const top = ann({ id: 'top', type: 'ellipse' });
    expect(hitTestAll([box, top], 0.15, 0.15, W, H)?.id).toBe('top');
    expect(hitTestAll([box, top], 0.9, 0.9, W, H)).toBeNull();
  });

  it('annotationBounds covers drawings and lines', () => {
    expect(near(annotationBounds(ann({ type: 'draw', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }] })))).toEqual({ x: 0.2, y: 0.1, width: 0.4, height: 0.2 });
    expect(near(annotationBounds(ann({ type: 'arrow', x1: 0.5, y1: 0.5, x2: 0.1, y2: 0.2 })))).toEqual({ x: 0.1, y: 0.2, width: 0.4, height: 0.3 });
  });

  it('resizeRect keeps a minimum size and stays on the page', () => {
    const r = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(near(resizeRect(r, 'se', 0.1, 0.1))).toEqual({ x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
    const collapsed = resizeRect(r, 'w', 0.5, 0);
    expect(collapsed.width).toBeGreaterThan(0);
    const big = resizeRect(r, 'se', 5, 5);
    expect(big.x + big.width).toBe(1);
    expect(big.y + big.height).toBe(1);
  });

  it('movedPatch and resizedPatch transform every annotation type', () => {
    const box = ann({ type: 'rect' });
    expect(near(movedPatch(box, 0.1, 0.2))).toEqual({ x: 0.2, y: 0.3 });
    // cannot leave the page
    const moved = movedPatch(box, 5, 5) as { x: number; y: number };
    expect(moved.x + box.width).toBeLessThanOrEqual(1);
    const line = ann({ type: 'line', x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.2 });
    const lp = movedPatch(line, 0.1, 0.1);
    expect(lp.x1).toBeCloseTo(0.2);
    expect(lp.y2).toBeCloseTo(0.3);
    const draw = ann({ type: 'draw', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }] });
    const dp = movedPatch(draw, 0.1, 0);
    expect(dp.points?.[1].x).toBeCloseTo(0.4);
    const rp = resizedPatch(draw, 'se', 0.2, 0.2);
    expect(rp.points?.[1].x).toBeCloseTo(0.5);
    expect(rp.points?.[1].y).toBeCloseTo(0.5);
    const cb = resizedPatch(ann({ type: 'checkbox', width: 0.05, height: 0.05 }), 'e', 0.05, 0, W / H);
    expect(cb.height).toBeCloseTo((cb.width ?? 0) * (W / H));
  });

  it('fitPointsToBounds and lineEndpointPatch', () => {
    const pts = fitPointsToBounds([{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 });
    expect(near(pts[1])).toEqual({ x: 0.7, y: 0.7 });
    const p = lineEndpointPatch(ann({ type: 'arrow', x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }), 'p2', 0.9, 0.05);
    expect(near(p)).toMatchObject({ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.05, x: 0.1, y: 0.05 });
  });

  it('arrowHead returns a triangle at the tip', () => {
    const head = arrowHead(0, 0, 100, 0, 2);
    expect(head[0]).toEqual([100, 0]);
    expect(head[1][0]).toBeLessThan(100);
    expect(head[1][1]).not.toBe(head[2][1]);
  });
});

describe('editorSlice through the store', () => {
  it('adds, updates, undoes and redoes annotations', () => {
    const store = createAppStore();
    store.dispatch(addAnnotation({ type: 'rect', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: '#f00', opacity: 1, strokeWidth: 2 }));
    const id = store.getState().editor.annotations[0].id;
    expect(store.getState().editor.selectedId).toBe(id);
    store.dispatch(updateAnnotation({ id, patch: { x: 0.5 } }));
    expect(store.getState().editor.annotations[0].x).toBe(0.5);
    store.dispatch(undo());
    expect(store.getState().editor.annotations[0].x).toBe(0.1);
    store.dispatch(undo());
    expect(store.getState().editor.annotations).toHaveLength(0);
    store.dispatch(redo());
    expect(store.getState().editor.annotations).toHaveLength(1);
    store.dispatch(redo());
    expect(store.getState().editor.annotations[0].x).toBe(0.5);
    store.dispatch(removeAnnotation(id));
    expect(store.getState().editor.annotations).toHaveLength(0);
    store.dispatch(undo());
    expect(store.getState().editor.annotations).toHaveLength(1);
  });

  it('commitPatch turns a silent drag into one undo step', () => {
    const store = createAppStore();
    store.dispatch(addAnnotation({ type: 'rect', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: '#f00', opacity: 1, strokeWidth: 2 }));
    const a = store.getState().editor.annotations[0];
    const original = geometryOf(a);
    // simulate drag previews
    store.dispatch(updateAnnotation({ id: a.id, patch: { x: 0.2 }, history: false }));
    store.dispatch(updateAnnotation({ id: a.id, patch: { x: 0.3 }, history: false }));
    const before = store.getState().editor.past.length;
    commitPatch(store.dispatch, a.id, original, { x: 0.3 });
    expect(store.getState().editor.annotations[0].x).toBe(0.3);
    expect(store.getState().editor.past.length).toBe(before + 1);
    store.dispatch(undo());
    expect(store.getState().editor.annotations[0].x).toBe(0.1);
  });

  it('selecting an annotation syncs the style panel defaults', () => {
    const store = createAppStore();
    store.dispatch(addAnnotation({ type: 'text', page: 1, x: 0, y: 0, width: 0.2, height: 0.1, color: '#123456', opacity: 0.5, strokeWidth: 1, fontSize: 22, fontFamily: 'Courier', text: 'hi' }));
    store.dispatch(selectAnnotation(null));
    store.dispatch(selectAnnotation(store.getState().editor.annotations[0].id));
    expect(store.getState().editor.style).toMatchObject({ color: '#123456', opacity: 0.5, fontSize: 22, fontFamily: 'Courier' });
  });
});

describe('imageStore', () => {
  it('stores data URLs and collects the referenced ones', () => {
    imageStore.clear();
    const id = storeImage('data:image/png;base64,AAAA');
    expect(imageStore.get(id)).toBe('data:image/png;base64,AAAA');
    expect(collectImages([id, 'missing', undefined])).toEqual({ [id]: 'data:image/png;base64,AAAA' });
  });
});

describe('EditPdfTool', () => {
  it('renders the upload step first', async () => {
    const store = createAppStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Suspense fallback={null}>
            <EditPdfTool />
          </Suspense>
        </MemoryRouter>
      </Provider>,
    );
    expect(await screen.findByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Edit PDF' })).toBeInTheDocument();
    expect(store.getState().tool.step).toBe('upload');
  });
});
