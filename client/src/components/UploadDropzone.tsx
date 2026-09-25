import { Box, Button, Typography, alpha, useTheme } from '@mui/material';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import { useDropzone } from 'react-dropzone';
import { useCallback, type ReactNode } from 'react';
import type { AcceptKind } from '@/types';
import { acceptLabel, dropzoneAccept } from '@/utils/file';
import { MAX_FILE_SIZE_MB } from '@/constants/limits';

export interface UploadDropzoneProps {
  accept: AcceptKind[];
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  title?: string;
  buttonLabel?: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
  /** extra buttons (e.g. camera) */
  extraActions?: ReactNode;
  id?: string;
}

/**
 * Consistent drag & drop + browse upload area. Accessible: the whole area is focusable
 * and activatable with keyboard, plus a real button as the non-drag alternative.
 */
export default function UploadDropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  buttonLabel,
  hint,
  compact = false,
  disabled = false,
  extraActions,
  id = 'upload-dropzone',
}: UploadDropzoneProps) {
  const theme = useTheme();
  const onDrop = useCallback(
    (accepted: File[], rejected: { file: File }[]) => {
      // Let the workflow produce friendly errors for rejected files as well.
      const all = [...accepted, ...rejected.map((r) => r.file)];
      if (all.length) void onFiles(all);
    },
    [onFiles],
  );
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    accept: accept.includes('any') ? undefined : dropzoneAccept(accept),
    multiple,
    disabled,
    noClick: true,
    noKeyboard: true,
  });

  const label = accept.includes('any') ? 'JPG, PNG, PDF, DOCX, XLSX, PPTX supported' : `${acceptLabel(accept)} supported`;

  return (
    <Box
      {...getRootProps()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title ?? 'Upload files'}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      sx={{
        position: 'relative',
        border: '2px dashed',
        borderColor: isDragReject ? 'error.main' : isDragActive ? 'primary.main' : 'divider',
        borderRadius: 4,
        p: compact ? { xs: 2.5, sm: 3 } : { xs: 4, sm: 6 },
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        bgcolor: isDragActive ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
        transition: 'border-color 150ms ease, background-color 150ms ease, transform 150ms ease',
        outline: 'none',
        '&:hover': disabled ? undefined : { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) },
        '&:focus-visible': { borderColor: 'primary.main', boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.25)}` },
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input {...getInputProps()} id={id} aria-label="Browse files" data-testid="file-input" />
      <Box
        sx={{
          width: compact ? 48 : 72,
          height: compact ? 48 : 72,
          mx: 'auto',
          mb: compact ? 1.5 : 2.5,
          borderRadius: '22px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          color: 'primary.main',
          transform: isDragActive ? 'scale(1.08)' : 'none',
          transition: 'transform 150ms ease',
          '& svg': { fontSize: compact ? 26 : 36 },
        }}
      >
        <CloudUploadRoundedIcon />
      </Box>
      <Typography variant={compact ? 'h6' : 'h4'} sx={{ mb: 0.5 }}>
        {isDragActive ? 'Drop to upload' : (title ?? 'Drop your files here')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        or
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <Button variant="contained" size={compact ? 'medium' : 'large'} onClick={open} disabled={disabled} sx={{ minWidth: 160 }}>
          {buttonLabel ?? (multiple ? 'Browse Files' : 'Browse File')}
        </Button>
        {extraActions}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
        {hint ?? `${label} · Up to ${MAX_FILE_SIZE_MB} MB per file`}
      </Typography>
    </Box>
  );
}
