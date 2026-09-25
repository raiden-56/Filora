import { Box, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, alpha, useTheme } from '@mui/material';
import { NavLink } from 'react-router-dom';
import { CATEGORIES, TOOLS, toolPath } from '@/constants/tools';
import ToolIcon from './ToolIcon';
import type { ToolCategoryId } from '@/types';

export interface ToolSidebarProps {
  /** only show this category */
  category?: ToolCategoryId;
  currentToolId?: string;
}

/** Vertical list of tools (desktop side navigation on tool pages). */
export default function ToolSidebar({ category, currentToolId }: ToolSidebarProps) {
  const theme = useTheme();
  const cats = category ? CATEGORIES.filter((c) => c.id === category) : CATEGORIES;
  return (
    <Box component="nav" aria-label="Tools" sx={{ position: 'sticky', top: 80 }}>
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
