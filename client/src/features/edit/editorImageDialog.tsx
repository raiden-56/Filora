import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { blobToPngDataUrl } from './editorImageStore';
import { SignaturePicker } from './editorSignaturePad';

export interface PickedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface EditorImageDialogProps {
  open: boolean;
  kind: 'image' | 'signature';
  onClose: () => void;
  onPick: (img: PickedImage) => void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Modal used by the Image and Signature tools. Image: pick a PNG/JPG/WEBP (converted to a PNG
 * data URL). Signature: draw or type one. The picked image is then placed on the page by the
 * editor overlay.
 */
export default function EditorImageDialog({ open, kind, onClose, onPick }: EditorImageDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PickedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) {
      setError('Please choose a PNG, JPG or WEBP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('The image is too large (max 8 MB).');
      return;
    }
    setBusy(true);
    try {
      const png = await blobToPngDataUrl(file);
      setPreview(png);
    } catch {
      setError('This image could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const commitSignature = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      onPick({ dataUrl, width: img.naturalWidth || 300, height: img.naturalHeight || 100 });
    };
    img.onerror = () => onPick({ dataUrl, width: 300, height: 100 });
    img.src = dataUrl;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'image' ? 'Insert image' : 'Add signature'}
      maxWidth="sm"
      id="editor-image-dialog"
      actions={
        kind === 'image' ? (
          <>
            <Button color="inherit" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="contained" disabled={!preview} onClick={() => preview && onPick(preview)}>
              Use image
            </Button>
          </>
        ) : undefined
      }
    >
      {kind === 'image' ? (
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Choose an image, then click or drag on the page to place it. You can move and resize it afterwards.
          </Typography>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            aria-label="Choose an image file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void onFile(f);
            }}
          />
          <Box
            role="button"
            tabIndex={0}
            aria-label="Choose an image"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files?.[0]);
            }}
            sx={{ border: 2, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 3, p: 3, textAlign: 'center', cursor: 'pointer', minHeight: 180, display: 'grid', placeItems: 'center', '&:focus-visible': { borderColor: 'primary.main' } }}
          >
            {preview ? (
              <img src={preview.dataUrl} alt="Selected image preview" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} />
            ) : (
              <Stack spacing={1} alignItems="center">
                <ImageRoundedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                <Typography variant="body2">{busy ? 'Reading image...' : 'Click to choose an image or drop one here'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  PNG, JPG or WEBP, up to 8 MB
                </Typography>
              </Stack>
            )}
          </Box>
          {preview && (
            <Button size="small" color="inherit" onClick={() => inputRef.current?.click()} sx={{ alignSelf: 'flex-start' }}>
              Choose a different image
            </Button>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      ) : (
        <Box sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Draw or type your signature, then click on the page where it should go.
          </Typography>
          <SignaturePicker onCommit={commitSignature} />
        </Box>
      )}
    </Modal>
  );
}
