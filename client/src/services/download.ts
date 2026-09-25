import { sanitizeFilename } from '@pdfly/core';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename, 'download');
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** Create a ZIP archive from several blobs (JSZip is loaded lazily). */
export async function createZip(entries: ZipEntry[], onProgress?: (fraction: number) => void): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const e of entries) {
    let name = sanitizeFilename(e.name, 'file');
    let i = 2;
    while (used.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
      i++;
    }
    used.add(name);
    zip.file(name, e.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (meta) =>
    onProgress?.(meta.percent / 100),
  );
}

export async function downloadAllAsZip(entries: ZipEntry[], zipName: string) {
  const blob = await createZip(entries);
  downloadBlob(blob, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);
}
