import { Box, Card, IconButton, InputBase, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import { memo, useEffect, useState, type ReactNode } from 'react';
import type { FileMeta } from '@/types';
import { formatBytes } from '@/utils/format';
import { fileKindLabel, isImageMime, isPdfMime } from '@/utils/file';
import { fileRegistry } from '@/services/fileRegistry';
import { usePdfDocument } from '@/hooks/usePdfDocument';
import PDFThumbnail from './PDFThumbnail';

export interface FileCardProps {
  file: FileMeta;
  index?: number;
  onRemove?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onRotate?: (id: string) => void;
  /** drag handle props from dnd-kit */
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  showPreview?: boolean;
  /** custom preview element (overrides automatic preview) */
  preview?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

function ImagePreview({ file }: { file: FileMeta }) {
  const url = fileRegistry.objectUrl(file.id);
  return (
    <Box
      component="img"
      src={url}
      alt={file.name}
      draggable={false}
      sx={{
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        transform: `rotate(${file.rotation}deg)`,
        transition: 'transform 200ms ease',
      }}
    />
  );
}

function PdfPreview({ file }: { file: FileMeta }) {
  const { loaded, error } = usePdfDocument(file.id, 'input');
  if (error) {
    return (
      <Box sx={{ textAlign: 'center', color: 'error.main', p: 1 }}>
        <PictureAsPdfRoundedIcon />
        <Typography variant="caption" display="block">
          Cannot preview
        </Typography>
      </Box>
    );
  }
  return <PDFThumbnail cacheKey={`input:${file.id}`} loaded={loaded} pageNumber={1} width={200} rotation={file.rotation} eager />;
}

function FileCardInner({
  file,
  index,
  onRemove,
  onRename,
  onRotate,
  dragHandleProps,
  isDragging,
  showPreview = true,
  preview,
  selected,
  onClick,
  compact,
}: FileCardProps) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.name);
  useEffect(() => setDraft(file.name), [file.name]);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== file.name) onRename?.(file.id, name);
    setEditing(false);
  };

  const kind = fileKindLabel(file.type, file.name);

  return (
    <Card
      onClick={onClick}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: compact ? 'center' : 'stretch',
        gap: compact ? 1.5 : 0,
        p: compact ? 1 : 1.5,
        cursor: onClick ? 'pointer' : 'default',
        opacity: isDragging ? 0.6 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.25)}` : undefined,
        transition: 'box-shadow 120ms ease, border-color 120ms ease',
        '&:hover .file-actions': { opacity: 1 },
      }}
      data-testid="file-card"
    >
      {file.error && (
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: alpha(theme.palette.error.main, 0.08), pointerEvents: 'none', borderRadius: 'inherit' }} />
      )}
      {showPreview && (
        <Box
          sx={{
            width: compact ? 56 : '100%',
            aspectRatio: compact ? '1' : '0.75',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.hover',
            borderRadius: 1.5,
            overflow: 'hidden',
            mb: compact ? 0 : 1.25,
          }}
        >
          {preview ??
            (isImageMime(file.type) ? (
              <ImagePreview file={file} />
            ) : isPdfMime(file.type) ? (
              <PdfPreview file={file} />
            ) : (
              <InsertDriveFileRoundedIcon sx={{ fontSize: compact ? 28 : 48, color: 'text.disabled' }} />
            ))}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {editing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <InputBase
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setDraft(file.name);
                  setEditing(false);
                }
              }}
              autoFocus
              inputProps={{ 'aria-label': 'File name' }}
              sx={{ fontSize: 14, fontWeight: 600, flex: 1, px: 1, border: 1, borderColor: 'primary.main', borderRadius: 1 }}
            />
            <IconButton size="small" aria-label="Save name" onClick={commit}>
              <CheckRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <Tooltip title={file.name} enterDelay={600}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
              {typeof index === 'number' && <Box component="span" sx={{ color: 'text.secondary', mr: 0.75 }}>{index + 1}.</Box>}
              {file.name}
            </Typography>
          </Tooltip>
        )}
        <Typography variant="caption" color={file.error ? 'error.main' : 'text.secondary'} noWrap display="block">
          {file.error ?? `${kind} · ${formatBytes(file.size)}${file.pageCount ? ` · ${file.pageCount} page${file.pageCount === 1 ? '' : 's'}` : ''}`}
        </Typography>
      </Box>
      <Box
        className="file-actions"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          mt: compact ? 0 : 0.5,
          opacity: { xs: 1, md: 0.75 },
          transition: 'opacity 120ms ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {dragHandleProps && (
          <Tooltip title="Drag to reorder">
            <IconButton size="small" aria-label="Drag to reorder" sx={{ cursor: 'grab', touchAction: 'none' }} {...dragHandleProps}>
              <DragIndicatorRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onRotate && (
          <Tooltip title="Rotate">
            <IconButton size="small" aria-label="Rotate" onClick={() => onRotate(file.id)}>
              <RotateRightRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onRename && !editing && (
          <Tooltip title="Rename">
            <IconButton size="small" aria-label="Rename" onClick={() => setEditing(true)}>
              <EditRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onRemove && (
          <Tooltip title="Remove">
            <IconButton size="small" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)} sx={{ ml: 'auto' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Card>
  );
}

const FileCard = memo(FileCardInner);
export default FileCard;
