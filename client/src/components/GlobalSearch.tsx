import { Box, Chip, Dialog, InputBase, List, ListItemButton, ListItemIcon, ListItemText, Typography, alpha, useTheme } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setSearchOpen } from '@/store/slices/uiSlice';
import { CATEGORY_BY_ID, searchTools, toolPath } from '@/constants/tools';
import { useDebounce } from '@/hooks/useDebounce';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import ToolIcon from './ToolIcon';

/** Global tool search (Ctrl/Cmd + K). Fully keyboard navigable. */
export default function GlobalSearch() {
  const open = useAppSelector((s) => s.ui.searchOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 120);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => searchTools(debounced).slice(0, 12), [debounced]);

  const close = useCallback(() => dispatch(setSearchOpen(false)), [dispatch]);
  const toggle = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      dispatch(setSearchOpen(!open));
    },
    [dispatch, open],
  );
  useKeyboardShortcut('k', toggle, { ctrlOrMeta: true, allowInInputs: true });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [results]);

  const go = (index: number) => {
    const tool = results[index];
    if (!tool) return;
    close();
    navigate(toolPath(tool));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(active);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Dialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-label="Search tools"
      PaperProps={{ sx: { position: 'absolute', top: { xs: 16, sm: 80 }, m: 2, width: 'calc(100% - 32px)' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <SearchRoundedIcon color="action" />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Search tools, e.g. “jpg”, “compress”, “merge”…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          inputProps={{
            'aria-label': 'Search tools',
            role: 'combobox',
            'aria-expanded': true,
            'aria-controls': 'global-search-results',
            'aria-activedescendant': results[active] ? `search-opt-${results[active].id}` : undefined,
            'aria-autocomplete': 'list',
          }}
          sx={{ fontSize: 16 }}
        />
        <Chip label="Esc" size="small" variant="outlined" sx={{ display: { xs: 'none', sm: 'inline-flex' } }} />
      </Box>
      <List ref={listRef} id="global-search-results" role="listbox" dense sx={{ maxHeight: 420, overflowY: 'auto', py: 1 }}>
        {results.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
            No tools match “{query}”.
          </Typography>
        )}
        {results.map((tool, i) => {
          const cat = CATEGORY_BY_ID[tool.category];
          return (
            <ListItemButton
              key={tool.id}
              id={`search-opt-${tool.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(i)}
              sx={{ mx: 1, borderRadius: 2, '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.1) } }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: cat.color }}>
                <ToolIcon name={tool.icon} />
              </ListItemIcon>
              <ListItemText primary={tool.name} secondary={tool.description} slotProps={{ primary: { fontWeight: 600 }, secondary: { noWrap: true } }} />
              <Chip label={cat.name} size="small" sx={{ ml: 1, display: { xs: 'none', sm: 'inline-flex' } }} />
            </ListItemButton>
          );
        })}
      </List>
    </Dialog>
  );
}
