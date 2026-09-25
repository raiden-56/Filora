import { describe, it, expect } from 'vitest';
import { createAppStore } from './index';
import { addFiles, removeFile, reorderFiles, setFileOrder, renameFile, rotateFile } from './slices/fileSlice';
import { openTool, startProcessing, setProgress, finishProcessing, failProcessing, resetTool } from './slices/toolSlice';
import { addAnnotation, undo, redo, updateAnnotation, removeAnnotation, initEditor, selectAnnotation } from './slices/editorSlice';
import { updateSettings, setThemeMode } from './slices/settingsSlice';
import { showSnackbar, dismissSnackbar } from './slices/uiSlice';
import { addHistoryItems, removeHistoryItem } from './slices/historySlice';
import type { FileMeta } from '@/types';

const meta = (id: string, name = `${id}.pdf`): FileMeta => ({ id, name, size: 10, type: 'application/pdf', lastModified: 0, addedAt: 0, rotation: 0 });

describe('fileSlice', () => {
  it('adds, reorders, renames, rotates and removes files', () => {
    const store = createAppStore();
    store.dispatch(addFiles([meta('a'), meta('b'), meta('c')]));
    store.dispatch(reorderFiles({ from: 0, to: 2 }));
    expect(store.getState().files.files.map((f) => f.id)).toEqual(['b', 'c', 'a']);
    store.dispatch(setFileOrder(['a', 'b']));
    expect(store.getState().files.files.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    store.dispatch(renameFile({ id: 'a', name: 'renamed.pdf' }));
    store.dispatch(rotateFile({ id: 'a', delta: -90 }));
    expect(store.getState().files.files[0]).toMatchObject({ name: 'renamed.pdf', rotation: 270 });
    store.dispatch(removeFile('b'));
    expect(store.getState().files.files).toHaveLength(2);
  });
});

describe('toolSlice', () => {
  it('walks through the workflow states', () => {
    const store = createAppStore();
    store.dispatch(openTool('merge'));
    expect(store.getState().tool.step).toBe('upload');
    store.dispatch(startProcessing('Analyzing...'));
    expect(store.getState().tool.step).toBe('processing');
    store.dispatch(setProgress({ stage: 'Converting...', progress: 40 }));
    expect(store.getState().tool).toMatchObject({ stage: 'Converting...', progress: 40 });
    store.dispatch(finishProcessing({ toolId: 'merge', outputs: [], inputs: [], startedAt: 0, finishedAt: 1, durationMs: 1 }));
    expect(store.getState().tool.step).toBe('done');
    store.dispatch(failProcessing({ code: 'X', message: 'boom' }));
    expect(store.getState().tool).toMatchObject({ step: 'configure', error: { message: 'boom' } });
    store.dispatch(resetTool());
    expect(store.getState().tool.step).toBe('upload');
  });
});

describe('editorSlice undo/redo', () => {
  it('supports undo and redo of annotation changes', () => {
    const store = createAppStore();
    store.dispatch(initEditor({ fileId: 'f' }));
    store.dispatch(addAnnotation({ type: 'rect', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: '#f00', opacity: 1, strokeWidth: 2 }));
    const id = store.getState().editor.annotations[0].id;
    store.dispatch(updateAnnotation({ id, patch: { x: 0.5 } }));
    expect(store.getState().editor.annotations[0].x).toBe(0.5);
    store.dispatch(undo());
    expect(store.getState().editor.annotations[0].x).toBe(0.1);
    store.dispatch(redo());
    expect(store.getState().editor.annotations[0].x).toBe(0.5);
    store.dispatch(selectAnnotation(id));
    expect(store.getState().editor.style.color).toBe('#f00');
    store.dispatch(removeAnnotation(id));
    expect(store.getState().editor.annotations).toHaveLength(0);
    store.dispatch(undo());
    expect(store.getState().editor.annotations).toHaveLength(1);
  });
});

describe('settings, ui and history slices', () => {
  it('updates settings and theme', () => {
    const store = createAppStore();
    store.dispatch(updateSettings({ imageQuality: 50 }));
    store.dispatch(setThemeMode('dark'));
    expect(store.getState().settings).toMatchObject({ imageQuality: 50, themeMode: 'dark' });
  });
  it('queues and dismisses snackbars (max 3)', () => {
    const store = createAppStore();
    for (let i = 0; i < 5; i++) store.dispatch(showSnackbar(`m${i}`, 'info'));
    expect(store.getState().ui.snackbars).toHaveLength(3);
    const id = store.getState().ui.snackbars[0].id;
    store.dispatch(dismissSnackbar(id));
    expect(store.getState().ui.snackbars).toHaveLength(2);
  });
  it('keeps history sorted newest first', () => {
    const store = createAppStore();
    store.dispatch(addHistoryItems([{ id: '1', name: 'a', mimeType: 'application/pdf', size: 1, createdAt: 1, toolId: 'merge', toolName: 'Merge' }]));
    store.dispatch(addHistoryItems([{ id: '2', name: 'b', mimeType: 'application/pdf', size: 1, createdAt: 2, toolId: 'merge', toolName: 'Merge' }]));
    expect(store.getState().history.items.map((i) => i.id)).toEqual(['2', '1']);
    store.dispatch(removeHistoryItem('2'));
    expect(store.getState().history.items).toHaveLength(1);
  });
});
