import { Box, Typography, keyframes } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import type { ReactNode } from 'react';

const pop = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  70% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

export interface SuccessStateProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export default function SuccessState({ title, description, children }: SuccessStateProps) {
  return (
    <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} role="status">
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'success.main',
          color: '#fff',
          animation: `${pop} 400ms cubic-bezier(.2,.9,.3,1.3)`,
          mb: 1,
          '& svg': { fontSize: 36 },
        }}
      >
        <CheckRoundedIcon />
      </Box>
      <Typography variant="h4">{title}</Typography>
      {description && (
        <Typography variant="body1" color="text.secondary">
          {description}
        </Typography>
      )}
      {children}
    </Box>
  );
}
