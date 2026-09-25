import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { FileMeta } from '@/types';

/**
 * Metadata of the files the user has added to the current tool. The actual
 * File/Blob objects are kept out of Redux (non-serializable) in `services/fileRegistry`.
 */
export interface FileState {
  files: FileMeta[];
}

const initialState: FileState = { files: [] };

const fileSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    addFiles: (state, action: PayloadAction<FileMeta[]>) => {
      state.files.push(...action.payload);
    },
    removeFile: (state, action: PayloadAction<string>) => {
      state.files = state.files.filter((f) => f.id !== action.payload);
    },
    clearFiles: (state) => {
      state.files = [];
    },
    reorderFiles: (state, action: PayloadAction<{ from: number; to: number }>) => {
      const { from, to } = action.payload;
      if (from === to || from < 0 || to < 0 || from >= state.files.length || to >= state.files.length) return;
      const [moved] = state.files.splice(from, 1);
      state.files.splice(to, 0, moved);
    },
    setFileOrder: (state, action: PayloadAction<string[]>) => {
      const byId = new Map(state.files.map((f) => [f.id, f]));
      const ordered = action.payload.map((id) => byId.get(id)).filter((f): f is FileMeta => Boolean(f));
      // keep any files that weren't in the payload at the end
      const seen = new Set(action.payload);
      state.files = [...ordered, ...state.files.filter((f) => !seen.has(f.id))];
    },
    renameFile: (state, action: PayloadAction<{ id: string; name: string }>) => {
      const f = state.files.find((x) => x.id === action.payload.id);
      if (f) f.name = action.payload.name;
    },
    updateFileMeta: (state, action: PayloadAction<{ id: string; patch: Partial<FileMeta> }>) => {
      const f = state.files.find((x) => x.id === action.payload.id);
      if (f) Object.assign(f, action.payload.patch);
    },
    rotateFile: (state, action: PayloadAction<{ id: string; delta: number }>) => {
      const f = state.files.find((x) => x.id === action.payload.id);
      if (f) f.rotation = (((f.rotation + action.payload.delta) % 360) + 360) % 360;
    },
  },
});

export const {
  addFiles,
  removeFile,
  clearFiles,
  reorderFiles,
  setFileOrder,
  renameFile,
  updateFileMeta,
  rotateFile,
} = fileSlice.actions;
export default fileSlice.reducer;
