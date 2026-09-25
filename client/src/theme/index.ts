import { createTheme, alpha, type PaletteMode, type ThemeOptions } from '@mui/material/styles';

export const BRAND = {
  name: 'PDFly',
  tagline: 'All your PDF tools in one place',
};

const FONT_FAMILY = [
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

declare module '@mui/material/styles' {
  interface Palette {
    surface: { main: string; raised: string; sunken: string; border: string };
  }
  interface PaletteOptions {
    surface?: { main: string; raised: string; sunken: string; border: string };
  }
}

function paletteFor(mode: PaletteMode): ThemeOptions['palette'] {
  if (mode === 'dark') {
    return {
      mode,
      primary: { main: '#818CF8', light: '#A5B4FC', dark: '#6366F1', contrastText: '#0B1020' },
      secondary: { main: '#FB923C', light: '#FDBA74', dark: '#EA580C', contrastText: '#1A0B00' },
      success: { main: '#34D399' },
      warning: { main: '#FBBF24' },
      error: { main: '#F87171' },
      info: { main: '#38BDF8' },
      background: { default: '#0B0F19', paper: '#121829' },
      text: { primary: '#E5E7EB', secondary: '#9CA3AF' },
      divider: 'rgba(148, 163, 184, 0.16)',
      surface: { main: '#121829', raised: '#1A2238', sunken: '#0B0F19', border: 'rgba(148,163,184,0.16)' },
    };
  }
  return {
    mode,
    primary: { main: '#4F46E5', light: '#6366F1', dark: '#4338CA', contrastText: '#FFFFFF' },
    secondary: { main: '#EA580C', light: '#F97316', dark: '#C2410C', contrastText: '#FFFFFF' },
    success: { main: '#059669' },
    warning: { main: '#D97706' },
    error: { main: '#DC2626' },
    info: { main: '#0284C7' },
    background: { default: '#F7F8FB', paper: '#FFFFFF' },
    text: { primary: '#111827', secondary: '#4B5563' },
    divider: 'rgba(17, 24, 39, 0.08)',
    surface: { main: '#FFFFFF', raised: '#FFFFFF', sunken: '#F1F3F8', border: 'rgba(17,24,39,0.08)' },
  };
}

export function createAppTheme(mode: PaletteMode) {
  const base = createTheme({ palette: paletteFor(mode) });
  const isDark = mode === 'dark';
  return createTheme(base, {
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY,
      h1: { fontWeight: 800, fontSize: '2.75rem', letterSpacing: '-0.03em', lineHeight: 1.1 },
      h2: { fontWeight: 800, fontSize: '2.125rem', letterSpacing: '-0.025em', lineHeight: 1.15 },
      h3: { fontWeight: 700, fontSize: '1.625rem', letterSpacing: '-0.02em', lineHeight: 1.2 },
      h4: { fontWeight: 700, fontSize: '1.375rem', letterSpacing: '-0.015em' },
      h5: { fontWeight: 700, fontSize: '1.125rem' },
      h6: { fontWeight: 600, fontSize: '1rem' },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 600, fontSize: '0.8125rem', letterSpacing: '0.02em' },
      body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
      body2: { fontSize: '0.875rem', lineHeight: 1.55 },
      button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
      caption: { fontSize: '0.75rem' },
      overline: { fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.6875rem' },
    },
    shadows: [
      'none',
      isDark ? '0 1px 2px rgba(0,0,0,0.5)' : '0 1px 2px rgba(17,24,39,0.05)',
      isDark ? '0 2px 6px rgba(0,0,0,0.5)' : '0 2px 6px rgba(17,24,39,0.06)',
      isDark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(17,24,39,0.07)',
      isDark ? '0 6px 16px rgba(0,0,0,0.55)' : '0 6px 16px rgba(17,24,39,0.08)',
      isDark ? '0 8px 24px rgba(0,0,0,0.55)' : '0 8px 24px rgba(17,24,39,0.09)',
      isDark ? '0 10px 28px rgba(0,0,0,0.6)' : '0 10px 28px rgba(17,24,39,0.1)',
      isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(17,24,39,0.11)',
      isDark ? '0 14px 36px rgba(0,0,0,0.6)' : '0 14px 36px rgba(17,24,39,0.12)',
      ...Array.from({ length: 16 }, (_, i) =>
        isDark
          ? `0 ${16 + i * 2}px ${40 + i * 3}px rgba(0,0,0,0.62)`
          : `0 ${16 + i * 2}px ${40 + i * 3}px rgba(17,24,39,${0.12 + i * 0.005})`,
      ),
    ] as unknown as ThemeOptions['shadows'],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: base.palette.background.default,
            scrollbarColor: isDark ? '#334155 #0B0F19' : '#CBD5E1 #F7F8FB',
          },
          '*:focus-visible': {
            outline: `3px solid ${alpha(base.palette.primary.main, 0.5)}`,
            outlineOffset: 2,
            borderRadius: 4,
          },
          '@media (prefers-reduced-motion: reduce)': {
            '*': { animationDuration: '0.001ms !important', transitionDuration: '0.001ms !important' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            paddingInline: 18,
            minHeight: 40,
            transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease',
            '&:active': { transform: 'scale(0.98)' },
          },
          sizeLarge: { minHeight: 48, fontSize: '1rem', paddingInline: 24 },
          sizeSmall: { minHeight: 32 },
          containedPrimary: {
            boxShadow: `0 4px 14px ${alpha(base.palette.primary.main, 0.35)}`,
            '&:hover': { boxShadow: `0 6px 18px ${alpha(base.palette.primary.main, 0.45)}` },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 16 },
          outlined: { borderColor: base.palette.divider },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: 16,
            border: `1px solid ${base.palette.divider}`,
            backgroundColor: base.palette.background.paper,
          },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 20 } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 10, backgroundColor: isDark ? alpha('#000', 0.15) : '#fff' },
        },
      },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 500 } } },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: { tooltip: { borderRadius: 8, fontSize: '0.75rem' } },
      },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 8, height: 8 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: 10 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(base.palette.background.paper, 0.8),
            backdropFilter: 'blur(12px)',
            color: base.palette.text.primary,
            boxShadow: 'none',
            borderBottom: `1px solid ${base.palette.divider}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: { paper: { backgroundImage: 'none' } },
      },
      MuiSkeleton: { styleOverrides: { root: { borderRadius: 8 } } },
    },
  });
}

export type AppTheme = ReturnType<typeof createAppTheme>;
