import { Alert, AlertTitle, Box, Button, Collapse, Typography } from '@mui/material';
import { useState } from 'react';
import type { AppError } from '@/types';

export interface ErrorStateProps {
  error: AppError | string;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
}

export default function ErrorState({ error, title = 'Something went wrong', onRetry, onDismiss, retryLabel = 'Try again' }: ErrorStateProps) {
  const [showDetails, setShowDetails] = useState(false);
  const message = typeof error === 'string' ? error : error.message;
  const details = typeof error === 'string' ? undefined : error.details;
  return (
    <Alert
      severity="error"
      role="alert"
      onClose={onDismiss}
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
      sx={{ alignItems: 'center' }}
    >
      <AlertTitle>{title}</AlertTitle>
      <Typography variant="body2">{message}</Typography>
      {details && (
        <Box sx={{ mt: 0.5 }}>
          <Button size="small" color="inherit" onClick={() => setShowDetails((s) => !s)} sx={{ px: 0.5, minHeight: 28 }}>
            {showDetails ? 'Hide details' : 'Show details'}
          </Button>
          <Collapse in={showDetails}>
            <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, opacity: 0.85 }}>
              {details}
            </Typography>
          </Collapse>
        </Box>
      )}
    </Alert>
  );
}
