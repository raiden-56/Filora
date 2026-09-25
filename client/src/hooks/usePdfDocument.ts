import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setPdfError, setPdfInfo, setPdfLoading } from '@/store/slices/pdfSlice';
import { fileRegistry, outputRegistry } from '@/services/fileRegistry';
import { getCachedPdf, type LoadedPdf } from '@/services/pdfjs';

export type PdfNamespace = 'input' | 'output' | 'blob';

export function pdfCacheKey(ns: PdfNamespace, id: string) {
  return `${ns}:${id}`;
}

/**
 * Loads (and caches) a PDF.js document for a file id from the input or output registry,
 * or from an arbitrary Blob (ns = 'blob', pass the blob).
 */
export function usePdfDocument(id: string | null | undefined, ns: PdfNamespace = 'input', blob?: Blob) {
  const dispatch = useAppDispatch();
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const info = useAppSelector((s) => (id ? s.pdf.docs[id] : undefined));

  useEffect(() => {
    if (!id) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setLoading(true);
    setError(null);
    if (ns === 'input') dispatch(setPdfLoading(id));
    const loader = async () => {
      if (ns === 'blob') {
        if (!blob) throw new Error('No file');
        return blob;
      }
      const reg = ns === 'input' ? fileRegistry : outputRegistry;
      const b = reg.get(id);
      if (!b) throw new Error('File is no longer available. Please upload it again.');
      return b;
    };
    getCachedPdf(pdfCacheKey(ns, id), loader)
      .then(async (l) => {
        if (cancelled) return;
        setLoaded(l);
        if (ns === 'input') {
          const pages = [];
          for (let i = 1; i <= l.numPages; i++) {
            const p = await l.doc.getPage(i);
            const vp = p.getViewport({ scale: 1 });
            pages.push({ width: vp.width, height: vp.height, rotation: p.rotate });
          }
          if (!cancelled) dispatch(setPdfInfo({ fileId: id, pageCount: l.numPages, pages }));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Could not open this PDF.';
        setError(msg);
        if (ns === 'input') dispatch(setPdfError({ fileId: id, error: msg }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, ns, blob, dispatch]);

  return { loaded, doc: loaded?.doc ?? null, numPages: loaded?.numPages ?? 0, loading, error, info };
}
