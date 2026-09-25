import { Box, Divider, IconButton, Tooltip, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

export interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** insert a divider before this action */
  dividerBefore?: boolean;
  shortcut?: string;
}

export interface ToolbarProps {
  actions: ToolbarAction[];
  /** rendered on the right / end */
  end?: ReactNode;
  sx?: SxProps<Theme>;
  ariaLabel?: string;
  size?: 'small' | 'medium';
}

/**
 * Horizontally scrollable toolbar (touch friendly on mobile). Each action is a
 * labelled icon button, so everything is reachable by keyboard and screen readers.
 */
export default function Toolbar({ actions, end, sx, ariaLabel = 'Toolbar', size = 'medium' }: ToolbarProps) {
  return (
    <Box
      role="toolbar"
      aria-label={ariaLabel}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        WebkitOverflowScrolling: 'touch',
        ...sx,
      }}
    >
      {actions.map((a) => (
        <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {a.dividerBefore && <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />}
          <Tooltip title={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}>
            <span>
              <IconButton
                aria-label={a.label}
                aria-pressed={a.active}
                onClick={a.onClick}
                disabled={a.disabled}
                size={size}
                color={a.active ? 'primary' : 'default'}
                sx={{
                  minWidth: 44,
                  minHeight: 44,
                  bgcolor: a.active ? 'action.selected' : 'transparent',
                }}
              >
                {a.icon}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ))}
      {end && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, pl: 1 }}>{end}</Box>}
    </Box>
  );
}
