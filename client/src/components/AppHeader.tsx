import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Link as RouterLink, NavLink, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setNavDrawerOpen, setSearchOpen } from '@/store/slices/uiSlice';
import { setThemeMode } from '@/store/slices/settingsSlice';
import { BRAND } from '@/theme';
import { CATEGORIES, categoryPath } from '@/constants/tools';
import ToolIcon from './ToolIcon';
import type { ToolCategoryId } from '@/types';

const CATEGORY_ICONS: Record<ToolCategoryId, string> = {
  organize: 'organize',
  optimize: 'compress',
  'convert-to': 'image',
  'convert-from': 'word',
  edit: 'edit',
  image: 'photo',
};

const NAV = [
  { label: 'Home', to: '/', icon: <HomeRoundedIcon /> },
  { label: 'All PDF Tools', to: '/tools', icon: <GridViewRoundedIcon /> },
  ...CATEGORIES.map((c) => ({ label: c.name, to: categoryPath(c), icon: <ToolIcon name={CATEGORY_ICONS[c.id]} /> })),
  { label: 'My Files', to: '/my-files', icon: <FolderRoundedIcon /> },
  { label: 'Settings', to: '/settings', icon: <SettingsRoundedIcon /> },
];

function Logo() {
  return (
    <Box component={RouterLink} to="/" aria-label={`${BRAND.name} home`} sx={{ display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit' }}>
      <Box component="img" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} sx={{ borderRadius: 2 }} />
      <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
        {BRAND.name}
      </Typography>
    </Box>
  );
}

export default function AppHeader() {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const open = useAppSelector((s) => s.ui.navDrawerOpen);
  const mode = theme.palette.mode;
  const location = useLocation();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const toggleTheme = () => dispatch(setThemeMode(mode === 'dark' ? 'light' : 'dark'));

  return (
    <>
      <AppBar position="sticky" component="header">
        <Container maxWidth="xl" disableGutters sx={{ px: { xs: 1.5, sm: 3 } }}>
          <Toolbar disableGutters sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
            <IconButton edge="start" aria-label="Open navigation menu" onClick={() => dispatch(setNavDrawerOpen(true))} sx={{ display: { lg: 'none' } }}>
              <MenuRoundedIcon />
            </IconButton>
            <Logo />
            <Box component="nav" aria-label="Main" sx={{ display: { xs: 'none', lg: 'flex' }, gap: 0.5, ml: 3 }}>
              {NAV.slice(0, 7).map((item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  color="inherit"
                  sx={{
                    px: 1.5,
                    color: 'text.secondary',
                    '&.active': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08) },
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<SearchRoundedIcon />}
              onClick={() => dispatch(setSearchOpen(true))}
              sx={{ display: { xs: 'none', md: 'inline-flex' }, color: 'text.secondary', borderColor: 'divider', minWidth: 220, justifyContent: 'flex-start' }}
              aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            >
              Search tools
              <Box component="kbd" sx={{ ml: 'auto', fontSize: 11, px: 0.75, py: 0.25, borderRadius: 1, border: 1, borderColor: 'divider', fontFamily: 'inherit' }}>
                {isMac ? '⌘' : 'Ctrl'} K
              </Box>
            </Button>
            <IconButton aria-label="Search tools" onClick={() => dispatch(setSearchOpen(true))} sx={{ display: { md: 'none' } }}>
              <SearchRoundedIcon />
            </IconButton>
            <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
                {mode === 'dark' ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
              </IconButton>
            </Tooltip>
            <Box sx={{ display: { xs: 'none', lg: 'flex' } }}>
              <Tooltip title="My Files">
                <IconButton component={RouterLink} to="/my-files" aria-label="My Files" color={location.pathname === '/my-files' ? 'primary' : 'default'}>
                  <FolderRoundedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Settings">
                <IconButton component={RouterLink} to="/settings" aria-label="Settings" color={location.pathname === '/settings' ? 'primary' : 'default'}>
                  <SettingsRoundedIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Toolbar>
        </Container>
      </AppBar>

      <Drawer open={open} onClose={() => dispatch(setNavDrawerOpen(false))} PaperProps={{ sx: { width: 290 } }} aria-label="Navigation">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
          <Logo />
          <IconButton aria-label="Close navigation" onClick={() => dispatch(setNavDrawerOpen(false))}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <Divider />
        <List sx={{ px: 1 }}>
          {NAV.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.to === '/'}
              onClick={() => dispatch(setNavDrawerOpen(false))}
              sx={{ mb: 0.5, '&.active': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08), '& .MuiListItemIcon-root': { color: 'primary.main' } } }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { fontWeight: 600 } }} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
    </>
  );
}
