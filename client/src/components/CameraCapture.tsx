import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import CameraswitchRoundedIcon from '@mui/icons-material/CameraswitchRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';

export interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** called for every captured photo (the dialog stays open so several pages can be scanned) */
  onCapture: (file: File) => void;
  /** offered when the live camera is unavailable (e.g. opens a native file picker) */
  onFallback?: () => void;
  /** JPEG quality of captured photos (0-1) */
  quality?: number;
}

/** True when the browser can show a live camera preview. */
export function hasLiveCamera(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== 'undefined' && window.isSecureContext !== false;
}

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException || (err && typeof err === 'object' && 'name' in err) ? String((err as { name?: string }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access was denied. Allow camera permission in your browser settings, or choose a photo from your device instead.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. You can choose a photo from your device instead.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another application.';
    default:
      return 'The camera could not be started. You can choose a photo from your device instead.';
  }
}

/**
 * Live camera dialog: shows a <video> preview, captures frames as JPEG files and lets the
 * user switch between the front and back camera. Tracks are stopped whenever the dialog closes.
 */
export default function CameraCapture({ open, onClose, onCapture, onFallback, quality = 0.92 }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [multipleCameras, setMultipleCameras] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      setCount(0);
      setError(null);
      return;
    }
    if (!hasLiveCamera()) {
      setError('Live camera preview is not available in this browser. You can choose a photo from your device instead.');
      return;
    }
    let cancelled = false;
    setStarting(true);
    setError(null);
    stop();
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            /* autoplay may be blocked until user interaction; the preview still shows the first frame */
          }
        }
        setReady(true);
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
        } catch {
          /* ignore */
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeCameraError(err));
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) {
          setError('Could not capture the photo. Please try again.');
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        onCapture(new File([blob], `scan-${stamp}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
        setCount((c) => c + 1);
      },
      'image/jpeg',
      quality,
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Take a photo" maxWidth="sm" id="camera-capture" actions={
      <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {count ? `${count} photo${count === 1 ? '' : 's'} captured` : ready ? 'Point the camera at the page' : ''}
        </Typography>
        <Stack direction="row" spacing={1}>
          {error && onFallback && (
            <Button variant="outlined" onClick={onFallback}>
              Choose a photo
            </Button>
          )}
          <Button variant={count ? 'contained' : 'text'} onClick={onClose} startIcon={count ? <DoneRoundedIcon /> : undefined}>
            {count ? 'Done' : 'Cancel'}
          </Button>
        </Stack>
      </Stack>
    }>
      <Stack spacing={2}>
        {error && <Alert severity="warning">{error}</Alert>}
        <Box sx={{ position: 'relative', bgcolor: '#000', borderRadius: 2, overflow: 'hidden', minHeight: 240, display: 'grid', placeItems: 'center' }}>
          <Box
            component="video"
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Camera preview"
            sx={{ width: '100%', maxHeight: '60vh', display: error ? 'none' : 'block', objectFit: 'contain', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
          />
          {starting && !error && <CircularProgress sx={{ position: 'absolute', color: '#fff' }} aria-label="Starting camera" />}
          {flash && <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#fff', opacity: 0.7, pointerEvents: 'none' }} />}
        </Box>
        <Stack direction="row" spacing={1.5} justifyContent="center" alignItems="center">
          {multipleCameras && (
            <Button variant="outlined" startIcon={<CameraswitchRoundedIcon />} onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={!ready || starting} sx={{ minHeight: 44 }}>
              Switch camera
            </Button>
          )}
          <Button variant="contained" size="large" startIcon={<PhotoCameraRoundedIcon />} onClick={capture} disabled={!ready || Boolean(error)} sx={{ minWidth: 160, minHeight: 48 }}>
            Capture
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
