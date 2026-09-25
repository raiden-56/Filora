import { Box, Container, LinearProgress, Skeleton } from '@mui/material';
import { Suspense, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { TOOL_BY_SLUG } from '@/constants/tools';
import { TOOL_COMPONENTS } from '@/features/registry';
import NotFoundPage from './NotFoundPage';

function ToolSkeleton() {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LinearProgress aria-label="Loading tool" sx={{ mb: 3 }} />
      <Skeleton width={120} height={24} />
      <Skeleton width="40%" height={48} sx={{ mt: 1 }} />
      <Skeleton width="70%" height={24} />
      <Box sx={{ mt: 4 }}>
        <Skeleton variant="rounded" height={280} />
      </Box>
    </Container>
  );
}

export default function ToolPage() {
  const { slug = '' } = useParams();
  const tool = TOOL_BY_SLUG[slug];
  const Component = tool ? TOOL_COMPONENTS[tool.id] : undefined;

  useEffect(() => {
    document.title = tool ? `${tool.name} · PDFly` : 'PDFly';
    return () => {
      document.title = 'PDFly - All your PDF tools in one place';
    };
  }, [tool]);

  if (!tool || !Component) return <NotFoundPage />;
  return (
    <Suspense fallback={<ToolSkeleton />}>
      <Component key={tool.id} />
    </Suspense>
  );
}
