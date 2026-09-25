import { Box, Button, Container, MenuItem, Select, Slider, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import SettingsBrightnessRoundedIcon from '@mui/icons-material/SettingsBrightnessRounded';
import { useState } from 'react';
import SettingsPanel, { SettingRow } from '@/components/SettingsPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { resetSettings, updateSettings, type ThemeMode } from '@/store/slices/settingsSlice';
import { clearHistory } from '@/store/slices/historySlice';
import { showSnackbar } from '@/store/slices/uiSlice';
import { clearOutputs } from '@/services/storage';
import { OCR_LANGUAGES } from '@/constants/limits';

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const s = useAppSelector((st) => st.settings);
  const [confirmClear, setConfirmClear] = useState(false);
  const set = (patch: Partial<typeof s>) => dispatch(updateSettings(patch));

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 5 } }}>
      <Typography variant="h2" component="h1" sx={{ mb: 0.5 }}>
        Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Preferences are saved in this browser.
      </Typography>

      <SettingsPanel title="General" description="Defaults used when creating new PDFs.">
        <SettingRow
          label="Default page size"
          htmlFor="default-page-size"
          control={
            <Select id="default-page-size" fullWidth value={s.defaultPageSize} onChange={(e) => set({ defaultPageSize: e.target.value as typeof s.defaultPageSize })}>
              {['A4', 'A3', 'Letter', 'Legal'].map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </Select>
          }
        />
        <SettingRow
          label="Default orientation"
          htmlFor="default-orientation"
          control={
            <Select id="default-orientation" fullWidth value={s.defaultOrientation} onChange={(e) => set({ defaultOrientation: e.target.value as typeof s.defaultOrientation })}>
              <MenuItem value="auto">Automatic (match content)</MenuItem>
              <MenuItem value="portrait">Portrait</MenuItem>
              <MenuItem value="landscape">Landscape</MenuItem>
            </Select>
          }
        />
        <SettingRow
          label="Default OCR language"
          htmlFor="default-language"
          control={
            <Select id="default-language" fullWidth value={s.defaultLanguage} onChange={(e) => set({ defaultLanguage: e.target.value })}>
              {OCR_LANGUAGES.map((l) => (
                <MenuItem key={l.code} value={l.code}>
                  {l.name}
                </MenuItem>
              ))}
            </Select>
          }
        />
      </SettingsPanel>

      <SettingsPanel title="Processing" description="Defaults for compression and image conversion.">
        <SettingRow
          label="Compression preference"
          control={
            <ToggleButtonGroup exclusive fullWidth value={s.compressionLevel} onChange={(_, v) => v && set({ compressionLevel: v })} aria-label="Compression level" size="small">
              <ToggleButton value="low">Low</ToggleButton>
              <ToggleButton value="medium">Medium</ToggleButton>
              <ToggleButton value="high">High</ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <SettingRow
          label="Image quality"
          hint="Used when images are embedded or exported (JPG)."
          control={
            <Box sx={{ px: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Slider value={s.imageQuality} min={10} max={100} step={5} onChange={(_, v) => set({ imageQuality: v as number })} aria-label="Image quality" valueLabelDisplay="auto" />
              <Typography variant="body2" sx={{ minWidth: 40, textAlign: 'right' }}>
                {s.imageQuality}%
              </Typography>
            </Box>
          }
        />
      </SettingsPanel>

      <SettingsPanel title="Appearance">
        <SettingRow
          label="Theme"
          control={
            <ToggleButtonGroup exclusive fullWidth value={s.themeMode} onChange={(_, v: ThemeMode | null) => v && set({ themeMode: v })} aria-label="Theme" size="small">
              <ToggleButton value="light" aria-label="Light">
                <LightModeRoundedIcon fontSize="small" sx={{ mr: 0.75 }} /> Light
              </ToggleButton>
              <ToggleButton value="dark" aria-label="Dark">
                <DarkModeRoundedIcon fontSize="small" sx={{ mr: 0.75 }} /> Dark
              </ToggleButton>
              <ToggleButton value="system" aria-label="System">
                <SettingsBrightnessRoundedIcon fontSize="small" sx={{ mr: 0.75 }} /> System
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <SettingRow label="Show tips" hint="Helpful hints on tool pages." control={<Switch checked={s.showTips} onChange={(e) => set({ showTips: e.target.checked })} inputProps={{ 'aria-label': 'Show tips' }} />} />
      </SettingsPanel>

      <SettingsPanel title="Privacy" description="Control how long processed files are kept in this browser.">
        <SettingRow label="Auto-delete processed files" control={<Switch checked={s.autoDeleteFiles} onChange={(e) => set({ autoDeleteFiles: e.target.checked })} inputProps={{ 'aria-label': 'Auto-delete processed files' }} />} />
        <SettingRow
          label="Delete after"
          hint="Hours to keep files in My Files."
          htmlFor="auto-delete-hours"
          control={
            <TextField id="auto-delete-hours" type="number" fullWidth disabled={!s.autoDeleteFiles} value={s.autoDeleteAfterHours} onChange={(e) => set({ autoDeleteAfterHours: Math.max(1, Math.min(720, Number(e.target.value) || 1)) })} slotProps={{ htmlInput: { min: 1, max: 720 } }} />
          }
        />
        <SettingRow label="Clear all stored files now" control={<Button color="error" variant="outlined" fullWidth onClick={() => setConfirmClear(true)}>Clear My Files</Button>} />
      </SettingsPanel>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          color="inherit"
          onClick={() => {
            dispatch(resetSettings());
            dispatch(showSnackbar('Settings reset to defaults.', 'success'));
          }}
        >
          Reset to defaults
        </Button>
      </Box>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all stored files?"
        message="Every file in My Files will be permanently removed from this browser."
        confirmLabel="Clear"
        destructive
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          void clearOutputs().then(() => {
            dispatch(clearHistory());
            dispatch(showSnackbar('My Files cleared.', 'success'));
          });
          setConfirmClear(false);
        }}
      />
    </Container>
  );
}
