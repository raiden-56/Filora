import { Box, Button, CircularProgress, Paper, Typography, keyframes } from '@mui/material';
import ProgressBar from './ProgressBar';

const pulse = keyframes`
  0% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.35); opacity: 0.15; }
  100% { transform: scale(1); opacity: 0.6; }
`;

export interface ProcessingIndicatorProps {
  stage: string;
  /** 0-100 or null for indeterminate */
  progress?: number | null;
  onCancel?: () => void;
  hint?: string;
}

export default function ProcessingIndicator({ stage, progress, onCancel, hint }: ProcessingIndicatorProps) {
  return (
    <Paper
      variant="outlined"
      role="status"
      aria-live="polite"
      aria-busy="true"
      sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center', maxWidth: 520, mx: 'auto' }}
    >
      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 3 }}>
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: -8,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            animation: `${pulse} 1.8s ease-in-out infinite`,
          }}
        />
        <CircularProgress
          size={64}
          thickness={4}
          variant={typeof progress === 'number' ? 'determinate' : 'indeterminate'}
          value={typeof progress === 'number' ? progress : undefined}
          sx={{ position: 'relative', bgcolor: 'background.paper', borderRadius: '50%' }}
        />
      </Box>
      <Typography variant="h5" gutterBottom>
        {stage}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {hint ?? 'This usually takes a few seconds. Please keep this tab open.'}
      </Typography>
      <ProgressBar value={progress ?? null} showPercent={typeof progress === 'number'} />
      {onCancel && (
        <Button onClick={onCancel} color="inherit" sx={{ mt: 3 }}>
          Cancel
        </Button>
      )}
    </Paper>
  );
}
