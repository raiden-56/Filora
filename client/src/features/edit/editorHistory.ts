import type { AppDispatch } from '@/store';
import { updateAnnotation, type Annotation } from '@/store/slices/editorSlice';

/**
 * Commit a change that was previewed with `history: false` (drag, resize, typing) as a
 * single undoable step: restore the original values silently, then apply the final patch
 * with history so that "undo" returns to the state before the interaction started.
 */
export function commitPatch(dispatch: AppDispatch, id: string, original: Partial<Annotation>, final: Partial<Annotation>) {
  dispatch(updateAnnotation({ id, patch: original, history: false }));
  dispatch(updateAnnotation({ id, patch: final, history: true }));
}

/** Pick the geometric fields of an annotation (used to snapshot before a drag). */
export function geometryOf(a: Annotation): Partial<Annotation> {
  return {
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    x1: a.x1,
    y1: a.y1,
    x2: a.x2,
    y2: a.y2,
    points: a.points ? a.points.map((p) => ({ ...p })) : undefined,
  };
}

export const FONT_CSS: Record<NonNullable<Annotation['fontFamily']>, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

export const COLOR_SWATCHES = ['#111827', '#DC2626', '#EA580C', '#FFEB3B', '#16A34A', '#2563EB', '#7C3AED', '#FFFFFF'];

export const HIGHLIGHT_DEFAULT = { color: '#FFEB3B', opacity: 0.35 };
