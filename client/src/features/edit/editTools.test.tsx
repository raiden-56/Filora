import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createAppStore } from '@/store';
import {
  applyDrag,
  clampRect,
  detectContentBounds,
  imageTileOrigins,
  imageWatermarkSize,
  numberPosition,
  textTileOrigins,
  watermarkBox,
  ptToMm,
  mmToPt,
} from './placement';
import RotatePdfTool from './RotatePdfTool';
import WatermarkTool from './WatermarkTool';

const A4 = { pageW: 595.28, pageH: 841.89 };

describe('placement: numberPosition', () => {
  it('places top-left numbers at the margin (top-left coords)', () => {
    const p = numberPosition({ position: 'top-left', margin: 28, fontSize: 12, textWidth: 40, ...A4 });
    expect(p.x).toBe(28);
    expect(p.y).toBeCloseTo(28);
    expect(p.baselineY).toBeCloseTo(40);
  });

  it('places bottom-right numbers inside the margin, baseline at margin from the bottom', () => {
    const p = numberPosition({ position: 'bottom-right', margin: 28, fontSize: 12, textWidth: 40, ...A4 });
    expect(p.x).toBeCloseTo(A4.pageW - 28 - 40);
    expect(p.baselineY).toBeCloseTo(A4.pageH - 28);
    expect(p.y).toBeCloseTo(A4.pageH - 28 - 12);
  });

  it('centres horizontally for *-center positions', () => {
    const p = numberPosition({ position: 'bottom-center', margin: 20, fontSize: 10, textWidth: 100, ...A4 });
    expect(p.x).toBeCloseTo((A4.pageW - 100) / 2);
    expect(p.baselineY).toBeCloseTo(A4.pageH - 20);
  });
});

describe('placement: watermarkBox', () => {
  it('centres the item for position center', () => {
    const b = watermarkBox({ position: 'center', ...A4, itemW: 200, itemH: 48 });
    expect(b.cx).toBeCloseTo(A4.pageW / 2);
    expect(b.cy).toBeCloseTo(A4.pageH / 2);
    expect(b.x).toBeCloseTo(A4.pageW / 2 - 100);
    expect(b.y).toBeCloseTo(A4.pageH / 2 - 24);
  });

  it('uses a 36pt margin for corners by default', () => {
    const tl = watermarkBox({ position: 'top-left', ...A4, itemW: 200, itemH: 48 });
    expect(tl.x).toBe(36);
    expect(tl.y).toBeCloseTo(36);
    const br = watermarkBox({ position: 'bottom-right', ...A4, itemW: 200, itemH: 48 });
    expect(br.x).toBeCloseTo(A4.pageW - 200 - 36);
    expect(br.y).toBeCloseTo(A4.pageH - 36 - 48);
    expect(br.cx).toBeCloseTo(br.x + 100);
    expect(br.cy).toBeCloseTo(br.y + 24);
  });

  it('keeps middle-left / middle-right vertically centred', () => {
    const ml = watermarkBox({ position: 'middle-left', ...A4, itemW: 100, itemH: 20, margin: 10 });
    expect(ml.x).toBe(10);
    expect(ml.cy).toBeCloseTo(A4.pageH / 2);
    const mr = watermarkBox({ position: 'middle-right', ...A4, itemW: 100, itemH: 20, margin: 10 });
    expect(mr.x).toBeCloseTo(A4.pageW - 110);
  });
});

describe('placement: tiling and image size', () => {
  it('text tiles mirror the core loop (step = textWidth + 80, fontSize + 100, starting one step outside)', () => {
    const pageW = 500;
    const pageH = 400;
    const textWidth = 120;
    const fontSize = 40;
    const origins = textTileOrigins(pageW, pageH, textWidth, fontSize);
    const stepX = textWidth + 80;
    const stepY = fontSize + 100;
    let count = 0;
    for (let yy = -stepY; yy < pageH + stepY; yy += stepY) for (let xx = -stepX; xx < pageW + stepX; xx += stepX) count++;
    expect(origins).toHaveLength(count);
    // first origin: xx = -stepX, yy = -stepY -> visual y = pageH + stepY
    expect(origins[0]).toEqual({ x: -stepX, y: pageH + stepY });
  });

  it('image tiles start at the page origin with 60pt gaps', () => {
    const origins = imageTileOrigins(300, 200, 100, 50);
    // xx: 0, 160 ; yy: 0, 110 -> 4 tiles
    expect(origins).toHaveLength(4);
    expect(origins[0]).toEqual({ x: 0, y: 200 });
    expect(origins[1]).toEqual({ x: 160, y: 200 });
    expect(origins[2]).toEqual({ x: 0, y: 90 });
  });

  it('image size scales with page width and clamps the fraction', () => {
    expect(imageWatermarkSize(500, 0.4, 200, 100)).toEqual({ width: 200, height: 100 });
    expect(imageWatermarkSize(500, 5, 200, 100).width).toBe(500);
    expect(imageWatermarkSize(500, 0, 200, 100).width).toBeCloseTo(10);
  });

  it('converts points to millimetres and back', () => {
    expect(ptToMm(72)).toBeCloseTo(25.4);
    expect(mmToPt(25.4)).toBeCloseTo(72);
  });
});

describe('crop: detectContentBounds', () => {
  function bitmap(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number] | null) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const px = paint(x, y) ?? [255, 255, 255, 255];
        data.set(px, i);
      }
    }
    return { data, width, height };
  }

  it('finds the bounding box of dark pixels with 2% padding', () => {
    const img = bitmap(100, 100, (x, y) => (x >= 20 && x <= 39 && y >= 30 && y <= 59 ? [0, 0, 0, 255] : null));
    const r = detectContentBounds(img);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(0.18);
    expect(r!.y).toBeCloseTo(0.28);
    expect(r!.width).toBeCloseTo(0.24);
    expect(r!.height).toBeCloseTo(0.34);
  });

  it('returns null for a blank (white) page and ignores transparent pixels', () => {
    expect(detectContentBounds(bitmap(50, 50, () => null))).toBeNull();
    expect(detectContentBounds(bitmap(50, 50, () => [0, 0, 0, 0]))).toBeNull();
  });

  it('treats light grey above the threshold as background', () => {
    const img = bitmap(40, 40, (x, y) => (x === 10 && y === 10 ? [250, 250, 250, 255] : x === 30 && y === 30 ? [200, 200, 200, 255] : null));
    const r = detectContentBounds(img, { padding: 0 });
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(0.75);
    expect(r!.y).toBeCloseTo(0.75);
    expect(r!.width).toBeCloseTo(0.025);
    expect(r!.height).toBeCloseTo(0.025);
  });

  it('clamps the padded box to the page', () => {
    const img = bitmap(100, 100, (x, y) => (x < 2 || y < 2 ? [0, 0, 0, 255] : null));
    const r = detectContentBounds(img, { padding: 0.1 });
    expect(r!.x).toBe(0);
    expect(r!.y).toBe(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(1);
    expect(r!.y + r!.height).toBeLessThanOrEqual(1);
  });
});

describe('crop: rect maths', () => {
  it('clampRect keeps the rect inside the page and above the minimum size', () => {
    expect(clampRect({ x: 0.9, y: -0.2, width: 0.5, height: 0.001 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.02 });
  });

  it('applyDrag moves without leaving the page', () => {
    const r = applyDrag({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 'move', 0.9, -0.5);
    expect(r).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it('applyDrag resizes from the west edge keeping the right edge fixed', () => {
    const r = applyDrag({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 'w', 0.1, 0);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.x + r.width).toBeCloseTo(0.8);
  });

  it('applyDrag never collapses below the minimum size', () => {
    const r = applyDrag({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 'se', -5, -5);
    expect(r.width).toBeCloseTo(0.02);
    expect(r.height).toBeCloseTo(0.02);
  });
});

function renderTool(ui: React.ReactElement) {
  const store = createAppStore();
  return render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );
}

describe('RotatePdfTool', () => {
  it('renders the upload step with the tool title', async () => {
    renderTool(<RotatePdfTool />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rotate PDF' })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose pdf/i })).toBeInTheDocument();
  });
});

describe('WatermarkTool', () => {
  it('renders the upload step with the tool title', async () => {
    renderTool(<WatermarkTool />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Watermark' })).toBeInTheDocument();
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByText(/processed in your browser/i)).toBeInTheDocument();
  });
});
