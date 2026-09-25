import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  InputBase,
  Skeleton,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import WidthFullRoundedIcon from '@mui/icons-material/WidthFullRounded';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ViewSidebarRoundedIcon from '@mui/icons-material/ViewSidebarRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { usePdfDocument, type PdfNamespace } from '@/hooks/usePdfDocument';
import { renderPageToCanvas, type LoadedPdf } from '@/services/pdfjs';
import PDFThumbnail from './PDFThumbnail';
import ErrorState from './ErrorState';
import { useDebounce } from '@/hooks/useDebounce';

export interface PDFViewerProps {
  fileId: string;
  ns?: PdfNamespace;
  blob?: Blob;
  /** initial page */
  initialPage?: number;
  /** hide thumbnails sidebar entirely */
  hideThumbnails?: boolean;
  /** render an overlay over each page (e.g. annotations); receives page number and CSS size */
  renderOverlay?: (page: number, width: number, height: number, scale: number) => React.ReactNode;
  /** called when the visible page changes */
  onPageChange?: (page: number) => void;
  /** external zoom control */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  toolbarExtra?: React.ReactNode;
  /** disable text-search UI */
  hideSearch?: boolean;
}

interface PageDims {
  width: number;
  height: number;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];

/** Renders a single page into a canvas at the given scale (re-renders when scale/rotation changes). */
const PageCanvas = memo(function PageCanvas({
  loaded,
  pageNumber,
  scale,
  rotation,
  onDims,
  highlights,
}: {
  loaded: LoadedPdf;
  pageNumber: number;
  scale: number;
  rotation: number;
  onDims?: (page: number, dims: PageDims) => void;
  highlights?: { x: number; y: number; w: number; h: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let pageProxy: PDFPageProxy | null = null;
    setRendered(false);
    loaded.doc
      .getPage(pageNumber)
      .then(async (page) => {
        pageProxy = page;
        if (cancelled || !canvasRef.current) return;
        const r = await renderPageToCanvas(page, canvasRef.current, { scale, rotation, signal: controller.signal });
        if (!cancelled) {
          setRendered(true);
          onDims?.(pageNumber, { width: r.width, height: r.height });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
      pageProxy?.cleanup();
    };
  }, [loaded, pageNumber, scale, rotation, onDims]);
  return (
    <Box sx={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block', opacity: rendered ? 1 : 0.4, transition: 'opacity 150ms ease' }} aria-label={`Page ${pageNumber}`} role="img" />
      {highlights?.map((h, i) => (
        <Box key={i} sx={{ position: 'absolute', left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, bgcolor: 'rgba(255, 213, 0, 0.45)', pointerEvents: 'none', borderRadius: '2px' }} />
      ))}
    </Box>
  );
});

/**
 * Reusable PDF viewer: virtualized page list, thumbnails, zoom, fit width/page, rotate,
 * page navigation, fullscreen and text search.
 */
export default function PDFViewer({ fileId, ns = 'input', blob, initialPage = 1, hideThumbnails, renderOverlay, onPageChange, zoom: zoomProp, onZoomChange, toolbarExtra, hideSearch }: PDFViewerProps) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const { loaded, numPages, loading, error } = usePdfDocument(fileId, ns, blob);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomState, setZoomState] = useState(1);
  const zoom = zoomProp ?? zoomState;
  const setZoom = useCallback(
    (z: number) => {
      const clamped = Math.min(4, Math.max(0.25, z));
      if (onZoomChange) onZoomChange(clamped);
      else setZoomState(clamped);
    },
    [onZoomChange],
  );
  const [rotation, setRotation] = useState(0);
  const [current, setCurrent] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [showThumbs, setShowThumbs] = useState(!mobile && !hideThumbnails);
  const [fullscreen, setFullscreen] = useState(false);
  const [baseDims, setBaseDims] = useState<PageDims[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [matches, setMatches] = useState<{ page: number; rects: { x: number; y: number; w: number; h: number }[] }[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);

  // Base (scale 1) page dimensions for layout.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    (async () => {
      const dims: PageDims[] = [];
      for (let i = 1; i <= loaded.numPages; i++) {
        const p = await loaded.doc.getPage(i);
        const vp = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
        dims.push({ width: vp.width, height: vp.height });
        if (cancelled) return;
      }
      if (!cancelled) setBaseDims(dims);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, rotation]);

  // Track container width for fit modes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [loaded]);

  const gap = 16;
  const padding = mobile ? 12 : 24;
  const virtualizer = useVirtualizer({
    count: numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (baseDims[i]?.height ?? 842) * zoom + gap,
    overscan: 2,
  });
  useEffect(() => virtualizer.measure(), [zoom, baseDims, virtualizer]);

  // Determine current page from scroll position.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !items.length) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    const item = items.find((it) => it.start <= mid && it.end > mid) ?? items[0];
    const page = item.index + 1;
    if (page !== current) {
      setCurrent(page);
      setPageInput(String(page));
      onPageChange?.(page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.index).join(','), virtualizer.scrollOffset]);

  const goToPage = useCallback(
    (p: number) => {
      const page = Math.min(numPages, Math.max(1, p));
      virtualizer.scrollToIndex(page - 1, { align: 'start' });
      setCurrent(page);
      setPageInput(String(page));
      onPageChange?.(page);
    },
    [numPages, virtualizer, onPageChange],
  );

  const fitWidth = useCallback(() => {
    const w = baseDims[current - 1]?.width ?? 595;
    if (containerWidth) setZoom((containerWidth - padding * 2 - (showThumbs && !mobile ? 0 : 0)) / w);
  }, [baseDims, current, containerWidth, padding, setZoom, showThumbs, mobile]);

  const fitPage = useCallback(() => {
    const d = baseDims[current - 1];
    const el = scrollRef.current;
    if (!d || !el) return;
    const s = Math.min((el.clientWidth - padding * 2) / d.width, (el.clientHeight - padding * 2) / d.height);
    setZoom(s);
  }, [baseDims, current, padding, setZoom]);

  const zoomIn = () => setZoom(ZOOM_STEPS.find((z) => z > zoom + 0.01) ?? zoom * 1.25);
  const zoomOut = () => setZoom([...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01) ?? zoom / 1.25);

  // Fullscreen
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen?.();
  };

  // Text search
  useEffect(() => {
    if (!loaded || !debouncedQuery.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const q = debouncedQuery.trim().toLowerCase();
    (async () => {
      const found: typeof matches = [];
      for (let i = 1; i <= loaded.numPages; i++) {
        const page = await loaded.doc.getPage(i);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
        const content = await page.getTextContent();
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.toLowerCase().includes(q)) continue;
          const tx = item.transform;
          const h = Math.hypot(tx[2], tx[3]) || item.height;
          const [x1, y1] = vp.convertToViewportPoint(tx[4], tx[5]);
          const [x2, y2] = vp.convertToViewportPoint(tx[4] + item.width, tx[5] + h);
          rects.push({ x: Math.min(x1, x2) / vp.width, y: Math.min(y1, y2) / vp.height, w: Math.abs(x2 - x1) / vp.width, h: Math.abs(y2 - y1) / vp.height });
        }
        if (rects.length) found.push({ page: i, rects });
        if (cancelled) return;
      }
      if (!cancelled) {
        setMatches(found);
        setMatchIndex(0);
        if (found[0]) goToPage(found[0].page);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, loaded, rotation, goToPage]);

  const totalMatches = useMemo(() => matches.reduce((n, m) => n + m.rects.length, 0), [matches]);
  const gotoMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIndex + dir + matches.length) % matches.length;
    setMatchIndex(next);
    goToPage(matches[next].page);
  };

  const onDims = useCallback(() => undefined, []);

  // Keyboard navigation inside the viewer
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoomIn();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      zoomOut();
    } else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) {
      e.preventDefault();
      goToPage(current + 1);
    } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) {
      e.preventDefault();
      goToPage(current - 1);
    }
  };

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <ErrorState error={error} title="Cannot preview this PDF" />
      </Box>
    );
  }

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} onClick={onClick} {...extra}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <Box
      ref={containerRef}
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="PDF viewer"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 320, bgcolor: 'background.paper', outline: 'none', borderRadius: fullscreen ? 0 : 2, overflow: 'hidden', border: 1, borderColor: 'divider' }}
    >
      {/* Toolbar */}
      <Box role="toolbar" aria-label="Viewer controls" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', overflowX: 'auto', flexShrink: 0 }}>
        {!hideThumbnails && btn(showThumbs ? 'Hide thumbnails' : 'Show thumbnails', <ViewSidebarRoundedIcon />, () => setShowThumbs((s) => !s), { 'aria-pressed': showThumbs })}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {btn('Previous page', <ChevronLeftRoundedIcon />, () => goToPage(current - 1), { disabled: current <= 1 })}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
          <InputBase
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(Number(pageInput) || current)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToPage(Number(pageInput) || current);
            }}
            inputProps={{ 'aria-label': 'Current page', inputMode: 'numeric', style: { textAlign: 'center', padding: '4px 0' } }}
            sx={{ width: 44, border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 13 }}
          />
          <Typography variant="body2" color="text.secondary">
            / {numPages || '–'}
          </Typography>
        </Box>
        {btn('Next page', <ChevronRightRoundedIcon />, () => goToPage(current + 1), { disabled: current >= numPages })}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {btn('Zoom out', <ZoomOutRoundedIcon />, zoomOut)}
        <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
          {Math.round(zoom * 100)}%
        </Typography>
        {btn('Zoom in', <ZoomInRoundedIcon />, zoomIn)}
        {btn('Fit to width', <WidthFullRoundedIcon />, fitWidth)}
        {btn('Fit to page', <FitScreenRoundedIcon />, fitPage)}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        {btn('Rotate', <RotateRightRoundedIcon />, () => setRotation((r) => (r + 90) % 360))}
        {!hideSearch && btn('Search text', <SearchRoundedIcon />, () => setSearchOpen((s) => !s), { 'aria-pressed': searchOpen })}
        <Box sx={{ flex: 1 }} />
        {toolbarExtra}
        {btn(fullscreen ? 'Exit full screen' : 'Full screen', fullscreen ? <FullscreenExitRoundedIcon /> : <FullscreenRoundedIcon />, toggleFullscreen)}
      </Box>

      {searchOpen && !hideSearch && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <SearchRoundedIcon fontSize="small" color="action" />
          <InputBase
            autoFocus
            placeholder="Find in document"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') gotoMatch(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') setSearchOpen(false);
            }}
            inputProps={{ 'aria-label': 'Find in document' }}
            sx={{ flex: 1, fontSize: 14 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {query ? (totalMatches ? `${matchIndex + 1} of ${matches.length} page${matches.length === 1 ? '' : 's'} · ${totalMatches} match${totalMatches === 1 ? '' : 'es'}` : 'No matches') : ''}
          </Typography>
          {btn('Previous match', <ChevronLeftRoundedIcon />, () => gotoMatch(-1), { disabled: !matches.length })}
          {btn('Next match', <ChevronRightRoundedIcon />, () => gotoMatch(1), { disabled: !matches.length })}
          {btn('Close search', <CloseRoundedIcon />, () => setSearchOpen(false))}
        </Box>
      )}

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showThumbs && !hideThumbnails && loaded && (
          <Box component="nav" aria-label="Page thumbnails" sx={{ width: mobile ? 96 : 140, flexShrink: 0, overflowY: 'auto', borderRight: 1, borderColor: 'divider', p: 1, display: 'flex', flexDirection: 'column', gap: 1, bgcolor: 'action.hover' }}>
            {Array.from({ length: numPages }, (_, i) => (
              <Box
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`Go to page ${i + 1}`}
                aria-current={current === i + 1 ? 'page' : undefined}
                onClick={() => goToPage(i + 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    goToPage(i + 1);
                  }
                }}
                sx={{ p: 0.5, borderRadius: 1.5, border: 2, borderColor: current === i + 1 ? 'primary.main' : 'transparent', cursor: 'pointer', outline: 'none', '&:focus-visible': { borderColor: 'primary.light' } }}
              >
                <PDFThumbnail cacheKey={`${ns}:${fileId}`} loaded={loaded} pageNumber={i + 1} width={mobile ? 80 : 120} rotation={rotation} />
                <Typography variant="caption" display="block" textAlign="center" color="text.secondary">
                  {i + 1}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        <Box ref={scrollRef} sx={{ flex: 1, overflow: 'auto', bgcolor: theme.palette.mode === 'dark' ? '#0B0F19' : '#E9ECF2', position: 'relative' }}>
          {loading && !loaded && (
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <CircularProgress size={28} />
              <Skeleton variant="rectangular" width="70%" height={480} />
            </Box>
          )}
          {loaded && (
            <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {items.map((item) => {
                const dims = baseDims[item.index];
                const w = (dims?.width ?? 595) * zoom;
                const h = (dims?.height ?? 842) * zoom;
                const pageMatches = matches.find((m) => m.page === item.index + 1)?.rects;
                return (
                  <Box
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    sx={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)`, display: 'flex', justifyContent: 'center', py: `${gap / 2}px`, px: `${padding}px`, boxSizing: 'border-box' }}
                  >
                    <Box sx={{ position: 'relative', width: w, height: h, boxShadow: 3, bgcolor: '#fff' }}>
                      <PageCanvas loaded={loaded} pageNumber={item.index + 1} scale={zoom} rotation={rotation} onDims={onDims} highlights={pageMatches} />
                      {renderOverlay && (
                        <Box sx={{ position: 'absolute', inset: 0 }}>{renderOverlay(item.index + 1, w, h, zoom)}</Box>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
