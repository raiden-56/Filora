import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';
import { createAppStore } from '@/store';
import { TOOL_BY_ID } from '@/constants/tools';
import PdfToJpgTool from './PdfToJpgTool';
import PdfToWordTool from './PdfToWordTool';
import PdfToPptTool from './PdfToPptTool';
import PdfToExcelTool from './PdfToExcelTool';
import PdfToPdfaTool from './PdfToPdfaTool';

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    ...actual,
    getServerCapabilities: vi.fn().mockResolvedValue({
      libreoffice: true,
      ghostscript: true,
      qpdf: true,
      tesseract: true,
      puppeteer: true,
      maxFileSizeMb: 50,
      ocrLanguages: [{ code: 'eng', name: 'English' }],
      fileTtlMinutes: 60,
    }),
  };
});

function renderTool(Component: ComponentType) {
  const store = createAppStore();
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </Provider>,
  );
}

const cases: [string, ComponentType][] = [
  ['pdf-to-jpg', PdfToJpgTool],
  ['pdf-to-word', PdfToWordTool],
  ['pdf-to-ppt', PdfToPptTool],
  ['pdf-to-excel', PdfToExcelTool],
  ['pdf-to-pdfa', PdfToPdfaTool],
];

describe('Convert from PDF tools', () => {
  it.each(cases)('%s renders the upload step with the tool title', (id, Component) => {
    renderTool(Component);
    const tool = TOOL_BY_ID[id];
    expect(screen.getByRole('heading', { level: 1, name: tool.name })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose pdf/i })).toBeInTheDocument();
  });
});
