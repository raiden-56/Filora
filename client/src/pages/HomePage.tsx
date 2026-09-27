import { Box, Button, Chip, Container, Stack, Typography, alpha, useTheme } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import UploadDropzone from '@/components/UploadDropzone';
import ToolCard from '@/components/ToolCard';
import { CATEGORIES, TOOLS, categoryPath, toolPath, toolsInCategory } from '@/constants/tools';
import { BRAND } from '@/theme';
import { extensionOf } from '@/utils/file';
import { pendingFiles } from '@/services/pendingFiles';
import { useAppDispatch } from '@/store/hooks';
import { showSnackbar } from '@/store/slices/uiSlice';

const FEATURED = ['merge', 'compress', 'jpg-to-pdf', 'pdf-to-word', 'split', 'edit'];

/** Pick the most sensible tool for a set of dropped files. */
export function suggestTool(files: File[]): string {
  const exts = files.map((f) => extensionOf(f.name));
  if (exts.every((e) => e === '.heic')) return 'heic-to-jpg';
  if (exts.every((e) => ['.heif', '.hif', '.heic'].includes(e))) return 'heif-to-jpg';
  if (exts.every((e) => ['.jpg', '.jpeg', '.png', '.webp'].includes(e))) return 'jpg-to-pdf';
  if (exts.every((e) => ['.doc', '.docx', '.odt', '.rtf'].includes(e))) return 'word-to-pdf';
  if (exts.every((e) => ['.ppt', '.pptx', '.odp'].includes(e))) return 'powerpoint-to-pdf';
  if (exts.every((e) => ['.xls', '.xlsx', '.ods', '.csv'].includes(e))) return 'excel-to-pdf';
  if (exts.every((e) => ['.html', '.htm'].includes(e))) return 'html-to-pdf';
  if (exts.every((e) => e === '.pdf')) return files.length > 1 ? 'merge-pdf' : 'organize-pdf';
  return 'merge-pdf';
}

export default function HomePage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const onFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const slug = suggestTool(files);
      pendingFiles.set(files);
      dispatch(showSnackbar(`Opening ${TOOLS.find((t) => t.slug === slug)?.name ?? 'tool'} with your file${files.length > 1 ? 's' : ''}…`, 'info', 3000));
      navigate(toolPath(slug));
    },
    [navigate, dispatch],
  );

  return (
    <Box>
      {/* Hero */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          background: `radial-gradient(1200px 500px at 20% -10%, ${alpha(theme.palette.primary.main, 0.18)}, transparent 60%), radial-gradient(900px 400px at 90% 0%, ${alpha(theme.palette.secondary.main, 0.14)}, transparent 60%)`,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 6, sm: 9, md: 11 } }}>
          <Stack spacing={2.5} alignItems="center" textAlign="center" sx={{ mb: { xs: 4, sm: 6 } }}>
            <Chip label="Free · Private · No sign-up" color="primary" variant="outlined" size="small" sx={{ fontWeight: 600 }} />
            <Typography variant="h1" component="h1" sx={{ maxWidth: 760, fontSize: { xs: '2.25rem', sm: '3rem', md: '3.5rem' } }}>
              All your PDF tools in one place
            </Typography>
            <Typography variant="h6" component="p" color="text.secondary" sx={{ maxWidth: 620, fontWeight: 400 }}>
              Merge, split, compress, convert, edit and organize your documents quickly and securely.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              <Button component={RouterLink} to="/tools" variant="contained" size="large" endIcon={<ArrowForwardRoundedIcon />}>
                Choose a PDF Tool
              </Button>
              <Button component={RouterLink} to={toolPath('jpg-to-pdf')} variant="outlined" size="large" color="inherit" sx={{ borderColor: 'divider' }}>
                Convert JPG to PDF
              </Button>
            </Stack>
          </Stack>
          <Box sx={{ maxWidth: 760, mx: 'auto' }}>
            <UploadDropzone accept={['any']} multiple onFiles={onFiles} title="Drop your files here" buttonLabel="Browse Files" hint="JPG, PNG, HEIC, PDF, DOCX, XLSX, PPTX supported · We will pick the right tool for you" id="home-dropzone" />
          </Box>
        </Container>
      </Box>

      {/* Featured */}
      <Container maxWidth="lg" sx={{ py: { xs: 5, sm: 7 } }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2.5 }}>
          <Typography variant="h3" component="h2">
            Most popular tools
          </Typography>
          <Button component={RouterLink} to="/tools" endIcon={<ArrowForwardRoundedIcon />} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            All tools
          </Button>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
          {FEATURED.map((id) => {
            const tool = TOOLS.find((t) => t.id === id)!;
            return <ToolCard key={id} tool={tool} />;
          })}
        </Box>
      </Container>

      {/* Categories */}
      <Box sx={{ bgcolor: 'background.paper', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 5, sm: 7 } }}>
          <Typography variant="h3" component="h2" sx={{ mb: 0.5 }}>
            Browse by category
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Every tool works end-to-end: upload, customize, process, preview and download.
          </Typography>
          <Stack spacing={5}>
            {CATEGORIES.map((c) => (
              <Box key={c.id} component="section" aria-labelledby={`cat-${c.id}`}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Box>
                    <Typography id={`cat-${c.id}`} variant="h4" component="h3" sx={{ color: c.color }}>
                      {c.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {c.description}
                    </Typography>
                  </Box>
                  <Button component={RouterLink} to={categoryPath(c)} size="small" endIcon={<ArrowForwardRoundedIcon />} sx={{ flexShrink: 0 }}>
                    View all
                  </Button>
                </Box>
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' } }}>
                  {toolsInCategory(c.id).map((t) => (
                    <ToolCard key={t.id} tool={t} compact />
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 5, sm: 7 } }}>
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          {[
            { title: 'Private by design', body: 'Every tool runs entirely in your browser. Your files are never uploaded anywhere and stay on your device.' },
            { title: 'Fast and simple', body: 'A clear three-step flow for every tool: upload, customize, download. No account, no watermark, no limits on the number of tasks.' },
            { title: 'Works everywhere', body: `${BRAND.name} is responsive and touch-friendly on phones, tablets and desktops, with full keyboard support.` },
          ].map((f) => (
            <Box key={f.title}>
              <Typography variant="h5" sx={{ mb: 0.75 }}>
                {f.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {f.body}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
