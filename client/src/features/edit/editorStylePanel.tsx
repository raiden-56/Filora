import { Box, Divider, IconButton, List, ListItem, ListItemButton, ListItemText, MenuItem, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { removeAnnotation, selectAnnotation, setEditorStyle, updateAnnotation, type Annotation, type AnnotationType, type EditorTool } from '@/store/slices/editorSlice';
import { COLOR_SWATCHES, commitPatch } from './editorHistory';

const TYPE_LABEL: Record<AnnotationType, string> = {
  text: 'Text',
  image: 'Image',
  draw: 'Drawing',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strike-through',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  signature: 'Signature',
  checkbox: 'Checkbox',
};

function contextType(selected: Annotation | undefined, tool: EditorTool): AnnotationType | null {
  if (selected) return selected.type;
  if (tool === 'select' || tool === 'erase') return null;
  return tool;
}

const STROKE_TYPES: AnnotationType[] = ['draw', 'rect', 'ellipse', 'line', 'arrow', 'underline', 'strikeout', 'checkbox'];
const FILL_TYPES: AnnotationType[] = ['rect', 'ellipse', 'checkbox'];
const NO_COLOR_TYPES: AnnotationType[] = ['image', 'signature'];

function Swatches({ value, onChange, allowNone, label }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap role="radiogroup" aria-label={label}>
      {allowNone && (
        <Tooltip title="No fill">
          <Box
            component="button"
            type="button"
            role="radio"
            aria-checked={value === null}
            aria-label="No fill"
            onClick={() => onChange(null)}
            sx={{ width: 28, height: 28, borderRadius: '50%', border: 2, borderColor: value === null ? 'primary.main' : 'divider', bgcolor: 'transparent', cursor: 'pointer', p: 0, position: 'relative', '&::after': { content: '""', position: 'absolute', left: 4, right: 4, top: '50%', height: 2, bgcolor: 'error.main', transform: 'rotate(-45deg)' } }}
          />
        </Tooltip>
      )}
      {COLOR_SWATCHES.map((c) => (
        <Tooltip key={c} title={c}>
          <Box
            component="button"
            type="button"
            role="radio"
            aria-checked={value?.toUpperCase() === c}
            aria-label={`Color ${c}`}
            onClick={() => onChange(c)}
            sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: c, border: 2, borderColor: value?.toUpperCase() === c ? 'primary.main' : 'divider', boxShadow: value?.toUpperCase() === c ? '0 0 0 2px #fff inset' : undefined, cursor: 'pointer', p: 0 }}
          />
        </Tooltip>
      ))}
      <Tooltip title="Custom color">
        <Box component="label" sx={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', border: 2, borderColor: 'divider', cursor: 'pointer', background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
          <input type="color" aria-label={`${label}: custom color`} value={value ?? '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </Box>
      </Tooltip>
    </Stack>
  );
}

export interface EditorStylePanelProps {
  /** show the per-page annotation list (screen readers / keyboard users) */
  showList?: boolean;
}

/**
 * Style controls for the active tool / selected annotation. Changing a value updates
 * the default style and (via the slice) the selected annotation.
 */
export default function EditorStylePanel({ showList = true }: EditorStylePanelProps) {
  const dispatch = useAppDispatch();
  const style = useAppSelector((s) => s.editor.style);
  const tool = useAppSelector((s) => s.editor.tool);
  const selectedId = useAppSelector((s) => s.editor.selectedId);
  const annotations = useAppSelector((s) => s.editor.annotations);
  const currentPage = useAppSelector((s) => s.editor.currentPage);
  const selected = annotations.find((a) => a.id === selectedId);
  const type = contextType(selected, tool);

  // Text editing with a single undo step per focus session.
  const [text, setText] = useState(selected?.text ?? '');
  const originalText = useRef<string | null>(null);
  useEffect(() => {
    if (originalText.current === null) setText(selected?.text ?? '');
  }, [selected?.id, selected?.text]);

  const pageAnnotations = annotations.filter((a) => a.page === currentPage);

  return (
    <Stack spacing={2.5} data-testid="editor-style-panel">
      <Typography variant="subtitle2" color="text.secondary">
        {selected ? `Selected: ${TYPE_LABEL[selected.type]}` : type ? `${TYPE_LABEL[type]} style` : 'Select an annotation or pick a tool'}
      </Typography>

      {selected?.type === 'text' && (
        <TextField
          label="Text"
          multiline
          minRows={2}
          maxRows={6}
          fullWidth
          value={text}
          onFocus={() => {
            originalText.current = selected.text ?? '';
          }}
          onChange={(e) => {
            setText(e.target.value);
            dispatch(updateAnnotation({ id: selected.id, patch: { text: e.target.value }, history: false }));
          }}
          onBlur={() => {
            const orig = originalText.current;
            originalText.current = null;
            if (orig !== null && orig !== text) commitPatch(dispatch, selected.id, { text: orig }, { text });
          }}
        />
      )}

      {type && !NO_COLOR_TYPES.includes(type) && (
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            {type === 'text' ? 'Text color' : type === 'highlight' ? 'Highlight color' : 'Color'}
          </Typography>
          <Swatches label="Color" value={style.color} onChange={(c) => c && dispatch(setEditorStyle({ color: c }))} />
        </Box>
      )}

      {type && FILL_TYPES.includes(type) && (
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Fill
          </Typography>
          <Swatches label="Fill" allowNone value={style.fill} onChange={(c) => dispatch(setEditorStyle({ fill: c }))} />
        </Box>
      )}

      {type && (
        <Box sx={{ px: 0.5 }}>
          <Typography variant="caption" color="text.secondary" id="opacity-label">
            Opacity: {Math.round(style.opacity * 100)}%
          </Typography>
          <Slider aria-labelledby="opacity-label" min={0.05} max={1} step={0.05} value={style.opacity} onChange={(_, v) => dispatch(setEditorStyle({ opacity: v as number }))} size="small" />
        </Box>
      )}

      {type && STROKE_TYPES.includes(type) && (
        <Box sx={{ px: 0.5 }}>
          <Typography variant="caption" color="text.secondary" id="stroke-label">
            Stroke width: {style.strokeWidth} pt
          </Typography>
          <Slider aria-labelledby="stroke-label" min={0} max={20} step={0.5} value={style.strokeWidth} onChange={(_, v) => dispatch(setEditorStyle({ strokeWidth: v as number }))} size="small" />
        </Box>
      )}

      {type === 'text' && (
        <Stack direction="row" spacing={1.5}>
          <TextField
            label="Font size"
            type="number"
            size="small"
            value={style.fontSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 4 && n <= 120) dispatch(setEditorStyle({ fontSize: n }));
            }}
            slotProps={{ htmlInput: { min: 4, max: 120, step: 1, 'aria-label': 'Font size in points' } }}
            sx={{ width: 110 }}
          />
          <TextField select label="Font" size="small" value={style.fontFamily} onChange={(e) => dispatch(setEditorStyle({ fontFamily: e.target.value as Annotation['fontFamily'] }))} sx={{ flex: 1 }}>
            <MenuItem value="Helvetica">Helvetica</MenuItem>
            <MenuItem value="TimesRoman">Times</MenuItem>
            <MenuItem value="Courier">Courier</MenuItem>
          </TextField>
        </Stack>
      )}

      {showList && (
        <>
          <Divider />
          <Box>
            <Typography variant="caption" color="text.secondary" id="annotation-list-label">
              Annotations on page {currentPage} ({pageAnnotations.length})
            </Typography>
            <List dense aria-labelledby="annotation-list-label" sx={{ maxHeight: 220, overflowY: 'auto', py: 0 }}>
              {pageAnnotations.length === 0 && (
                <ListItem>
                  <ListItemText primary="None yet" slotProps={{ primary: { variant: 'body2', color: 'text.disabled' } }} />
                </ListItem>
              )}
              {pageAnnotations.map((a, i) => (
                <ListItem
                  key={a.id}
                  disablePadding
                  secondaryAction={
                    <IconButton edge="end" size="small" aria-label={`Delete ${TYPE_LABEL[a.type]} ${i + 1}`} onClick={() => dispatch(removeAnnotation(a.id))}>
                      <DeleteRoundedIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemButton selected={a.id === selectedId} onClick={() => dispatch(selectAnnotation(a.id))} sx={{ borderRadius: 1.5 }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: a.color, border: 1, borderColor: 'divider', mr: 1.5, flexShrink: 0 }} aria-hidden />
                    <ListItemText primary={`${TYPE_LABEL[a.type]}${a.type === 'text' && a.text ? `: ${a.text.slice(0, 24)}` : ''}`} slotProps={{ primary: { variant: 'body2', noWrap: true } }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        </>
      )}
    </Stack>
  );
}
