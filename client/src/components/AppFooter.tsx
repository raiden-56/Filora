import { Box, Container, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BRAND } from '@/theme';
import { CATEGORIES, categoryPath } from '@/constants/tools';

export default function AppFooter() {
  return (
    <Box component="footer" sx={{ mt: 'auto', borderTop: 1, borderColor: 'divider', py: { xs: 3, sm: 4 }, bgcolor: 'background.paper' }}>
      <Container maxWidth="lg">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              {BRAND.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Files are processed in your browser whenever possible and never stored permanently.
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            {CATEGORIES.map((c) => (
              <Link key={c.id} component={RouterLink} to={categoryPath(c)} underline="hover" color="text.secondary" variant="body2">
                {c.name}
              </Link>
            ))}
            <Link component={RouterLink} to="/settings" underline="hover" color="text.secondary" variant="body2">
              Settings
            </Link>
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2 }}>
          © {new Date().getFullYear()} {BRAND.name}. Built with open-source tools.
        </Typography>
      </Container>
    </Box>
  );
}
