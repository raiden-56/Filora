import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createAppStore } from '@/store';
import { PAGE_SIZES } from '@pdfly/core';
import { computeImagePlacement, contentBox, mmToPt, ptToMm, resolvePageDims } from './pageLayout';
import JpgToPdfTool from './JpgToPdfTool';
import HtmlToPdfTool from './HtmlToPdfTool';
import WordToPdfTool from './WordToPdfTool';

function wrap(ui: ReactNode) {
  const store = createAppStore();
  return render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );
}

describe('pageLayout helpers', () => {
  it('converts millimetres to points and back', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(mmToPt(210)).toBeCloseTo(595.28, 1);
    expect(ptToMm(72)).toBeCloseTo(25.4, 6);
    expect(ptToMm(mmToPt(123.4))).toBeCloseTo(123.4, 6);
    expect(mmToPt(0)).toBe(0);
  });

  it('fit: scales the image down to fit inside the content box and centres it', () => {
    // landscape image on a portrait A4 page, no margin -> width limited
    const r = computeImagePlacement({ imgW: 2000, imgH: 1000, pageW: 595, pageH: 842, margin: 0, fit: 'fit' });
    expect(r.width).toBeCloseTo(595, 6);
    expect(r.height).toBeCloseTo(297.5, 6);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo((842 - 297.5) / 2, 6);
  });

  it('fit: respects the margin', () => {
    const r = computeImagePlacement({ imgW: 1000, imgH: 1000, pageW: 500, pageH: 800, margin: 50, fit: 'fit' });
    expect(r.width).toBeCloseTo(400, 6); // 500 - 2*50
    expect(r.height).toBeCloseTo(400, 6);
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(200, 6);
    expect(r.x).toBeGreaterThanOrEqual(contentBox(500, 800, 50).x);
  });

  it('fill: covers the whole content box (overflowing the shorter axis)', () => {
    const r = computeImagePlacement({ imgW: 2000, imgH: 1000, pageW: 595, pageH: 842, margin: 0, fit: 'fill' });
    expect(r.height).toBeCloseTo(842, 6);
    expect(r.width).toBeCloseTo(1684, 6);
    // centred: overflow is split equally left and right
    expect(r.x).toBeCloseTo((595 - 1684) / 2, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.x).toBeLessThan(0);
  });

  it('original: keeps native size when it fits, otherwise caps to the content box', () => {
    const small = computeImagePlacement({ imgW: 300, imgH: 200, pageW: 595, pageH: 842, margin: 20, fit: 'original' });
    expect(small.width).toBe(300);
    expect(small.height).toBe(200);
    expect(small.x).toBeCloseTo((595 - 300) / 2, 6);
    expect(small.y).toBeCloseTo((842 - 200) / 2, 6);

    const big = computeImagePlacement({ imgW: 3000, imgH: 2000, pageW: 595, pageH: 842, margin: 20, fit: 'original' });
    expect(big.width).toBeCloseTo(555, 6); // 595 - 40
    expect(big.height).toBeCloseTo(370, 6);
  });

  it('resolvePageDims handles Fit, auto orientation and custom sizes', () => {
    expect(resolvePageDims({ pageSize: 'Fit', orientation: 'auto', imgW: 400, imgH: 300, margin: 10 })).toEqual([420, 320]);
    // auto orientation picks landscape for a wide image
    const [w, h] = resolvePageDims({ pageSize: 'A4', orientation: 'auto', imgW: 400, imgH: 300, margin: 0 });
    expect(w).toBe(PAGE_SIZES.A4[1]);
    expect(h).toBe(PAGE_SIZES.A4[0]);
    // explicit portrait for a wide image stays portrait
    expect(resolvePageDims({ pageSize: 'Letter', orientation: 'portrait', imgW: 400, imgH: 300, margin: 0 })).toEqual([612, 792]);
    expect(resolvePageDims({ pageSize: 'Custom', orientation: 'portrait', customWidth: 100, customHeight: 200, imgW: 1, imgH: 1, margin: 0 })).toEqual([100, 200]);
  });
});

describe('JpgToPdfTool', () => {
  it('renders the heading and the upload dropzone', () => {
    wrap(<JpgToPdfTool />);
    expect(screen.getByRole('heading', { level: 1, name: 'JPG to PDF' })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /drop your images here/i })).toBeInTheDocument();
    expect(screen.getByText(/processed in your browser/i)).toBeInTheDocument();
  });
});

describe('WordToPdfTool', () => {
  it('renders the upload step and explains that conversion happens in the browser', () => {
    wrap(<WordToPdfTool />);
    expect(screen.getByRole('heading', { level: 1, name: 'Word to PDF' })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByText(/processed in your browser/i)).toBeInTheDocument();
  });
});

describe('HtmlToPdfTool', () => {
  it('shows the three source tabs, the convert button and the browser print action', () => {
    wrap(<HtmlToPdfTool />);
    expect(screen.getByRole('heading', { level: 1, name: 'HTML to PDF' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'HTML source' });
    expect(within(tabs).getByRole('tab', { name: 'Paste HTML' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Upload file' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'From URL' })).toBeInTheDocument();
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Convert to PDF');
    expect(screen.getByRole('button', { name: 'Print with browser' })).toBeDisabled();
  });

  it('rejects an invalid URL with a validation message', () => {
    wrap(<HtmlToPdfTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'From URL' }));
    const input = screen.getByLabelText('Web address');
    fireEvent.change(input, { target: { value: 'not a url' } });
    expect(screen.getByText(/enter a valid url/i)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('primary-action')).toBeDisabled();

    fireEvent.change(input, { target: { value: 'ftp://example.com/file.html' } });
    expect(screen.getByText(/only http:\/\/ and https:\/\//i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'https://example.com' } });
    expect(screen.queryByText(/enter a valid url/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('primary-action')).toBeEnabled();
  });

  it('enables the convert and print buttons once HTML is pasted (Load sample)', () => {
    wrap(<HtmlToPdfTool />);
    expect(screen.getByTestId('primary-action')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load sample' }));
    expect(screen.getByTestId('primary-action')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Print with browser' })).toBeEnabled();
    expect((screen.getByRole('textbox', { name: 'HTML code' }) as HTMLTextAreaElement).value).toContain('<html>');
  });
});
