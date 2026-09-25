import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type EditorTool =
  | 'select'
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'signature'
  | 'checkbox'
  | 'erase';

export type AnnotationType = Exclude<EditorTool, 'select' | 'erase'>;

export interface Point {
  x: number;
  y: number;
}

/**
 * All coordinates are fractions (0-1) of the page width/height with origin at the
 * top-left of the *visual* page, so that annotations are resolution independent.
 */
export interface Annotation {
  id: string;
  type: AnnotationType;
  page: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  strokeWidth: number; // in page points
  // text
  text?: string;
  fontSize?: number; // page points
  fontFamily?: 'Helvetica' | 'TimesRoman' | 'Courier';
  // image / signature
  imageId?: string;
  // draw (points are fractions of page)
  points?: Point[];
  // line / arrow: start/end as fractions
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // shapes
  fill?: string | null;
  // checkbox
  checked?: boolean;
}

export interface EditorStyle {
  color: string;
  fill: string | null;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
  fontFamily: 'Helvetica' | 'TimesRoman' | 'Courier';
}

export interface EditorState {
  fileId: string | null;
  tool: EditorTool;
  annotations: Annotation[];
  selectedId: string | null;
  past: Annotation[][];
  future: Annotation[][];
  style: EditorStyle;
  currentPage: number;
  zoom: number;
}

const MAX_HISTORY = 60;

const initialState: EditorState = {
  fileId: null,
  tool: 'select',
  annotations: [],
  selectedId: null,
  past: [],
  future: [],
  style: {
    color: '#DC2626',
    fill: null,
    opacity: 1,
    strokeWidth: 2,
    fontSize: 14,
    fontFamily: 'Helvetica',
  },
  currentPage: 1,
  zoom: 1,
};

function pushHistory(state: EditorState) {
  state.past.push(state.annotations.map((a) => ({ ...a })));
  if (state.past.length > MAX_HISTORY) state.past.shift();
  state.future = [];
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    initEditor: (state, action: PayloadAction<{ fileId: string }>) => {
      if (state.fileId === action.payload.fileId) return;
      Object.assign(state, { ...initialState, style: state.style, fileId: action.payload.fileId });
    },
    resetEditor: () => initialState,
    setEditorTool: (state, action: PayloadAction<EditorTool>) => {
      state.tool = action.payload;
      if (action.payload !== 'select') state.selectedId = null;
    },
    setEditorStyle: (state, action: PayloadAction<Partial<EditorStyle>>) => {
      Object.assign(state.style, action.payload);
      // Apply live style changes to the selected annotation too
      if (state.selectedId) {
        const a = state.annotations.find((x) => x.id === state.selectedId);
        if (a) {
          pushHistory(state);
          if (action.payload.color !== undefined) a.color = action.payload.color;
          if (action.payload.fill !== undefined) a.fill = action.payload.fill;
          if (action.payload.opacity !== undefined) a.opacity = action.payload.opacity;
          if (action.payload.strokeWidth !== undefined) a.strokeWidth = action.payload.strokeWidth;
          if (action.payload.fontSize !== undefined) a.fontSize = action.payload.fontSize;
          if (action.payload.fontFamily !== undefined) a.fontFamily = action.payload.fontFamily;
        }
      }
    },
    addAnnotation: {
      reducer: (state, action: PayloadAction<Annotation>) => {
        pushHistory(state);
        state.annotations.push(action.payload);
        state.selectedId = action.payload.id;
      },
      prepare: (annotation: Omit<Annotation, 'id'> & { id?: string }) => ({
        payload: { ...annotation, id: annotation.id ?? nanoid() } as Annotation,
      }),
    },
    updateAnnotation: (
      state,
      action: PayloadAction<{ id: string; patch: Partial<Annotation>; history?: boolean }>,
    ) => {
      const a = state.annotations.find((x) => x.id === action.payload.id);
      if (!a) return;
      if (action.payload.history !== false) pushHistory(state);
      Object.assign(a, action.payload.patch);
    },
    removeAnnotation: (state, action: PayloadAction<string>) => {
      if (!state.annotations.some((a) => a.id === action.payload)) return;
      pushHistory(state);
      state.annotations = state.annotations.filter((a) => a.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    clearPageAnnotations: (state, action: PayloadAction<number>) => {
      pushHistory(state);
      state.annotations = state.annotations.filter((a) => a.page !== action.payload);
      state.selectedId = null;
    },
    selectAnnotation: (state, action: PayloadAction<string | null>) => {
      state.selectedId = action.payload;
      if (action.payload) {
        const a = state.annotations.find((x) => x.id === action.payload);
        if (a) {
          state.style.color = a.color;
          state.style.opacity = a.opacity;
          state.style.strokeWidth = a.strokeWidth;
          if (a.fontSize) state.style.fontSize = a.fontSize;
          if (a.fontFamily) state.style.fontFamily = a.fontFamily;
          state.style.fill = a.fill ?? null;
        }
      }
    },
    bringToFront: (state, action: PayloadAction<string>) => {
      const idx = state.annotations.findIndex((a) => a.id === action.payload);
      if (idx < 0) return;
      pushHistory(state);
      const [a] = state.annotations.splice(idx, 1);
      state.annotations.push(a);
    },
    undo: (state) => {
      const prev = state.past.pop();
      if (!prev) return;
      state.future.push(state.annotations);
      state.annotations = prev;
      state.selectedId = null;
    },
    redo: (state) => {
      const next = state.future.pop();
      if (!next) return;
      state.past.push(state.annotations);
      state.annotations = next;
      state.selectedId = null;
    },
    setEditorPage: (state, action: PayloadAction<number>) => {
      state.currentPage = action.payload;
    },
    setEditorZoom: (state, action: PayloadAction<number>) => {
      state.zoom = Math.min(4, Math.max(0.25, action.payload));
    },
  },
});

export const {
  initEditor,
  resetEditor,
  setEditorTool,
  setEditorStyle,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  clearPageAnnotations,
  selectAnnotation,
  bringToFront,
  undo,
  redo,
  setEditorPage,
  setEditorZoom,
} = editorSlice.actions;
export default editorSlice.reducer;
