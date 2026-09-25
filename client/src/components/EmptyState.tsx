import { Box, Button, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

export default function EmptyState({ icon, title, description, actionLabel, onAction, children }: EmptyStateProps) {
  return (
    <Box
      sx={{
        textAlign: 'center',
        py: { xs: 6, sm: 10 },
        px: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: '24px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'action.hover',
          color: 'text.secondary',
          mb: 1,
          '& svg': { fontSize: 36 },
        }}
      >
        {icon ?? <InboxRoundedIcon />}
      </Box>
      <Typography variant="h5">{title}</Typography>
      {description && (
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction} sx={{ mt: 1 }}>
          {actionLabel}
        </Button>
      )}
      {children}
    </Box>
  );
}
