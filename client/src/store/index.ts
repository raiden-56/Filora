import { configureStore, combineReducers } from '@reduxjs/toolkit';
import settingsReducer, { loadSettings, persistSettings } from './slices/settingsSlice';
import uiReducer from './slices/uiSlice';
import fileReducer from './slices/fileSlice';
import toolReducer from './slices/toolSlice';
import historyReducer from './slices/historySlice';
import pdfReducer from './slices/pdfSlice';
import editorReducer from './slices/editorSlice';

export const rootReducer = combineReducers({
  settings: settingsReducer,
  ui: uiReducer,
  files: fileReducer,
  tool: toolReducer,
  history: historyReducer,
  pdf: pdfReducer,
  editor: editorReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function createAppStore(preloadedState?: Partial<RootState>) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as RootState | undefined,
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: false, // annotation history arrays are large; all state is plain data
        immutableCheck: false,
      }),
    devTools: import.meta.env.DEV,
  });

  let lastSettings = store.getState().settings;
  store.subscribe(() => {
    const s = store.getState().settings;
    if (s !== lastSettings) {
      lastSettings = s;
      persistSettings(s);
    }
  });
  return store;
}

export const store = createAppStore({ settings: loadSettings() });

export type AppStore = typeof store;
export type AppDispatch = AppStore['dispatch'];
