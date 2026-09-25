import { Box, Divider, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface SettingsPanelProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** compact variant used inside tool configure steps */
  dense?: boolean;
  action?: ReactNode;
}

/** A titled panel grouping related options. Used on the Settings page and in tool configure steps. */
export default function SettingsPanel({ title, description, children, dense = false, action }: SettingsPanelProps) {
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: dense ? 2 : { xs: 2, sm: 3 }, mb: dense ? 2 : 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: dense ? 1.5 : 2 }}>
        <Box>
          <Typography variant={dense ? 'subtitle1' : 'h5'} sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {!dense && <Divider sx={{ mb: 2.5 }} />}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: dense ? 1.5 : 2.5 }}>{children}</Box>
    </Paper>
  );
}

export function SettingRow({ label, hint, control, htmlFor }: { label: string; hint?: string; control: ReactNode; htmlFor?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: { xs: 1, sm: 3 } }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component={htmlFor ? 'label' : 'div'} htmlFor={htmlFor} variant="subtitle2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" display="block">
            {hint}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, minWidth: { sm: 220 } }}>{control}</Box>
    </Box>
  );
}
