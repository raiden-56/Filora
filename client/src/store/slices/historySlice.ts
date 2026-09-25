import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { HistoryItem } from '@/types';

/**
 * "My Files": metadata of recently processed output files. Blobs live in IndexedDB
 * (see services/storage.ts). This slice is hydrated on app start.
 */
export interface HistoryState {
  items: HistoryItem[];
  loaded: boolean;
}

const initialState: HistoryState = { items: [], loaded: false };

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    hydrateHistory: (state, action: PayloadAction<HistoryItem[]>) => {
      state.items = [...action.payload].sort((a, b) => b.createdAt - a.createdAt);
      state.loaded = true;
    },
    addHistoryItems: (state, action: PayloadAction<HistoryItem[]>) => {
      const ids = new Set(action.payload.map((i) => i.id));
      state.items = [...action.payload, ...state.items.filter((i) => !ids.has(i.id))].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    },
    removeHistoryItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((i) => i.id !== action.payload);
    },
    renameHistoryItem: (state, action: PayloadAction<{ id: string; name: string }>) => {
      const item = state.items.find((i) => i.id === action.payload.id);
      if (item) item.name = action.payload.name;
    },
    clearHistory: (state) => {
      state.items = [];
    },
  },
});

export const { hydrateHistory, addHistoryItems, removeHistoryItem, renameHistoryItem, clearHistory } =
  historySlice.actions;
export default historySlice.reducer;
