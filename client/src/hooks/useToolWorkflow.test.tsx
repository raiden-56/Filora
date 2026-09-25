import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';
import { createAppStore } from '@/store';
import { useToolWorkflow } from './useToolWorkflow';
import { TOOL_BY_ID } from '@/constants/tools';
import { fileRegistry, outputRegistry } from '@/services/fileRegistry';

vi.mock('@/services/storage', () => ({
  saveOutput: vi.fn().mockResolvedValue(undefined),
  loadHistory: vi.fn().mockResolvedValue([]),
  purgeExpired: vi.fn().mockResolvedValue([]),
}));

const PDF = new File([new TextEncoder().encode('%PDF-1.4 test')], 'a.pdf', { type: 'application/pdf' });
const PDF2 = new File([new TextEncoder().encode('%PDF-1.4 test2')], 'b.pdf', { type: 'application/pdf' });

function wrapper(store: ReturnType<typeof createAppStore>) {
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

describe('useToolWorkflow', () => {
  it('validates and adds files, advances to configure, and processes to done', async () => {
    const store = createAppStore();
    const { result } = renderHook(() => useToolWorkflow(TOOL_BY_ID.merge), { wrapper: wrapper(store) });
    expect(result.current.step).toBe('upload');

    await act(async () => {
      await result.current.addFiles([PDF, new File(['x'], 'bad.txt'), PDF2]);
    });
    expect(result.current.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.current.step).toBe('configure');
    expect(store.getState().ui.snackbars[0].message).toMatch(/not a supported format/);
    expect(fileRegistry.has(result.current.files[0].id)).toBe(true);

    await act(async () => {
      await result.current.run(async (ctx) => {
        expect(ctx.files).toHaveLength(2);
        ctx.setStage('Generating PDF...', 0.5);
        const bytes = await ctx.getBytes(ctx.files[0].id);
        expect(bytes.byteLength).toBeGreaterThan(0);
        return { outputs: [{ name: 'out.pdf', blob: new Blob(['%PDF-out'], { type: 'application/pdf' }), pageCount: 3 }] };
      });
    });
    expect(result.current.step).toBe('done');
    expect(result.current.outputs).toHaveLength(1);
    expect(result.current.outputs[0]).toMatchObject({ name: 'out.pdf', mimeType: 'application/pdf', pageCount: 3 });
    expect(outputRegistry.has(result.current.outputs[0].id)).toBe(true);
    expect(store.getState().history.items[0].name).toBe('out.pdf');

    act(() => result.current.reset());
    expect(result.current.step).toBe('upload');
    expect(result.current.files).toHaveLength(0);
  });

  it('reports processing errors with a friendly message and returns to configure', async () => {
    const store = createAppStore();
    const { result } = renderHook(() => useToolWorkflow(TOOL_BY_ID.split), { wrapper: wrapper(store) });
    await act(async () => {
      await result.current.addFiles([PDF]);
    });
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('This PDF appears to be damaged.');
      });
    });
    await waitFor(() => expect(result.current.step).toBe('configure'));
    expect(result.current.error?.message).toBe('This PDF appears to be damaged.');
  });

  it('single-file tools replace the previous file', async () => {
    const store = createAppStore();
    const { result } = renderHook(() => useToolWorkflow(TOOL_BY_ID.split), { wrapper: wrapper(store) });
    await act(async () => {
      await result.current.addFiles([PDF]);
    });
    await act(async () => {
      await result.current.addFiles([PDF2]);
    });
    expect(result.current.files.map((f) => f.name)).toEqual(['b.pdf']);
  });

  it('cancel aborts a running job', async () => {
    const store = createAppStore();
    const { result } = renderHook(() => useToolWorkflow(TOOL_BY_ID.compress), { wrapper: wrapper(store) });
    await act(async () => {
      await result.current.addFiles([PDF]);
    });
    let promise: Promise<unknown> = Promise.resolve();
    act(() => {
      promise = result.current.run(
        (ctx) =>
          new Promise((_, reject) => {
            ctx.signal.addEventListener('abort', () => reject({ code: 'CANCELLED', message: 'cancelled' }));
          }),
      );
    });
    expect(result.current.step).toBe('processing');
    act(() => result.current.cancel());
    await act(async () => {
      await promise;
    });
    expect(result.current.step).toBe('configure');
    expect(result.current.error).toBeNull();
  });
});
