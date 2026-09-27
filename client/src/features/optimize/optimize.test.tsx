import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';
import { createAppStore } from '@/store';
import { TOOL_BY_ID } from '@/constants/tools';
import { finishProcessing, openTool } from '@/store/slices/toolSlice';
import type { ToolResultMeta } from '@/types';
import CompressPdfTool from './CompressPdfTool';
import RepairPdfTool from './RepairPdfTool';
import OcrPdfTool from './OcrPdfTool';

function renderTool(Component: ComponentType, store = createAppStore()) {
  const utils = render(
    <Provider store={store}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </Provider>,
  );
  return { ...utils, store };
}

const cases: [string, ComponentType][] = [
  ['compress', CompressPdfTool],
  ['repair', RepairPdfTool],
  ['ocr', OcrPdfTool],
];

describe('Optimize PDF tools', () => {
  it.each(cases)('%s renders the upload step with the tool title', (id, Component) => {
    renderTool(Component);
    const tool = TOOL_BY_ID[id];
    expect(screen.getByRole('heading', { level: 1, name: tool.name })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
  });

  it('CompressPdfTool shows the size comparison on the result screen', () => {
    const store = createAppStore();
    store.dispatch(openTool('compress'));
    renderTool(CompressPdfTool, store);

    const now = Date.now();
    const meta: ToolResultMeta = {
      toolId: 'compress',
      outputs: [{ id: 'out_1', name: 'report-compressed.pdf', size: 400000, mimeType: 'application/pdf' }],
      inputs: [{ name: 'report.pdf', size: 1000000 }],
      startedAt: now - 1500,
      finishedAt: now,
      durationMs: 1500,
      extra: { originalSize: 1000000, compressedSize: 400000, reductionPercent: 60, level: 'medium', engine: 'js' },
    };
    act(() => {
      store.dispatch(finishProcessing(meta));
    });

    expect(screen.getByTestId('result-screen')).toBeInTheDocument();
    expect(screen.getByText('Reduced by 60%')).toBeInTheDocument();
    expect(screen.getByText('Original size')).toBeInTheDocument();
    expect(screen.getByText('Compressed size')).toBeInTheDocument();
    expect(screen.getByText(/Engine: Built-in converter/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('RepairPdfTool uses the "No damage found" title for healthy files', () => {
    const store = createAppStore();
    store.dispatch(openTool('repair'));
    renderTool(RepairPdfTool, store);
    const now = Date.now();
    act(() => {
      store.dispatch(
        finishProcessing({
          toolId: 'repair',
          outputs: [{ id: 'out_2', name: 'file-repaired.pdf', size: 1234, mimeType: 'application/pdf' }],
          inputs: [{ name: 'file.pdf', size: 1234 }],
          startedAt: now,
          finishedAt: now,
          durationMs: 10,
          extra: { status: 'healthy', repaired: false, engine: 'pdf-lib', notes: ['Cross-reference table is intact.'] },
        }),
      );
    });
    expect(screen.getByRole('heading', { name: 'No damage found' })).toBeInTheDocument();
    expect(screen.getByText('Cross-reference table is intact.')).toBeInTheDocument();
  });
});
