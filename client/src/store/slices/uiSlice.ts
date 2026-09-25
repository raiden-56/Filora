import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type SnackbarSeverity = 'success' | 'info' | 'warning' | 'error';

export interface SnackbarMessage {
  id: string;
  message: string;
  severity: SnackbarSeverity;
  autoHideMs?: number;
}

export interface UiState {
  navDrawerOpen: boolean;
  searchOpen: boolean;
  snackbars: SnackbarMessage[];
  /** resolved system preference, updated by a media query listener */
  systemPrefersDark: boolean;
  /** true while a server call is in flight */
  serverOnline: boolean | null;
}

const initialState: UiState = {
  navDrawerOpen: false,
  searchOpen: false,
  snackbars: [],
  systemPrefersDark: false,
  serverOnline: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setNavDrawerOpen: (state, action: PayloadAction<boolean>) => {
      state.navDrawerOpen = action.payload;
    },
    toggleNavDrawer: (state) => {
      state.navDrawerOpen = !state.navDrawerOpen;
    },
    setSearchOpen: (state, action: PayloadAction<boolean>) => {
      state.searchOpen = action.payload;
    },
    showSnackbar: {
      reducer: (state, action: PayloadAction<SnackbarMessage>) => {
        state.snackbars.push(action.payload);
        if (state.snackbars.length > 3) state.snackbars.shift();
      },
      prepare: (message: string, severity: SnackbarSeverity = 'info', autoHideMs?: number) => ({
        payload: { id: nanoid(), message, severity, autoHideMs },
      }),
    },
    dismissSnackbar: (state, action: PayloadAction<string>) => {
      state.snackbars = state.snackbars.filter((s) => s.id !== action.payload);
    },
    setSystemPrefersDark: (state, action: PayloadAction<boolean>) => {
      state.systemPrefersDark = action.payload;
    },
    setServerOnline: (state, action: PayloadAction<boolean | null>) => {
      state.serverOnline = action.payload;
    },
  },
});

export const {
  setNavDrawerOpen,
  toggleNavDrawer,
  setSearchOpen,
  showSnackbar,
  dismissSnackbar,
  setSystemPrefersDark,
  setServerOnline,
} = uiSlice.actions;
export default uiSlice.reducer;
