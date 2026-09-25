import type { FormFieldInfo } from '@pdfly/core';
import { type Control, useController } from 'react-hook-form';
import { isDateName, type FormValues } from './formsTypes';

export interface FormsFillOverlayProps {
  page: number;
  widthPx: number;
  heightPx: number;
  fields: FormFieldInfo[];
  control: Control<FormValues>;
}

const baseStyle: React.CSSProperties = {
  position: 'absolute',
  boxSizing: 'border-box',
  border: '1px solid rgba(37, 99, 235, 0.6)',
  background: 'rgba(219, 234, 254, 0.55)',
  borderRadius: 2,
  padding: '0 4px',
  fontFamily: 'Helvetica, Arial, sans-serif',
  color: '#111827',
  outline: 'none',
  margin: 0,
};

function rectStyle(w: { x: number; y: number; width: number; height: number }, widthPx: number, heightPx: number): React.CSSProperties {
  return { left: w.x * widthPx, top: w.y * heightPx, width: Math.max(8, w.width * widthPx), height: Math.max(8, w.height * heightPx) };
}

function WidgetInput({ field, widgetIndex, widthPx, heightPx, control }: { field: FormFieldInfo; widgetIndex: number; widthPx: number; heightPx: number; control: Control<FormValues> }) {
  const { field: f } = useController({ name: field.name, control });
  const w = field.widgets[widgetIndex];
  const style = { ...baseStyle, ...rectStyle(w, widthPx, heightPx) };
  const fontSize = Math.max(9, Math.min(w.height * heightPx * 0.6, 18));
  const disabled = field.readOnly;
  const label = field.name.replace(/[_.]/g, ' ');

  switch (field.kind) {
    case 'text': {
      const value = typeof f.value === 'string' ? f.value : '';
      const isDate = isDateName(field.name);
      const multiline = w.height * heightPx > fontSize * 2.5 && !isDate;
      if (multiline) {
        return <textarea aria-label={label} value={value} disabled={disabled} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} style={{ ...style, fontSize, resize: 'none', padding: 2 }} />;
      }
      return <input type={isDate ? 'date' : 'text'} aria-label={label} value={value} disabled={disabled} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} style={{ ...style, fontSize }} />;
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          aria-label={label}
          checked={f.value === true}
          disabled={disabled}
          onChange={(e) => f.onChange(e.target.checked)}
          onBlur={f.onBlur}
          style={{ ...style, padding: 0, background: 'transparent', accentColor: '#2563EB', cursor: 'pointer' }}
        />
      );
    case 'radio': {
      const option = field.options?.[widgetIndex] ?? String(widgetIndex);
      return (
        <input
          type="radio"
          name={`radio-${field.name}`}
          aria-label={`${label}: ${option}`}
          value={option}
          checked={f.value === option}
          disabled={disabled}
          onChange={() => f.onChange(option)}
          onBlur={f.onBlur}
          style={{ ...style, padding: 0, background: 'transparent', accentColor: '#2563EB', cursor: 'pointer' }}
        />
      );
    }
    case 'dropdown': {
      const value = typeof f.value === 'string' ? f.value : '';
      return (
        <select aria-label={label} value={value} disabled={disabled} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} style={{ ...style, fontSize }}>
          <option value="">–</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !(field.options ?? []).includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    }
    case 'optionlist': {
      const value = Array.isArray(f.value) ? f.value : typeof f.value === 'string' && f.value ? [f.value] : [];
      return (
        <select
          multiple
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => f.onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
          onBlur={f.onBlur}
          style={{ ...style, fontSize }}
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return null;
  }
}

/**
 * Renders a live HTML input over every form widget on the page, bound to the shared
 * react-hook-form state so the side panel and the page stay in sync.
 */
export default function FormsFillOverlay({ page, widthPx, heightPx, fields, control }: FormsFillOverlayProps) {
  const items: React.ReactNode[] = [];
  for (const field of fields) {
    if (field.kind === 'button' || field.kind === 'signature' || field.kind === 'unknown') continue;
    field.widgets.forEach((w, i) => {
      if (w.page !== page) return;
      items.push(<WidgetInput key={`${field.name}-${i}`} field={field} widgetIndex={i} widthPx={widthPx} heightPx={heightPx} control={control} />);
    });
  }
  return (
    <div style={{ position: 'absolute', inset: 0 }} data-testid={`forms-overlay-${page}`}>
      {items}
    </div>
  );
}
