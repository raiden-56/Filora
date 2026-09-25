import { CssBaseline, ThemeProvider } from '@mui/material';
import { useEffect, useMemo } from 'react';
import { RouterProvider } from 'react-router-dom';
import { createAppTheme } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setSystemPrefersDark } from '@/store/slices/uiSlice';
import { router } from '@/routes';

export default function App() {
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((s) => s.settings.themeMode);
  const systemDark = useAppSelector((s) => s.ui.systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    dispatch(setSystemPrefersDark(mq.matches));
    const onChange = (e: MediaQueryListEvent) => dispatch(setSystemPrefersDark(e.matches));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [dispatch]);

  const mode = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.palette.background.paper);
  }, [mode, theme]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
