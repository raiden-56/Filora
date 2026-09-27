import { Box, LinearProgress } from '@mui/material';
import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import AppSnackbar from '@/components/AppSnackbar';
import GlobalSearch from '@/components/GlobalSearch';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { hydrateHistory, removeHistoryItem } from '@/store/slices/historySlice';
import { loadHistory, purgeExpired } from '@/services/storage';

export default function AppLayout() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const settings = useAppSelector((s) => s.settings);
  const loaded = useAppSelector((s) => s.history.loaded);
  const mainRef = useRef<HTMLElement>(null);

  // Hydrate My Files and purge expired entries.
  useEffect(() => {
    if (loaded) return;
    (async () => {
      if (settings.autoDeleteFiles && settings.autoDeleteAfterHours > 0) {
        const removed = await purgeExpired(settings.autoDeleteAfterHours * 3600_000);
        removed.forEach((id) => dispatch(removeHistoryItem(id)));
      }
      dispatch(hydrateHistory(await loadHistory()));
    })().catch(() => dispatch(hydrateHistory([])));
  }, [dispatch, loaded, settings.autoDeleteFiles, settings.autoDeleteAfterHours]);

  // Scroll to top on navigation (the page itself never scrolls; <main> does).
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    // App shell: the header stays fixed and only the content below it scrolls.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, overflow: 'hidden' }}>
      <Box component="a" href="#main" sx={{ position: 'absolute', left: -9999, '&:focus': { left: 16, top: 8, zIndex: 2000, bgcolor: 'background.paper', p: 1, borderRadius: 1 } }}>
        Skip to content
      </Box>
      <AppHeader />
      <Box component="main" id="main" ref={mainRef} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <Suspense fallback={<LinearProgress aria-label="Loading page" />}>
          <Outlet />
        </Suspense>
      </Box>
      <AppSnackbar />
      <GlobalSearch />
    </Box>
  );
}
