import { useMediaQuery, useTheme } from '@mui/material';

/** True below the `md` breakpoint (phones and small tablets). */
export function useIsMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('md'));
}

/** True below the `sm` breakpoint (phones). */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}
