import type { FormValue, NewFormField } from '@pdfly/core';

export type PaletteKind = 'text' | 'multiline' | 'checkbox' | 'radio' | 'dropdown' | 'date' | 'signature';

export interface DraftField {
  id: string;
  kind: PaletteKind;
  name: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  options: string[];
  /** PNG data URL for signature fields */
  imageDataUrl?: string;
}

export const PALETTE: { kind: PaletteKind; label: string; description: string }[] = [
  { kind: 'text', label: 'Text field', description: 'Single line of text' },
  { kind: 'multiline', label: 'Multiline text', description: 'Paragraph text area' },
  { kind: 'checkbox', label: 'Checkbox', description: 'Yes / no box' },
  { kind: 'radio', label: 'Radio group', description: 'Pick one option' },
  { kind: 'dropdown', label: 'Dropdown', description: 'Select from a list' },
  { kind: 'date', label: 'Date field', description: 'Text field for a date' },
  { kind: 'signature', label: 'Signature field', description: 'Signature line or drawn signature' },
];

/** Default field size in points (width as a page fraction when `wFrac` is set). */
export function defaultSize(kind: PaletteKind, optionCount = 2): { wFrac: number; hPt: number } {
  switch (kind) {
    case 'multiline':
      return { wFrac: 0.4, hPt: 80 };
    case 'checkbox':
      return { wFrac: 0, hPt: 14 };
    case 'radio':
      return { wFrac: 0.2, hPt: 18 * Math.max(1, optionCount) };
    case 'dropdown':
      return { wFrac: 0.25, hPt: 24 };
    case 'date':
      return { wFrac: 0.2, hPt: 24 };
    case 'signature':
      return { wFrac: 0.3, hPt: 60 };
    default:
      return { wFrac: 0.3, hPt: 24 };
  }
}

export function isDateName(name: string) {
  return /date|dob|birth/i.test(name);
}

function dataUrlToBytes(dataUrl: string): Uint8Array | undefined {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!m) return undefined;
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Map the editor's draft fields onto the core `NewFormField` shape. */
export function toNewFormFields(drafts: DraftField[]): NewFormField[] {
  return drafts.map((d) => ({
    kind: d.kind === 'multiline' ? 'text' : d.kind,
    name: d.name.trim() || d.id,
    page: d.page,
    rect: d.rect,
    options: d.kind === 'radio' || d.kind === 'dropdown' ? d.options.map((o) => o.trim()).filter(Boolean) : undefined,
    multiline: d.kind === 'multiline',
    image: d.kind === 'signature' && d.imageDataUrl ? dataUrlToBytes(d.imageDataUrl) : undefined,
    fontSize: d.kind === 'multiline' ? 10 : 11,
  }));
}

export function parseOptions(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FormValues = Record<string, FormValue>;
