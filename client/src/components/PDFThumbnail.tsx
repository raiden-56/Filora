import { Box, Skeleton, Typography } from '@mui/material';
import BrokenImageRoundedIcon from '@mui/icons-material/BrokenImageRounded';
import { memo } from 'react';
import { useThumbnail } from '@/hooks/useThumbnail';
import type { LoadedPdf } from '@/services/pdfjs';

export interface PDFThumbnailProps {
  /** cache key namespace, usually `${ns}:${fileId}` */
  cacheKey: string;
  loaded: LoadedPdf | null;
  pageNumber: number;
  width?: number;
  /** extra clockwise rotation to preview */
  rotation?: number;
  eager?: boolean;
  alt?: string;
  /** aspect ratio hint (w/h) used for the placeholder */
  aspect?: number;
}

function PDFThumbnailInner({ cacheKey, loaded, pageNumber, width = 160, rotation = 0, eager, alt, aspect = 0.707 }: PDFThumbnailProps) {
  const { ref, url, error } = useThumbnail(cacheKey, loaded, pageNumber, width, rotation, eager);
  return (
    <Box
      ref={ref}
      sx={{
        width: '100%',
        aspectRatio: String(aspect),
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'action.hover',
        borderRadius: 1.5,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {url ? (
        <Box
          component="img"
          src={url}
          alt={alt ?? `Page ${pageNumber}`}
          draggable={false}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', boxShadow: 1, bgcolor: '#fff' }}
        />
      ) : error ? (
        <Box sx={{ textAlign: 'center', color: 'text.disabled', p: 1 }}>
          <BrokenImageRoundedIcon />
          <Typography variant="caption" display="block">
            Preview unavailable
          </Typography>
        </Box>
      ) : (
        <Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0, height: '100%' }} animation="wave" />
      )}
    </Box>
  );
}

const PDFThumbnail = memo(PDFThumbnailInner);
export default PDFThumbnail;
