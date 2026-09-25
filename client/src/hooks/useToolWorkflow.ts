import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  addFiles as addFilesAction,
  clearFiles,
  removeFile as removeFileAction,
  renameFile as renameFileAction,
  reorderFiles,
  rotateFile as rotateFileAction,
  setFileOrder,
  updateFileMeta,
} from '@/store/slices/fileSlice';
import {
  failProcessing,
  finishProcessing,
  openTool,
  resetTool,
  setProgress,
  setStep,
  startProcessing,
  clearToolError,
} from '@/store/slices/toolSlice';
import { addHistoryItems } from '@/store/slices/historySlice';
import { showSnackbar } from '@/store/slices/uiSlice';
import { clearPdfInfo, removePdfInfo } from '@/store/slices/pdfSlice';
import { fileRegistry, outputRegistry } from '@/services/fileRegistry';
import { clearPdfCache, evictCachedPdf, clearThumbnailCache } from '@/services/pdfjs';
import { toAppError } from '@/services/api';
import { saveOutput } from '@/services/storage';
import { downloadBlob, downloadAllAsZip } from '@/services/download';
import { toFileMeta, validateFile } from '@/utils/file';
import { newId } from '@/utils/id';
import type { FileMeta, OutputFileMeta, ToolDefinition, ToolResultMeta } from '@/types';
import type { SettingsState } from '@/store/slices/settingsSlice';
import { stripExtension, sanitizeFilename } from '@pdfly/core';

export interface ProcessOutput {
  name: string;
  blob: Blob;
  mimeType?: string;
  pageCount?: number;
}

export interface ProcessResult {
  outputs: ProcessOutput[];
  extra?: Record<string, unknown>;
  warnings?: string[];
}

export interface ProcessContext {
  files: FileMeta[];
  settings: SettingsState;
  signal: AbortSignal;
  getBlob: (id: string) => Blob;
  getBytes: (id: string) => Promise<Uint8Array>;
  /** Update the visible processing stage/progress (progress 0-1 or null for indeterminate). */
  setStage: (stage: string, progress?: number | null) => void;
  setProgress: (progress: number | null) => void;
}

export type ProcessFn = (ctx: ProcessContext) => Promise<ProcessResult>;

export interface UseToolWorkflowOptions {
  /** Automatically move to the configure step when files are added (default true). */
  autoAdvance?: boolean;
  /** Minimum number of files required before configure step (default 1). */
  minFiles?: number;
}

export function useToolWorkflow(tool: ToolDefinition, options: UseToolWorkflowOptions = {}) {
  const dispatch = useAppDispatch();
  const files = useAppSelector((s) => s.files.files);
  const toolState = useAppSelector((s) => s.tool);
  const settings = useAppSelector((s) => s.settings);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const filesRef = useRef(files);
  filesRef.current = files;
  const { autoAdvance = true, minFiles = 1 } = options;

  // Open the tool on mount and clean everything up on unmount.
  useEffect(() => {
    dispatch(openTool(tool.id));
    return () => {
      abortRef.current?.abort();
      dispatch(clearFiles());
      dispatch(clearPdfInfo());
      dispatch(resetTool());
      fileRegistry.clear();
      outputRegistry.clear();
      clearPdfCache();
      clearThumbnailCache();
    };
  }, [dispatch, tool.id]);

  const maxFiles = tool.maxFiles ?? (tool.multiple ? 50 : 1);

  const addFiles = useCallback(
    async (incoming: File[]): Promise<FileMeta[]> => {
      const errors: string[] = [];
      const accepted: FileMeta[] = [];
      const current = filesRef.current;
      let room = tool.multiple ? maxFiles - current.length : 1;
      for (const file of incoming) {
        if (room <= 0) {
          errors.push(tool.multiple ? `You can add up to ${maxFiles} files.` : 'This tool works with one file at a time.');
          break;
        }
        const v = await validateFile(file, tool.accept);
        if (!v.ok) {
          errors.push(v.error!);
          continue;
        }
        const meta = toFileMeta(file);
        fileRegistry.set(meta.id, file);
        accepted.push(meta);
        room--;
      }
      if (errors.length) {
        dispatch(showSnackbar(errors.slice(0, 3).join(' '), 'error', 7000));
      }
      if (accepted.length) {
        if (!tool.multiple) {
          // replace existing file
          for (const f of current) {
            fileRegistry.remove(f.id);
            evictCachedPdf(`input:${f.id}`);
            dispatch(removePdfInfo(f.id));
          }
          dispatch(clearFiles());
        }
        dispatch(addFilesAction(accepted));
        dispatch(clearToolError());
        if (autoAdvance && current.length + accepted.length >= minFiles) dispatch(setStep('configure'));
      }
      return accepted;
    },
    [dispatch, tool, maxFiles, autoAdvance, minFiles],
  );

  const removeFile = useCallback(
    (id: string) => {
      fileRegistry.remove(id);
      evictCachedPdf(`input:${id}`);
      clearThumbnailCache(`input:${id}`);
      dispatch(removePdfInfo(id));
      dispatch(removeFileAction(id));
      if (filesRef.current.length <= 1) dispatch(setStep('upload'));
    },
    [dispatch],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    for (const f of filesRef.current) fileRegistry.remove(f.id);
    outputRegistry.clear();
    clearPdfCache();
    clearThumbnailCache();
    dispatch(clearFiles());
    dispatch(clearPdfInfo());
    dispatch(resetTool());
  }, [dispatch]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (processFn: ProcessFn, initialStage = 'Processing...') => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const startedAt = Date.now();
      dispatch(startProcessing(initialStage));
      outputRegistry.clear();

      const ctx: ProcessContext = {
        files: filesRef.current,
        settings: settingsRef.current,
        signal: controller.signal,
        getBlob: (id) => {
          const b = fileRegistry.get(id);
          if (!b) throw new Error('File is no longer available. Please upload it again.');
          return b;
        },
        getBytes: (id) => fileRegistry.bytes(id),
        setStage: (stage, progress) =>
          dispatch(setProgress({ stage, progress: progress === undefined ? null : progress === null ? null : Math.round(progress * 100) })),
        setProgress: (progress) => dispatch(setProgress({ progress: progress === null ? null : Math.round(progress * 100) })),
      };

      try {
        const result = await processFn(ctx);
        if (controller.signal.aborted) throw { code: 'CANCELLED', message: 'The operation was cancelled.' };
        if (!result.outputs.length) throw new Error('No output was produced.');
        ctx.setStage('Finalizing...', 1);
        const outputs: OutputFileMeta[] = result.outputs.map((o) => {
          const id = newId('out');
          outputRegistry.set(id, o.blob);
          return {
            id,
            name: sanitizeFilename(o.name, 'output'),
            size: o.blob.size,
            mimeType: o.mimeType ?? o.blob.type ?? 'application/octet-stream',
            pageCount: o.pageCount,
          };
        });
        const finishedAt = Date.now();
        const meta: ToolResultMeta = {
          toolId: tool.id,
          outputs,
          inputs: filesRef.current.map((f) => ({ name: f.name, size: f.size })),
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          extra: result.extra,
          warnings: result.warnings,
        };
        dispatch(finishProcessing(meta));

        // Persist to My Files (best effort).
        const items = outputs.map((o) => ({
          id: o.id,
          name: o.name,
          mimeType: o.mimeType,
          size: o.size,
          createdAt: finishedAt,
          toolId: tool.id,
          toolName: tool.name,
          pageCount: o.pageCount,
        }));
        dispatch(addHistoryItems(items));
        void Promise.all(items.map((item) => saveOutput(item, outputRegistry.get(item.id)!))).catch(() => undefined);
        return meta;
      } catch (err) {
        const appErr = toAppError(err);
        if (appErr.code === 'CANCELLED') {
          dispatch(setStep('configure'));
          dispatch(showSnackbar('Cancelled.', 'info', 3000));
        } else {
          dispatch(failProcessing(appErr));
          dispatch(showSnackbar(appErr.message, 'error', 8000));
        }
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [dispatch, tool.id, tool.name],
  );

  const result = toolState.result;
  const outputs = result?.outputs ?? [];

  const getOutputBlob = useCallback((id: string) => outputRegistry.get(id), []);

  const downloadOutput = useCallback((id: string) => {
    const blob = outputRegistry.get(id);
    const meta = filesRef.current && outputs.find((o) => o.id === id);
    if (blob && meta) downloadBlob(blob, meta.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputs]);

  const downloadAll = useCallback(async () => {
    if (!outputs.length) return;
    if (outputs.length === 1) {
      downloadOutput(outputs[0].id);
      return;
    }
    const base = filesRef.current[0] ? stripExtension(filesRef.current[0].name) : tool.slug;
    await downloadAllAsZip(
      outputs.map((o) => ({ name: o.name, blob: outputRegistry.get(o.id)! })).filter((e) => e.blob),
      `${base}-${tool.slug}.zip`,
    );
  }, [outputs, downloadOutput, tool.slug]);

  return useMemo(
    () => ({
      tool,
      files,
      step: toolState.step,
      stage: toolState.stage,
      progress: toolState.progress,
      error: toolState.error,
      result,
      outputs,
      settings,
      addFiles,
      removeFile,
      renameFile: (id: string, name: string) => dispatch(renameFileAction({ id, name })),
      reorder: (from: number, to: number) => dispatch(reorderFiles({ from, to })),
      setOrder: (ids: string[]) => dispatch(setFileOrder(ids)),
      rotateFile: (id: string, delta: number) => dispatch(rotateFileAction({ id, delta })),
      updateFile: (id: string, patch: Partial<FileMeta>) => dispatch(updateFileMeta({ id, patch })),
      goToConfigure: () => dispatch(setStep('configure')),
      goToUpload: () => dispatch(setStep('upload')),
      clearError: () => dispatch(clearToolError()),
      run,
      cancel,
      reset,
      getOutputBlob,
      downloadOutput,
      downloadAll,
      notify: (message: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info') =>
        dispatch(showSnackbar(message, severity)),
    }),
    [
      tool,
      files,
      toolState.step,
      toolState.stage,
      toolState.progress,
      toolState.error,
      result,
      outputs,
      settings,
      addFiles,
      removeFile,
      run,
      cancel,
      reset,
      getOutputBlob,
      downloadOutput,
      downloadAll,
      dispatch,
    ],
  );
}

export type ToolWorkflow = ReturnType<typeof useToolWorkflow>;
