import { Box, Container, Typography, alpha } from '@mui/material';
import ToolCard from '@/components/ToolCard';
import { CATEGORY_BY_ID, toolsInCategory } from '@/constants/tools';
import type { ToolCategoryId } from '@/types';

export default function CategoryPage({ categoryId }: { categoryId: ToolCategoryId }) {
  const category = CATEGORY_BY_ID[categoryId];
  const tools = toolsInCategory(categoryId);
  return (
    <Box>
      <Box sx={{ background: `linear-gradient(180deg, ${alpha(category.color, 0.12)}, transparent)`, borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 4, sm: 6 } }}>
          <Typography variant="overline" sx={{ color: category.color }}>
            Category
          </Typography>
          <Typography variant="h2" component="h1" sx={{ mb: 1 }}>
            {category.name}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 560 }}>
            {category.description}
          </Typography>
        </Container>
      </Box>
      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
