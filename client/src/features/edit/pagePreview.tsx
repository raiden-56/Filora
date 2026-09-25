/**
 * Shared preview helpers for the Edit tools: render a page into a canvas at fit width,
 * a horizontal thumbnail strip to pick the current page, and standard-font text metrics.
 */
import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import PDFThumbnail from '@/components/PDFThumbnail';
import { renderPageToCanvas, type LoadedPdf } from '@/services/pdfjs';
import { useDebounce } from '@/hooks/useDebounce';
import { approxTextWidth, type StdFontName } from './placement';

export interface PageCanvasState {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** rendered CSS size in px */
  width: number;
  height: number;
  /** visual page size in points (after the page's own /Rotate) */
  pageWidthPt: number;
  pageHeightPt: number;
  /** CSS px per point */
  scale: number;
  loading: boolean;
  error: string | null;
}

/**
 * Renders `pageNumber` of `loaded` into a canvas at `maxWidth` CSS px (fit width).
 * Re-renders when the page or width changes; renders are serialized so pdf.js never
 * draws twice into the same canvas at once.
 */
export function usePageCanvas(loaded: LoadedPdf | null, pageNumber: number, maxWidth: number): PageCanvasState {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState({ width: 0, height: 0, pageWidthPt: 0, pageHeightPt: 0, scale: 1, loading: false, error: null as string | null });
  const width = useDebounce(Math.max(0, Math.floor(maxWidth)), 120);

  useEffect(() => {
    if (!loaded || !width || pageNumber < 1 || pageNumber > loaded.numPages) return;
    let cancelled = false;
    const controller = new AbortController();
    let proxy: PDFPageProxy | null = null;
    setState((s) => ({ ...s, loading: true, error: null }));
    chain.current = chain.current
      .then(async () => {
        if (cancelled) return;
        const page = await loaded.doc.getPage(pageNumber);
        proxy = page;
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        const r = await renderPageToCanvas(page, canvas, { width, signal: controller.signal });
        if (cancelled) return;
        setState({
          width: r.width,
          height: r.height,
          pageWidthPt: base.width,
          pageHeightPt: base.height,
          scale: r.width / base.width,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Could not render this page.';
        setState((s) => ({ ...s, loading: false, error: msg }));
      });
    return () => {
      cancelled = true;
      controller.abort();
      proxy?.cleanup();
    };
  }, [loaded, pageNumber, width]);

  return { canvasRef, ...state };
}

/** Observes the width of an element (ResizeObserver with a window-resize fallback). */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ---------------------------------------------------------------------------
// Standard font metrics (exact widths via pdf-lib, the same engine used for output)
// ---------------------------------------------------------------------------

let stdFontsPromise: Promise<Record<StdFontName, PDFFont>> | null = null;

export function loadStdFonts(): Promise<Record<StdFontName, PDFFont>> {
  if (!stdFontsPromise) {
    stdFontsPromise = (async () => {
      const doc = await PDFDocument.create();
      const [Helvetica, TimesRoman, Courier] = await Promise.all([
        doc.embedFont(StandardFonts.Helvetica),
        doc.embedFont(StandardFonts.TimesRoman),
        doc.embedFont(StandardFonts.Courier),
      ]);
      return { Helvetica, TimesRoman, Courier };
    })();
    stdFontsPromise.catch(() => {
      stdFontsPromise = null;
    });
  }
  return stdFontsPromise;
}

/** Width of `text` at `size` in the given standard font. Approximate until the fonts are loaded. */
export function useStdTextWidth(font: StdFontName, text: string, size: number): number {
  const [fonts, setFonts] = useState<Record<StdFontName, PDFFont> | null>(null);
  useEffect(() => {
    let alive = true;
    loadStdFonts()
      .then((f) => {
        if (alive) setFonts(f);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!fonts) return approxTextWidth(text, size, font);
  try {
    return fonts[font].widthOfTextAtSize(text, size);
  } catch {
    // characters outside WinAnsi cannot be measured (nor embedded) by the standard fonts
    return approxTextWidth(text, size, font);
  }
}

// ---------------------------------------------------------------------------
// Page strip
// ---------------------------------------------------------------------------

export interface PageStripProps {
  loaded: LoadedPdf | null;
  /** cache key of the document, e.g. `input:<fileId>` */
  docKey: string;
  numPages: number;
  current: number;
  onChange: (page: number) => void;
  /** aspect ratio (w/h) per page for placeholders */
  aspectFor?: (page: number) => number | undefined;
  /** extra label per page (e.g. "cropped") */
  badgeFor?: (page: number) => string | undefined;
  thumbWidth?: number;
  ariaLabel?: string;
}

function PageStripInner({ loaded, docKey, numPages, current, onChange, aspectFor, badgeFor, thumbWidth = 72, ariaLabel = 'Pages' }: PageStripProps) {
  const theme = useTheme();
  const listRef = useRef<HTMLDivElement>(null);

  // keep the current page visible
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [current]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        onChange(Math.min(numPages, current + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        onChange(Math.max(1, current - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        onChange(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        onChange(numPages);
      }
    },
    [current, numPages, onChange],
  );

  if (numPages <= 1) return null;

  return (
    <Box
      ref={listRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`page-strip-${current}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        py: 1,
        px: 0.5,
        outline: 'none',
        scrollbarWidth: 'thin',
        '&:focus-visible': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.3)}`, borderRadius: 2 },
      }}
    >
      {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
        const active = p === current;
        const badge = badgeFor?.(p);
        return (
          <ButtonBase
            key={p}
            id={`page-strip-${p}`}
            data-page={p}
            role="option"
            aria-selected={active}
            aria-label={`Page ${p}${badge ? `, ${badge}` : ''}`}
            tabIndex={-1}
            onClick={() => onChange(p)}
            sx={{
              flexShrink: 0,
              width: thumbWidth + 12,
              p: 0.5,
              borderRadius: 2,
              border: 2,
              borderColor: active ? 'primary.main' : 'transparent',
              bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
              flexDirection: 'column',
              gap: 0.25,
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
            }}
          >
            <Box sx={{ width: '100%', position: 'relative' }}>
              <PDFThumbnail cacheKey={docKey} loaded={loaded} pageNumber={p} width={thumbWidth} aspect={aspectFor?.(p)} alt="" />
              {badge && (
                <Typography
                  variant="caption"
                  sx={{ position: 'absolute', bottom: 2, right: 2, px: 0.5, borderRadius: 1, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 10, lineHeight: '16px' }}
                >
                  {badge}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500, color: active ? 'primary.main' : 'text.secondary' }}>
              {p}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export const PageStrip = memo(PageStripInner);

/** Small helper: page aspect (w/h) from the redux page info list, respecting /Rotate. */
export function aspectFromInfo(pages: { width: number; height: number; rotation: number }[] | undefined, pageNumber: number, extraRotation = 0): number | undefined {
  const p = pages?.[pageNumber - 1];
  if (!p || !p.width || !p.height) return undefined;
  const rot = (((p.rotation + extraRotation) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  return swapped ? p.height / p.width : p.width / p.height;
}
