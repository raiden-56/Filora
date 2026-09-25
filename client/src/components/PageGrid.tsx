import { Box, Checkbox, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import RotateLeftRoundedIcon from '@mui/icons-material/RotateLeftRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo, type ReactNode } from 'react';
import PDFThumbnail from './PDFThumbnail';
import type { LoadedPdf } from '@/services/pdfjs';

/** A page shown in the grid. `key` must be unique (pages may be duplicated). */
export interface GridPage {
  key: string;
  /** cache key of the source document (e.g. `input:<fileId>`) */
  docKey: string;
  loaded: LoadedPdf | null;
  /** 1-based page number in the source document */
  pageNumber: number;
  /** extra clockwise rotation applied by the user */
  rotation: number;
  /** label shown under the thumbnail */
  label?: string;
  /** width/height aspect ratio for the placeholder */
  aspect?: number;
  /** visually marks the page (e.g. as removed) */
  dimmed?: boolean;
  badge?: ReactNode;
}

export interface PageGridProps {
  pages: GridPage[];
  /** selected page keys */
  selected?: Set<string>;
  onToggleSelect?: (key: string, shiftKey: boolean) => void;
  onReorder?: (keys: string[]) => void;
  onRotate?: (key: string, delta: number) => void;
  onDelete?: (key: string) => void;
  onDuplicate?: (key: string) => void;
  onClickPage?: (key: string) => void;
  /** thumbnail size */
  size?: 'sm' | 'md' | 'lg';
  /** render an extra element after each page (e.g. an "insert here" control) */
  renderAfter?: (page: GridPage, index: number) => ReactNode;
  ariaLabel?: string;
}

const SIZES = { sm: 110, md: 150, lg: 200 };

function PageCell(props: {
  page: GridPage;
  index: number;
  sortable: boolean;
  selectable: boolean;
  selected: boolean;
  width: number;
  onToggleSelect?: (key: string, shiftKey: boolean) => void;
  onRotate?: (key: string, delta: number) => void;
  onDelete?: (key: string) => void;
  onDuplicate?: (key: string) => void;
  onClickPage?: (key: string) => void;
}) {
  const { page, index, sortable, selectable, selected, width, onToggleSelect, onRotate, onDelete, onDuplicate, onClickPage } = props;
  const theme = useTheme();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key, disabled: !sortable });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 3 : undefined };
  const hasActions = onRotate || onDelete || onDuplicate;
  const clickable = selectable || onClickPage;

  return (
    <Box ref={setNodeRef} style={style} sx={{ position: 'relative', opacity: isDragging ? 0.5 : page.dimmed ? 0.45 : 1 }}>
      <Box
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-pressed={selectable ? selected : undefined}
        aria-label={`Page ${page.label ?? index + 1}${selected ? ', selected' : ''}`}
        onClick={(e) => {
          if (selectable) onToggleSelect?.(page.key, e.shiftKey);
          else onClickPage?.(page.key);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (selectable) onToggleSelect?.(page.key, e.shiftKey);
            else onClickPage?.(page.key);
          }
        }}
        sx={{
          p: 1,
          borderRadius: 2.5,
          border: 2,
          borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: selected ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
          cursor: clickable ? 'pointer' : 'default',
          transition: 'border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
          outline: 'none',
          '&:hover': { boxShadow: 3 },
          '&:focus-visible': { boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.3)}` },
          '&:hover .page-actions, &:focus-within .page-actions': { opacity: 1 },
        }}
        data-testid="page-cell"
      >
        <Box sx={{ position: 'relative' }}>
          <PDFThumbnail cacheKey={page.docKey} loaded={page.loaded} pageNumber={page.pageNumber} width={width} rotation={page.rotation} aspect={page.aspect} alt={`Page ${page.label ?? index + 1}`} />
          {selectable && (
            <Checkbox
              checked={selected}
              onChange={() => onToggleSelect?.(page.key, false)}
              onClick={(e) => e.stopPropagation()}
              inputProps={{ 'aria-label': `Select page ${page.label ?? index + 1}` }}
              size="small"
              sx={{ position: 'absolute', top: 2, left: 2, bgcolor: 'background.paper', borderRadius: 1, p: 0.25, '&:hover': { bgcolor: 'background.paper' } }}
            />
          )}
          {sortable && (
            <Tooltip title="Drag to move">
              <IconButton
                size="small"
                aria-label={`Move page ${page.label ?? index + 1}`}
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
                sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'background.paper', cursor: 'grab', touchAction: 'none', '&:hover': { bgcolor: 'background.paper' } }}
              >
                <DragIndicatorRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {page.badge && <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>{page.badge}</Box>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.75, minHeight: 28 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            {page.label ?? index + 1}
          </Typography>
          {hasActions && (
            <Box className="page-actions" sx={{ display: 'flex', opacity: { xs: 1, md: 0.6 }, transition: 'opacity 120ms ease' }} onClick={(e) => e.stopPropagation()}>
              {onRotate && (
                <>
                  <Tooltip title="Rotate left">
                    <IconButton size="small" aria-label={`Rotate page ${page.label ?? index + 1} left`} onClick={() => onRotate(page.key, -90)} sx={{ p: 0.5 }}>
                      <RotateLeftRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Rotate right">
                    <IconButton size="small" aria-label={`Rotate page ${page.label ?? index + 1} right`} onClick={() => onRotate(page.key, 90)} sx={{ p: 0.5 }}>
                      <RotateRightRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
              {onDuplicate && (
                <Tooltip title="Duplicate">
                  <IconButton size="small" aria-label={`Duplicate page ${page.label ?? index + 1}`} onClick={() => onDuplicate(page.key)} sx={{ p: 0.5 }}>
                    <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              {onDelete && (
                <Tooltip title="Delete">
                  <IconButton size="small" aria-label={`Delete page ${page.label ?? index + 1}`} onClick={() => onDelete(page.key)} sx={{ p: 0.5 }} color="error">
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

const MemoPageCell = memo(PageCell);

function PageGridInner({ pages, selected, onToggleSelect, onReorder, onRotate, onDelete, onDuplicate, onClickPage, size = 'md', renderAfter, ariaLabel = 'Pages' }: PageGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortable = Boolean(onReorder) && pages.length > 1;
  const width = SIZES[size];

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const keys = pages.map((p) => p.key);
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder?.(arrayMove(keys, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={pages.map((p) => p.key)} strategy={rectSortingStrategy}>
        <Box
          role="list"
          aria-label={ariaLabel}
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: `repeat(auto-fill, minmax(${width}px, 1fr))`,
            contentVisibility: 'auto',
          }}
        >
          {pages.map((p, i) => (
            <Box key={p.key} role="listitem" sx={{ display: 'contents' }}>
              <MemoPageCell
                page={p}
                index={i}
                sortable={sortable}
                selectable={Boolean(onToggleSelect)}
                selected={selected?.has(p.key) ?? false}
                width={width}
                onToggleSelect={onToggleSelect}
                onRotate={onRotate}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onClickPage={onClickPage}
              />
              {renderAfter?.(p, i)}
            </Box>
          ))}
        </Box>
      </SortableContext>
    </DndContext>
  );
}

const PageGrid = memo(PageGridInner);
export default PageGrid;
