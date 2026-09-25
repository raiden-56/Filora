import { TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { parsePageSelection } from '@pdfly/core';

export interface PageSelectionInputProps {
  totalPages: number;
  value: number[];
  onChange: (pages: number[]) => void;
  label?: string;
  helperText?: string;
  /** current text (controlled from outside when selection is changed in the grid) */
  text?: string;
  onTextChange?: (text: string) => void;
  disabled?: boolean;
  id?: string;
}

/** Compresses [1,2,3,5,7,8] into "1-3, 5, 7-8". */
export function pagesToRangeText(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Text input for page selections like "1-3, 5, 8-10" with validation. */
export default function PageSelectionInput({ totalPages, value, onChange, label = 'Pages', helperText, disabled, id = 'page-selection' }: PageSelectionInputProps) {
  const [text, setText] = useState(pagesToRangeText(value));
  const [error, setError] = useState<string | null>(null);

  // Sync when selection changes from outside (e.g. clicking thumbnails).
  useEffect(() => {
    setText((current) => {
      try {
        const parsed = parsePageSelection(current, totalPages);
        if (parsed.join(',') === value.join(',')) return current;
      } catch {
        /* fallthrough */
      }
      return pagesToRangeText(value);
    });
    setError(null);
  }, [value, totalPages]);

  const commit = (t: string) => {
    setText(t);
    try {
      const parsed = parsePageSelection(t, totalPages);
      setError(null);
      onChange(parsed);
    } catch {
      setError('Use numbers and ranges, e.g. 1-3, 5, 8-10');
    }
  };

  return (
    <TextField
      id={id}
      label={label}
      value={text}
      onChange={(e) => commit(e.target.value)}
      error={Boolean(error)}
      helperText={error ?? helperText ?? `e.g. 1-3, 5, 8-10 (of ${totalPages})`}
      disabled={disabled}
      fullWidth
      slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-describedby': `${id}-helper` } }}
    />
  );
}
