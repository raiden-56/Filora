import { Box, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import PDFThumbnail from '@/components/PDFThumbnail';
import { pdfCacheKey, usePdfDocument } from '@/hooks/usePdfDocument';
import { formatBytes } from '@/utils/format';
import type { FileMeta } from '@/types';

export interface PdfSummaryCardProps {
  file: FileMeta;
  /** extra rows rendered under the file details */
  children?: ReactNode;
  /** message shown instead of the page count when the PDF cannot be opened */
  unreadableHint?: string;
}

/**
 * First-page thumbnail + name, size and page count of the uploaded PDF. Used as the main
 * content of the configure step for simple one-file tools.
 */
export default function PdfSummaryCard({ file, children, unreadableHint }: PdfSummaryCardProps) {
  const { loaded, numPages, loading, error } = usePdfDocument(file.id, 'input');

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} data-testid="pdf-summary">
      <Stack direction="row" spacing={2.5} alignItems="flex-start">
        <Box sx={{ width: { xs: 96, sm: 140 }, flexShrink: 0 }}>
          <PDFThumbnail cacheKey={pdfCacheKey('input', file.id)} loaded={loaded} pageNumber={1} width={140} eager alt={`First page of ${file.name}`} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
            {file.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatBytes(file.size)}
            {numPages > 0 && ` · ${numPages} page${numPages === 1 ? '' : 's'}`}
            {loading && !numPages && ' · Reading pages…'}
          </Typography>
          {error && (
            <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
              {unreadableHint ?? error}
            </Typography>
          )}
          {children && <Box sx={{ mt: 1.5 }}>{children}</Box>}
        </Box>
      </Stack>
    </Paper>
  );
}
