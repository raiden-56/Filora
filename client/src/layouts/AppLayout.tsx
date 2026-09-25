import { Box, LinearProgress } from '@mui/material';
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
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

  // Scroll to top on navigation.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Box component="a" href="#main" sx={{ position: 'absolute', left: -9999, '&:focus': { left: 16, top: 8, zIndex: 2000, bgcolor: 'background.paper', p: 1, borderRadius: 1 } }}>
        Skip to content
      </Box>
      <AppHeader />
      <Box component="main" id="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={<LinearProgress aria-label="Loading page" />}>
          <Outlet />
        </Suspense>
      </Box>
      <AppFooter />
      <AppSnackbar />
      <GlobalSearch />
    </Box>
  );
}
