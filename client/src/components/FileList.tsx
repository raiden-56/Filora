import { Box, Button, Typography } from '@mui/material';
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
import type { FileMeta } from '@/types';
import FileCard from './FileCard';
import { formatBytes } from '@/utils/format';

export interface FileListProps {
  files: FileMeta[];
  onRemove?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onRotate?: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  onAddMore?: () => void;
  addMoreLabel?: string;
  /** grid (cards) or list (rows) */
  variant?: 'grid' | 'list';
  header?: ReactNode;
  emptyText?: string;
}

function SortableFile(props: {
  file: FileMeta;
  index: number;
  sortable: boolean;
  compact: boolean;
  onRemove?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onRotate?: (id: string) => void;
}) {
  const { file, index, sortable, compact, onRemove, onRename, onRotate } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled: !sortable });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: 'relative' as const };
  return (
    <Box ref={setNodeRef} style={style}>
      <FileCard
        file={file}
        index={index}
        compact={compact}
        onRemove={onRemove}
        onRename={onRename}
        onRotate={onRotate}
        isDragging={isDragging}
        dragHandleProps={sortable ? { ...attributes, ...listeners } : undefined}
      />
    </Box>
  );
}

function FileListInner({ files, onRemove, onRename, onRotate, onReorder, onAddMore, addMoreLabel = 'Add more files', variant = 'grid', header, emptyText }: FileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortable = Boolean(onReorder) && files.length > 1;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = files.findIndex((f) => f.id === active.id);
    const to = files.findIndex((f) => f.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder?.(arrayMove(files.map((f) => f.id), from, to));
  };

  const totalSize = files.reduce((n, f) => n + f.size, 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        {header ?? (
          <Typography variant="subtitle2" color="text.secondary">
            {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
            {sortable && ' · Drag to reorder'}
          </Typography>
        )}
        {onAddMore && (
          <Button size="small" variant="outlined" onClick={onAddMore}>
            {addMoreLabel}
          </Button>
        )}
      </Box>
      {files.length === 0 && emptyText && (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={files.map((f) => f.id)} strategy={rectSortingStrategy}>
          <Box
            sx={
              variant === 'grid'
                ? {
                    display: 'grid',
                    gap: 1.5,
                    gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' },
                  }
                : { display: 'flex', flexDirection: 'column', gap: 1 }
            }
            role="list"
            aria-label="Uploaded files"
          >
            {files.map((f, i) => (
              <Box key={f.id} role="listitem">
                <SortableFile file={f} index={i} sortable={sortable} compact={variant === 'list'} onRemove={onRemove} onRename={onRename} onRotate={onRotate} />
              </Box>
            ))}
          </Box>
        </SortableContext>
      </DndContext>
    </Box>
  );
}

const FileList = memo(FileListInner);
export default FileList;
