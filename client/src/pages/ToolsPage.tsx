import { Box, Container, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useMemo, useState } from 'react';
import ToolCard from '@/components/ToolCard';
import EmptyState from '@/components/EmptyState';
import { CATEGORIES, searchTools } from '@/constants/tools';
import { useDebounce } from '@/hooks/useDebounce';

export default function ToolsPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 150);
  const results = useMemo(() => searchTools(debounced), [debounced]);
  const ids = useMemo(() => new Set(results.map((t) => t.id)), [results]);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'flex-end' }} justifyContent="space-between" spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h2" component="h1" sx={{ mb: 0.5 }}>
            All PDF Tools
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Everything you need to work with PDFs, organized by task.
          </Typography>
        </Box>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tools…"
          size="small"
          sx={{ minWidth: { md: 300 } }}
          slotProps={{
            htmlInput: { 'aria-label': 'Filter tools' },
            input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> },
          }}
        />
      </Stack>

      {results.length === 0 ? (
        <EmptyState title="No tools found" description={`Nothing matches “${query}”. Try “merge”, “compress” or “jpg”.`} actionLabel="Clear filter" onAction={() => setQuery('')} />
      ) : (
        <Stack spacing={5}>
          {CATEGORIES.map((c) => {
            const tools = results.filter((t) => t.category === c.id && ids.has(t.id));
            if (!tools.length) return null;
            return (
              <Box key={c.id} component="section" aria-labelledby={`tools-${c.id}`}>
                <Typography id={`tools-${c.id}`} variant="overline" sx={{ color: c.color, display: 'block', mb: 1.5 }}>
                  {c.name}
                </Typography>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } }}>
                  {tools.map((t) => (
                    <ToolCard key={t.id} tool={t} />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
