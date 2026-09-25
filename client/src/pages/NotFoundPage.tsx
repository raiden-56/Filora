import { Button, Container } from '@mui/material';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';

export default function NotFoundPage() {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <EmptyState icon={<SearchOffRoundedIcon />} title="Page not found" description="The page you are looking for does not exist or has moved.">
        <Button component={RouterLink} to="/tools" variant="contained" sx={{ mt: 1 }}>
          Browse all tools
        </Button>
      </EmptyState>
    </Container>
  );
}
