import { Box, Button, Card, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import { memo } from 'react';
import type { OutputFileMeta } from '@/types';
import { formatBytes } from '@/utils/format';
import { fileKindLabel } from '@/utils/file';

export interface DownloadCardProps {
  file: OutputFileMeta;
  onDownload: (id: string) => void;
  onPreview?: (id: string) => void;
  previewUrl?: string;
}

function iconFor(mime: string) {
  if (mime === 'application/pdf') return <PictureAsPdfRoundedIcon />;
  if (mime.startsWith('image/')) return <ImageRoundedIcon />;
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return <DescriptionRoundedIcon />;
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return <TableChartRoundedIcon />;
  if (mime.includes('presentationml')) return <SlideshowRoundedIcon />;
  if (mime === 'application/zip') return <FolderZipRoundedIcon />;
  return <ArticleRoundedIcon />;
}

function DownloadCardInner({ file, onDownload, onPreview, previewUrl }: DownloadCardProps) {
  const theme = useTheme();
  const label = fileKindLabel(file.mimeType, file.name);
  return (
    <Card sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5 }} data-testid="download-card">
      {previewUrl ? (
        <Box
          component="img"
          src={previewUrl}
          alt=""
          sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1.5, bgcolor: 'action.hover', flexShrink: 0 }}
        />
      ) : (
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '14px',
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            color: 'primary.main',
            flexShrink: 0,
          }}
        >
          {iconFor(file.mimeType)}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Tooltip title={file.name} enterDelay={600}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {file.name}
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="text.secondary">
          {label} · {formatBytes(file.size)}
          {file.pageCount ? ` · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : ''}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        {onPreview && (
          <Tooltip title="Preview">
            <IconButton aria-label={`Preview ${file.name}`} onClick={() => onPreview(file.id)}>
              <VisibilityRoundedIcon />
            </IconButton>
          </Tooltip>
        )}
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadRoundedIcon />}
          onClick={() => onDownload(file.id)}
          aria-label={`Download ${file.name}`}
          sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
        >
          Download
        </Button>
        <IconButton aria-label={`Download ${file.name}`} onClick={() => onDownload(file.id)} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
          <DownloadRoundedIcon />
        </IconButton>
      </Box>
    </Card>
  );
}

const DownloadCard = memo(DownloadCardInner);
export default DownloadCard;
