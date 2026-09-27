/**
 * Small helpers to read tool-specific `result.extra` values (stored untyped in the workflow
 * result) without sprinkling casts through every result component.
 */
export type ResultExtra = Record<string, unknown>;

export function numberOf(extra: ResultExtra | undefined, key: string): number | undefined {
  const v = extra?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function stringOf(extra: ResultExtra | undefined, key: string): string | undefined {
  const v = extra?.[key];
  return typeof v === 'string' ? v : undefined;
}

export function booleanOf(extra: ResultExtra | undefined, key: string): boolean | undefined {
  const v = extra?.[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function stringListOf(extra: ResultExtra | undefined, key: string): string[] {
  const v = extra?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function objectOf(extra: ResultExtra | undefined, key: string): ResultExtra | undefined {
  const v = extra?.[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ResultExtra) : undefined;
}

const ENGINE_LABELS: Record<string, string> = {
  'pdf-lib': 'pdf-lib',
  'pdfjs-rebuild': 'PDF.js rebuild',
  pdfjs: 'PDF.js',
  'tesseract.js': 'Tesseract.js',
  js: 'Built-in converter',
  none: 'None',
};

/** Human readable name of an engine id (e.g. "pdfjs" -> "PDF.js"). */
export function engineLabel(engine: string | undefined): string | undefined {
  if (!engine) return undefined;
  return ENGINE_LABELS[engine] ?? engine;
}
