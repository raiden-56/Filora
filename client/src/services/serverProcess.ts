import { processOnServer, downloadServerFile } from './api';
import type { ProcessContext, ProcessResult } from '@/hooks/useToolWorkflow';
import type { ServerProcessResult } from '@/types';

export interface ServerProcessOptions {
  endpoint: string;
  /** Files to upload: defaults to all workflow files under the field name "files". */
  files?: { field: string; id: string; name?: string }[];
  fields?: Record<string, string | number | boolean | undefined | null | object>;
  /** Stage label shown while the server is working. */
  processingStage?: string;
  /** Called with the raw server result to derive `extra` for the workflow result. */
  mapExtra?: (result: ServerProcessResult) => Record<string, unknown> | undefined;
}

/**
 * Standard pipeline for server-backed tools: upload (with progress) -> process -> download outputs.
 */
export async function processViaServer(ctx: ProcessContext, opts: ServerProcessOptions): Promise<ProcessResult> {
  const fileSpecs = opts.files ?? ctx.files.map((f) => ({ field: 'files', id: f.id, name: f.name }));
  const uploadFiles = fileSpecs.map((s) => {
    const meta = ctx.files.find((f) => f.id === s.id);
    return { field: s.field, file: ctx.getBlob(s.id), name: s.name ?? meta?.name ?? 'file' };
  });

  ctx.setStage('Uploading...', 0);
  let uploaded = false;
  const result = await processOnServer(opts.endpoint, {
    files: uploadFiles,
    fields: opts.fields,
    signal: ctx.signal,
    onUploadProgress: (fraction) => {
      if (fraction >= 1 && !uploaded) {
        uploaded = true;
        ctx.setStage(opts.processingStage ?? 'Processing...', null);
      } else if (!uploaded) {
        ctx.setStage('Uploading...', fraction);
      }
    },
  });
  if (!uploaded) ctx.setStage(opts.processingStage ?? 'Processing...', null);

  ctx.setStage('Downloading result...', 0);
  const outputs = [];
  const total = result.files.length;
  for (let i = 0; i < total; i++) {
    const f = result.files[i];
    const blob = await downloadServerFile(
      f,
      (fraction) => ctx.setStage('Downloading result...', (i + fraction) / total),
      ctx.signal,
    );
    outputs.push({
      name: f.name,
      blob: blob.type ? blob : new Blob([blob], { type: f.mimeType }),
      mimeType: f.mimeType,
      pageCount: f.pageCount,
    });
  }
  return {
    outputs,
    extra: opts.mapExtra ? opts.mapExtra(result) : result.meta,
    warnings: result.warnings,
  };
}
