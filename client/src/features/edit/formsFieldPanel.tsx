import { Checkbox, FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import type { FormFieldInfo } from '@pdfly/core';
import { Controller, type Control } from 'react-hook-form';
import { isDateName, type FormValues } from './formsTypes';

export interface FormsFieldPanelProps {
  fields: FormFieldInfo[];
  control: Control<FormValues>;
  /** navigate the viewer to the page of a field */
  onFocusField?: (field: FormFieldInfo) => void;
}

/**
 * Accessible form listing every field of the PDF (keyboard users / screen readers).
 * Bound to the same react-hook-form control as the on-page overlay.
 */
export default function FormsFieldPanel({ fields, control, onFocusField }: FormsFieldPanelProps) {
  const editable = fields.filter((f) => f.kind !== 'button' && f.kind !== 'unknown');
  if (!editable.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No fillable fields.
      </Typography>
    );
  }
  return (
    <Stack component="form" noValidate spacing={2} onSubmit={(e) => e.preventDefault()} aria-label="Form fields">
      {editable.map((field) => {
        const label = field.name.replace(/[_.]/g, ' ');
        const page = field.widgets[0]?.page;
        const focus = () => onFocusField?.(field);
        const helper = page ? `Page ${page}${field.required ? ' · required' : ''}` : undefined;
        switch (field.kind) {
          case 'text':
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                render={({ field: f }) => (
                  <TextField
                    label={label}
                    value={typeof f.value === 'string' ? f.value : ''}
                    onChange={(e) => f.onChange(e.target.value)}
                    onBlur={f.onBlur}
                    onFocus={focus}
                    type={isDateName(field.name) ? 'date' : 'text'}
                    size="small"
                    fullWidth
                    disabled={field.readOnly}
                    required={field.required}
                    helperText={helper}
                    slotProps={{ inputLabel: isDateName(field.name) ? { shrink: true } : undefined }}
                  />
                )}
              />
            );
          case 'checkbox':
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                render={({ field: f }) => (
                  <FormControlLabel
                    control={<Checkbox checked={f.value === true} onChange={(e) => f.onChange(e.target.checked)} onFocus={focus} disabled={field.readOnly} />}
                    label={
                      <>
                        {label}
                        {helper && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {helper}
                          </Typography>
                        )}
                      </>
                    }
                  />
                )}
              />
            );
          case 'radio':
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                render={({ field: f }) => (
                  <FormControl component="fieldset" disabled={field.readOnly}>
                    <FormLabel component="legend">{label}</FormLabel>
                    <RadioGroup value={typeof f.value === 'string' ? f.value : ''} onChange={(e) => f.onChange(e.target.value)} onFocus={focus}>
                      {(field.options ?? []).map((o) => (
                        <FormControlLabel key={o} value={o} control={<Radio size="small" />} label={o} />
                      ))}
                    </RadioGroup>
                    {helper && (
                      <Typography variant="caption" color="text.secondary">
                        {helper}
                      </Typography>
                    )}
                  </FormControl>
                )}
              />
            );
          case 'dropdown':
          case 'optionlist': {
            const multiple = field.kind === 'optionlist';
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                render={({ field: f }) => (
                  <TextField
                    select
                    label={label}
                    value={multiple ? (Array.isArray(f.value) ? f.value : []) : typeof f.value === 'string' ? f.value : ''}
                    onChange={(e) => f.onChange(e.target.value)}
                    onFocus={focus}
                    size="small"
                    fullWidth
                    disabled={field.readOnly}
                    helperText={helper}
                    slotProps={{ select: { multiple } }}
                  >
                    {!multiple && <MenuItem value="">–</MenuItem>}
                    {(field.options ?? []).map((o) => (
                      <MenuItem key={o} value={o}>
                        {o}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            );
          }
          case 'signature':
            return (
              <Typography key={field.name} variant="body2" color="text.secondary">
                {label}: signature field (page {page}). Use the Edit PDF tool to draw a signature.
              </Typography>
            );
          default:
            return null;
        }
      })}
    </Stack>
  );
}
