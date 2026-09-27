import { Box, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, alpha, useTheme } from '@mui/material';
import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { CATEGORIES, TOOLS, toolPath } from '@/constants/tools';
import ToolIcon from './ToolIcon';
import type { ToolCategoryId } from '@/types';

export interface ToolSidebarProps {
  /** only show this category */
  category?: ToolCategoryId;
  currentToolId?: string;
}

/** Distance from the top of the viewport: the 64px app bar plus a 16px gap. */
const STICKY_TOP = 80;

/**
 * Vertical list of tools (desktop side navigation on tool pages). It sticks below the app bar
 * and scrolls on its own, so the page height follows the tool content, not this menu.
 */
export default function ToolSidebar({ category, currentToolId }: ToolSidebarProps) {
  const theme = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const cats = category ? CATEGORIES.filter((c) => c.id === category) : CATEGORIES;

  // Bring the current tool into view inside the menu (without scrolling the page itself).
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.Mui-selected');
    if (!nav || !active) return;
    const top = active.offsetTop - nav.offsetTop;
    if (top < nav.scrollTop || top + active.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = Math.max(0, top - nav.clientHeight / 2 + active.offsetHeight / 2);
    }
  }, [currentToolId]);

  return (
    <Box
      component="nav"
      ref={navRef}
      aria-label="Tools"
      sx={{
        position: 'sticky',
        top: STICKY_TOP,
        maxHeight: `calc(100vh - ${STICKY_TOP + 16}px)`,
        overflowY: 'auto',
        // Scrolling the menu never scrolls the page behind it.
        overscrollBehavior: 'contain',
        pr: 0.5,
        scrollbarWidth: 'thin',
        scrollbarColor: `${alpha(theme.palette.text.primary, 0.2)} transparent`,
        '&::-webkit-scrollbar': { width: 6 },
        '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.text.primary, 0.2), borderRadius: 3 },
      }}
    >
      {cats.map((c) => (
        <List key={c.id} dense subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', fontWeight: 700, color: c.color, lineHeight: '32px' }}>{c.name}</ListSubheader>} sx={{ mb: 1 }}>
          {TOOLS.filter((t) => t.category === c.id).map((t) => (
            <ListItemButton
              key={t.id}
              component={NavLink}
              to={toolPath(t)}
              selected={t.id === currentToolId}
              sx={{ py: 0.75, '&.Mui-selected': { bgcolor: alpha(c.color, 0.12), color: c.color, '& .MuiListItemIcon-root': { color: c.color } } }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: 'text.secondary' }}>
                <ToolIcon name={t.icon} fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t.name} slotProps={{ primary: { fontSize: 14, fontWeight: t.id === currentToolId ? 700 : 500 } }} />
            </ListItemButton>
          ))}
        </List>
      ))}
      <Box sx={{ mt: 1, borderTop: 1, borderColor: theme.palette.divider }} />
    </Box>
  );
}
