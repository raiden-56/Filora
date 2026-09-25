import { Box, Step, StepLabel, Stepper, Typography, useMediaQuery, useTheme } from '@mui/material';
import type { WorkflowStep } from '@/types';

export interface StepIndicatorProps {
  step: WorkflowStep;
  labels?: [string, string, string];
}

const ORDER: WorkflowStep[] = ['upload', 'configure', 'done'];

export default function StepIndicator({ step, labels = ['Upload', 'Customize', 'Download'] }: StepIndicatorProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const active = step === 'processing' ? 1 : ORDER.indexOf(step);
  return (
    <Box sx={{ mb: { xs: 2.5, sm: 4 } }} aria-label="Progress steps">
      <Stepper activeStep={active} alternativeLabel={!compact} sx={{ '& .MuiStepConnector-line': { borderTopWidth: 2 } }}>
        {labels.map((label, i) => (
          <Step key={label} completed={i < active}>
            <StepLabel
              slotProps={{ label: { sx: { fontWeight: 600, mt: compact ? 0 : 0.75 } } }}
              optional={compact ? undefined : <Typography variant="caption" color="text.secondary" component="span">Step {i + 1}</Typography>}
            >
              {compact ? (i === active ? label : '') : label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
