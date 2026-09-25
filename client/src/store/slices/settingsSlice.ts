import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'light' | 'dark' | 'system';
export type CompressionLevel = 'low' | 'medium' | 'high';

export interface SettingsState {
  defaultPageSize: 'A4' | 'A3' | 'Letter' | 'Legal';
  defaultOrientation: 'portrait' | 'landscape' | 'auto';
  defaultLanguage: string;
  compressionLevel: CompressionLevel;
  imageQuality: number; // 10-100
  themeMode: ThemeMode;
  autoDeleteFiles: boolean;
  /** hours to keep files in My Files; 0 = keep until deleted */
  autoDeleteAfterHours: number;
  /** show hints/onboarding */
  showTips: boolean;
}

const STORAGE_KEY = 'pdfly.settings.v1';

export const defaultSettings: SettingsState = {
  defaultPageSize: 'A4',
  defaultOrientation: 'auto',
  defaultLanguage: 'eng',
  compressionLevel: 'medium',
  imageQuality: 85,
  themeMode: 'system',
  autoDeleteFiles: true,
  autoDeleteAfterHours: 24,
  showTips: true,
};

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

export function persistSettings(state: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState: defaultSettings,
  reducers: {
    hydrateSettings: (_state, action: PayloadAction<SettingsState>) => action.payload,
    updateSettings: (state, action: PayloadAction<Partial<SettingsState>>) => {
      Object.assign(state, action.payload);
    },
    setThemeMode: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
    },
    resetSettings: () => defaultSettings,
  },
});

export const { hydrateSettings, updateSettings, setThemeMode, resetSettings } = settingsSlice.actions;
export default settingsSlice.reducer;
