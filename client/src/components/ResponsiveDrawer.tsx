import { Box, Drawer, IconButton, SwipeableDrawer, Typography, useMediaQuery, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { ReactNode } from 'react';

export interface ResponsiveDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  title?: string;
  children: ReactNode;
  /** desktop: side panel width */
  width?: number;
  /** desktop anchor */
  anchor?: 'left' | 'right';
  /** render inline (persistent) on desktop instead of a temporary drawer */
  persistent?: boolean;
}

/**
 * Side panel on desktop, bottom sheet on mobile.
 */
export default function ResponsiveDrawer({ open, onClose, onOpen, title, children, width = 320, anchor = 'right', persistent = false }: ResponsiveDrawerProps) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1.5, pb: 1 }}>
      <Typography variant="h6">{title}</Typography>
      <IconButton aria-label="Close panel" onClick={onClose} size="small">
        <CloseRoundedIcon />
      </IconButton>
    </Box>
  );

  if (mobile) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        onOpen={onOpen ?? (() => undefined)}
        disableSwipeToOpen
        PaperProps={{ sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85vh' } }}
      >
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} aria-hidden />
        {title && header}
        <Box sx={{ overflowY: 'auto', px: 2, pb: 3 }}>{children}</Box>
      </SwipeableDrawer>
    );
  }

  if (persistent) {
    if (!open) return null;
    return (
      <Box
        component="aside"
        sx={{ width, flexShrink: 0, borderLeft: anchor === 'right' ? 1 : 0, borderRight: anchor === 'left' ? 1 : 0, borderColor: 'divider', bgcolor: 'background.paper', overflowY: 'auto' }}
      >
        {title && header}
        <Box sx={{ px: 2, pb: 3 }}>{children}</Box>
      </Box>
    );
  }

  return (
    <Drawer anchor={anchor} open={open} onClose={onClose} PaperProps={{ sx: { width } }}>
      {title && header}
      <Box sx={{ px: 2, pb: 3, overflowY: 'auto' }}>{children}</Box>
    </Drawer>
  );
}
