import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface ConfigureLayoutProps {
  /** main area: file list, page grid, preview... */
  children: ReactNode;
  /** options panel content */
  options?: ReactNode;
  optionsTitle?: string;
  /** primary action */
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  actionIcon?: ReactNode;
  /** secondary actions rendered next to the primary action */
  secondaryActions?: ReactNode;
  /** summary line above the action (e.g. "3 pages selected") */
  summary?: ReactNode;
  /** back link */
  onBack?: () => void;
  backLabel?: string;
}

/** Space kept above and below the pinned options panel (px). */
const PANEL_GAP = 16;

/**
 * Two-column layout for the "Customize" step: main content + a pinned options panel. On desktop
 * the panel never scrolls away: long options scroll inside it while the primary action stays
 * visible at its bottom. Collapses to a single column with a sticky bottom action bar on mobile.
 */
export default function ConfigureLayout({
  children,
  options,
  optionsTitle = 'Options',
  actionLabel,
  onAction,
  actionDisabled,
  actionIcon,
  secondaryActions,
  summary,
  onBack,
  backLabel = 'Change file',
}: ConfigureLayoutProps) {
  const mobile = useIsMobile();

  const actionBlock = (
    <Stack spacing={1.5}>
      {summary && (
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {summary}
        </Typography>
      )}
      <Button variant="contained" size="large" fullWidth onClick={onAction} disabled={actionDisabled} startIcon={actionIcon} data-testid="primary-action">
        {actionLabel}
      </Button>
      {secondaryActions}
      {onBack && (
        <Button color="inherit" size="small" onClick={onBack}>
          {backLabel}
        </Button>
      )}
    </Stack>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</Box>
      <Box
        component="aside"
        aria-label={optionsTitle}
        sx={{
          width: { xs: '100%', md: 320 },
          flexShrink: 0,
          position: { md: 'sticky' },
          top: { md: PANEL_GAP },
          // Fit the visible content pane: viewport minus the 64px app bar and the gaps.
          maxHeight: { md: `calc(100dvh - ${64 + PANEL_GAP * 2}px)` },
          display: 'flex',
        }}
      >
        <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {options && (
            <Box sx={{ p: 2.5, pb: mobile ? 2.5 : 2, overflowY: { md: 'auto' }, flex: '1 1 auto', minHeight: 0, overscrollBehavior: 'contain' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {optionsTitle}
              </Typography>
              <Stack spacing={2.5}>{options}</Stack>
            </Box>
          )}
          {!mobile && <Box sx={{ p: 2.5, pt: 2, flexShrink: 0, borderTop: options ? 1 : 0, borderColor: 'divider' }}>{actionBlock}</Box>}
        </Paper>
      </Box>
      {mobile && (
        <Paper elevation={8} sx={{ position: 'sticky', bottom: 0, left: 0, right: 0, width: '100%', p: 2, zIndex: 10, borderRadius: '16px 16px 0 0', mx: 0 }}>
          {actionBlock}
        </Paper>
      )}
    </Box>
  );
}
