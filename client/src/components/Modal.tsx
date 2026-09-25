import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton, useMediaQuery, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  /** full screen on phones (default true) and always if `fullScreen` */
  fullScreen?: boolean;
  disablePadding?: boolean;
  id?: string;
}

/** Accessible dialog wrapper with a close button. Becomes full screen on phones. */
export default function Modal({ open, onClose, title, children, actions, maxWidth = 'md', fullScreen, disablePadding, id = 'modal' }: ModalProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      fullScreen={fullScreen ?? phone}
      aria-labelledby={title ? `${id}-title` : undefined}
      PaperProps={{ sx: { borderRadius: phone || fullScreen ? 0 : '20px', position: 'relative' } }}
    >
      {title && (
        <DialogTitle id={`${id}-title`} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 7 }}>
          {title}
        </DialogTitle>
      )}
      <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 10 }}>
        <CloseRoundedIcon />
      </IconButton>
      <DialogContent sx={{ p: disablePadding ? 0 : undefined, display: 'flex', flexDirection: 'column' }}>{children}</DialogContent>
      {actions && <DialogActions sx={{ px: 3, pb: 2 }}>{actions}</DialogActions>}
    </Dialog>
  );
}
