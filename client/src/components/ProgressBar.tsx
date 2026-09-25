import { Box, LinearProgress, Typography } from '@mui/material';

export interface ProgressBarProps {
  /** 0-100, or null/undefined for indeterminate */
  value?: number | null;
  label?: string;
  showPercent?: boolean;
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
}

export default function ProgressBar({ value, label, showPercent = true, color = 'primary' }: ProgressBarProps) {
  const determinate = typeof value === 'number';
  return (
    <Box sx={{ width: '100%' }}>
      {(label || (determinate && showPercent)) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          {determinate && showPercent && (
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(value)}%
            </Typography>
          )}
        </Box>
      )}
      <LinearProgress
        variant={determinate ? 'determinate' : 'indeterminate'}
        value={determinate ? value : undefined}
        color={color}
        aria-label={label ?? 'Progress'}
        aria-valuenow={determinate ? Math.round(value) : undefined}
      />
    </Box>
  );
}
