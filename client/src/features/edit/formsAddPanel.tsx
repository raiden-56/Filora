import { Box, Button, Chip, IconButton, List, ListItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ShortTextRoundedIcon from '@mui/icons-material/ShortTextRounded';
import NotesRoundedIcon from '@mui/icons-material/NotesRounded';
import CheckBoxRoundedIcon from '@mui/icons-material/CheckBoxRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import ArrowDropDownCircleRoundedIcon from '@mui/icons-material/ArrowDropDownCircleRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import { useState } from 'react';
import Modal from '@/components/Modal';
import { SignaturePicker } from './editorSignaturePad';
import { PALETTE, parseOptions, type DraftField, type PaletteKind } from './formsTypes';

const ICONS: Record<PaletteKind, React.ReactNode> = {
  text: <ShortTextRoundedIcon fontSize="small" />,
  multiline: <NotesRoundedIcon fontSize="small" />,
  checkbox: <CheckBoxRoundedIcon fontSize="small" />,
  radio: <RadioButtonCheckedRoundedIcon fontSize="small" />,
  dropdown: <ArrowDropDownCircleRoundedIcon fontSize="small" />,
  date: <EventRoundedIcon fontSize="small" />,
  signature: <DrawRoundedIcon fontSize="small" />,
};

export interface FormsAddPanelProps {
  fields: DraftField[];
  activeKind: PaletteKind | null;
  onActiveKindChange: (kind: PaletteKind | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<DraftField>) => void;
  onRemove: (id: string) => void;
}

export default function FormsAddPanel({ fields, activeKind, onActiveKindChange, selectedId, onSelect, onUpdate, onRemove }: FormsAddPanelProps) {
  const [signatureFor, setSignatureFor] = useState<string | null>(null);
  const [optionText, setOptionText] = useState<Record<string, string>>({});

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }} id="palette-label">
          Add a field
        </Typography>
        <ToggleButtonGroup
          exclusive
          orientation="vertical"
          fullWidth
          value={activeKind}
          onChange={(_, v: PaletteKind | null) => onActiveKindChange(v)}
          aria-labelledby="palette-label"
          size="small"
        >
          {PALETTE.map((p) => (
            <ToggleButton key={p.kind} value={p.kind} aria-label={p.label} sx={{ justifyContent: 'flex-start', gap: 1.5, textTransform: 'none', minHeight: 44 }}>
              {ICONS[p.kind]}
              <Box sx={{ textAlign: 'left' }}>
                <Typography variant="body2" component="div">
                  {p.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {p.description}
                </Typography>
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {activeKind ? 'Now click or drag on the page to place the field.' : 'Choose a field type, then click or drag on the page.'}
        </Typography>
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }} id="new-fields-label">
          New fields ({fields.length})
        </Typography>
        {fields.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No fields added yet.
          </Typography>
        )}
        <List dense disablePadding aria-labelledby="new-fields-label">
          {fields.map((f, i) => {
            const selected = f.id === selectedId;
            return (
              <ListItem
                key={f.id}
                disableGutters
                onClick={() => onSelect(f.id)}
                sx={{ display: 'block', p: 1, mb: 1, borderRadius: 2, border: 1, borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : 'transparent' }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ color: 'text.secondary', display: 'flex' }}>{ICONS[f.kind]}</Box>
                  <TextField
                    size="small"
                    value={f.name}
                    onChange={(e) => onUpdate(f.id, { name: e.target.value })}
                    onFocus={() => onSelect(f.id)}
                    slotProps={{ htmlInput: { 'aria-label': `Name of field ${i + 1}`, maxLength: 100 } }}
                    sx={{ flex: 1 }}
                  />
                  <Chip label={`p. ${f.page}`} size="small" variant="outlined" />
                  <Tooltip title="Delete field">
                    <IconButton size="small" aria-label={`Delete field ${f.name || i + 1}`} onClick={(e) => { e.stopPropagation(); onRemove(f.id); }}>
                      <DeleteRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {(f.kind === 'radio' || f.kind === 'dropdown') && (
                  <TextField
                    size="small"
                    fullWidth
                    label="Options (comma separated)"
                    value={optionText[f.id] ?? f.options.join(', ')}
                    onChange={(e) => {
                      setOptionText((s) => ({ ...s, [f.id]: e.target.value }));
                      onUpdate(f.id, { options: parseOptions(e.target.value) });
                    }}
                    onBlur={() => setOptionText((s) => { const { [f.id]: _drop, ...rest } = s; void _drop; return rest; })}
                    sx={{ mt: 1 }}
                  />
                )}
                {f.kind === 'signature' && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    {f.imageDataUrl ? (
                      <img src={f.imageDataUrl} alt="Signature preview" style={{ height: 32, maxWidth: 120, objectFit: 'contain', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4 }} />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Signature line only
                      </Typography>
                    )}
                    <Button size="small" onClick={(e) => { e.stopPropagation(); setSignatureFor(f.id); }}>
                      {f.imageDataUrl ? 'Change signature' : 'Draw signature'}
                    </Button>
                    {f.imageDataUrl && (
                      <Button size="small" color="inherit" onClick={(e) => { e.stopPropagation(); onUpdate(f.id, { imageDataUrl: undefined }); }}>
                        Remove
                      </Button>
                    )}
                  </Stack>
                )}
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Modal open={signatureFor !== null} onClose={() => setSignatureFor(null)} title="Signature" maxWidth="sm" id="forms-signature-dialog">
        <Box sx={{ pt: 1 }}>
          <SignaturePicker
            onCommit={(dataUrl) => {
              if (signatureFor) onUpdate(signatureFor, { imageDataUrl: dataUrl });
              setSignatureFor(null);
            }}
          />
        </Box>
      </Modal>
    </Stack>
  );
}
