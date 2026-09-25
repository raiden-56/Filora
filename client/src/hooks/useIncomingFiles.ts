import { useEffect, useRef } from 'react';
import { pendingFiles } from '@/services/pendingFiles';
import type { ToolWorkflow } from './useToolWorkflow';

/**
 * Picks up files dropped on the home page (or handed over by another tool) and adds
 * them to the workflow once on mount.
 */
export function useIncomingFiles(workflow: ToolWorkflow) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const files = pendingFiles.take();
    if (files?.length) void workflow.addFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
