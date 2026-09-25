import { useEffect, useRef, useState } from 'react';
import { renderThumbnail, type LoadedPdf } from '@/services/pdfjs';

/**
 * Lazily renders a page thumbnail when the element scrolls into view.
 * Returns a data URL (or null while loading) and a ref for the container element.
 */
export function useThumbnail(
  cacheKey: string,
  loaded: LoadedPdf | null,
  pageNumber: number,
  width = 160,
  rotation = 0,
  eager = false,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(eager);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eager || visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, visible]);

  useEffect(() => {
    if (!visible || !loaded) return;
    let cancelled = false;
    setError(null);
    renderThumbnail(cacheKey, loaded, pageNumber, width, rotation)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Render failed');
      });
    return () => {
      cancelled = true;
    };
  }, [visible, loaded, cacheKey, pageNumber, width, rotation]);

  return { ref, url, error, visible };
}
