import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';
import { createAppStore } from '@/store';
import { TOOL_BY_ID } from '@/constants/tools';
import HeicToJpgTool from './HeicToJpgTool';
import HeifToJpgTool from './HeifToJpgTool';
import JpgToPngTool from './JpgToPngTool';
import PngToJpgTool from './PngToJpgTool';

function renderTool(Component: ComponentType) {
  return render(
    <Provider store={createAppStore()}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </Provider>,
  );
}

const cases: [string, ComponentType, RegExp][] = [
  ['heic-to-jpg', HeicToJpgTool, /HEIC, HEIF supported/],
  ['heif-to-jpg', HeifToJpgTool, /HEIC, HEIF supported/],
  ['jpg-to-png', JpgToPngTool, /JPG, JPEG supported/],
  ['png-to-jpg', PngToJpgTool, /PNG supported/],
];

describe('Image tools', () => {
  it.each(cases)('%s renders the upload step with the accepted formats', (id, Component, formats) => {
    renderTool(Component);
    expect(screen.getByRole('heading', { level: 1, name: TOOL_BY_ID[id].name })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByText(formats)).toBeInTheDocument();
    expect(screen.getByText(/processed in your browser/i)).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toHaveAttribute('multiple');
  });
});
