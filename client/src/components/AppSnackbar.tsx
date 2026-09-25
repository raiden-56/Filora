import { Alert, Snackbar, Stack } from '@mui/material';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { dismissSnackbar } from '@/store/slices/uiSlice';

/** Global snackbar stack driven by uiSlice. */
export default function AppSnackbar() {
  const items = useAppSelector((s) => s.ui.snackbars);
  const dispatch = useAppDispatch();
  return (
    <Stack spacing={1} sx={{ position: 'fixed', bottom: { xs: 72, sm: 24 }, left: 16, right: 16, zIndex: 1400, alignItems: 'center', pointerEvents: 'none' }}>
      {items.map((s) => (
        <Snackbar
          key={s.id}
          open
          autoHideDuration={s.autoHideMs ?? (s.severity === 'error' ? 8000 : 4000)}
          onClose={(_, reason) => {
            if (reason === 'clickaway') return;
            dispatch(dismissSnackbar(s.id));
          }}
          sx={{ position: 'static', transform: 'none', pointerEvents: 'auto' }}
        >
          <Alert
            severity={s.severity}
            variant="filled"
            onClose={() => dispatch(dismissSnackbar(s.id))}
            sx={{ minWidth: { sm: 320 }, maxWidth: 560, boxShadow: 6 }}
          >
            {s.message}
          </Alert>
        </Snackbar>
      ))}
    </Stack>
  );
}
