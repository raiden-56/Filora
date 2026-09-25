import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createAppStore } from '@/store';
import SplitPdfTool from './SplitPdfTool';
import {
  canRedo,
  canUndo,
  clampCrop,
  commitHistory,
  createHistory,
  createPages,
  cropToPixels,
  deletePages,
  describeSplit,
  duplicatePages,
  enhanceFilter,
  insertPagesAfter,
  isFullCrop,
  lastSelectedKey,
  movePage,
  pickPages,
  rectFromPoints,
  redoHistory,
  reorderPages,
  reversePages,
  rotatePages,
  scanFileName,
  shortName,
  sourceColor,
  splitGroups,
  toOrganizeOps,
  undoHistory,
  type OrganizePageItem,
} from './organizePages';

const pagesOf = (list: OrganizePageItem[]) => list.map((p) => `${p.source}:${p.page}`);

describe('organizePages: page list operations', () => {
  it('creates 1-based pages for a source', () => {
    const pages = createPages(0, 3);
    expect(pagesOf(pages)).toEqual(['0:1', '0:2', '0:3']);
    expect(new Set(pages.map((p) => p.key)).size).toBe(3);
    expect(pages.every((p) => p.rotate === 0)).toBe(true);
    expect(createPages(1, 0)).toEqual([]);
  });

  it('reorders by keys, ignoring unknown keys and appending missing ones', () => {
    const [a, b, c] = createPages(0, 3);
    const next = reorderPages([a, b, c], [c.key, 'nope', a.key]);
    expect(next.map((p) => p.key)).toEqual([c.key, a.key, b.key]);
    // same page objects are kept (no copies)
    expect(next[0]).toBe(c);
  });

  it('moves a single page left/right and clamps at the edges', () => {
    const pages = createPages(0, 4);
    const [a, b, c, d] = pages;
    expect(movePage(pages, c.key, -1).map((p) => p.key)).toEqual([a.key, c.key, b.key, d.key]);
    expect(movePage(pages, c.key, 5).map((p) => p.key)).toEqual([a.key, b.key, d.key, c.key]);
    expect(movePage(pages, a.key, -1)).toBe(pages); // already first: unchanged reference
    expect(movePage(pages, 'missing', 1)).toBe(pages);
  });

  it('rotates selected pages and normalizes the angle', () => {
    const pages = createPages(0, 2);
    const once = rotatePages(pages, [pages[0].key], 90);
    expect(once[0].rotate).toBe(90);
    expect(once[1].rotate).toBe(0);
    const back = rotatePages(once, [pages[0].key], -180);
    expect(back[0].rotate).toBe(270);
    const full = rotatePages(back, [pages[0].key], 90);
    expect(full[0].rotate).toBe(0);
    expect(rotatePages(pages, [], 90)).toBe(pages);
  });

  it('deletes pages by key', () => {
    const pages = createPages(0, 3);
    const next = deletePages(pages, [pages[1].key]);
    expect(pagesOf(next)).toEqual(['0:1', '0:3']);
    expect(deletePages(pages, [])).toBe(pages);
  });

  it('duplicates pages directly after the original with fresh keys', () => {
    const pages = createPages(0, 3);
    const { pages: next, newKeys } = duplicatePages(pages, [pages[0].key, pages[2].key]);
    expect(pagesOf(next)).toEqual(['0:1', '0:1', '0:2', '0:3', '0:3']);
    expect(newKeys).toHaveLength(2);
    expect(next[1].key).toBe(newKeys[0]);
    expect(next[1].key).not.toBe(pages[0].key);
    expect(new Set(next.map((p) => p.key)).size).toBe(5);
  });

  it('inserts pages after a key or at the end', () => {
    const pages = createPages(0, 2);
    const blank = createPages(1, 1);
    expect(pagesOf(insertPagesAfter(pages, pages[0].key, blank))).toEqual(['0:1', '1:1', '0:2']);
    expect(pagesOf(insertPagesAfter(pages, null, blank))).toEqual(['0:1', '0:2', '1:1']);
    expect(pagesOf(insertPagesAfter(pages, 'missing', blank))).toEqual(['0:1', '0:2', '1:1']);
    expect(insertPagesAfter(pages, null, [])).toBe(pages);
  });

  it('reverses, picks and converts to organize ops', () => {
    const pages = rotatePages(createPages(0, 3), [], 0);
    expect(pagesOf(reversePages(pages))).toEqual(['0:3', '0:2', '0:1']);
    expect(pagesOf(pickPages(pages, [pages[2].key, pages[0].key]))).toEqual(['0:1', '0:3']);
    const rotated = rotatePages(pages, [pages[1].key], 450);
    expect(toOrganizeOps(rotated)).toEqual([
      { source: 0, page: 1, rotate: 0 },
      { source: 0, page: 2, rotate: 90 },
      { source: 0, page: 3, rotate: 0 },
    ]);
    expect(lastSelectedKey(pages, [pages[0].key, pages[1].key])).toBe(pages[1].key);
    expect(lastSelectedKey(pages, [])).toBeNull();
  });
});

describe('organizePages: undo / redo history', () => {
  it('commits, undoes and redoes; new commits clear the redo stack', () => {
    const a = createPages(0, 1);
    const b = createPages(0, 2);
    const c = createPages(0, 3);
    let h = createHistory(a);
    expect(canUndo(h)).toBe(false);
    h = commitHistory(h, b);
    h = commitHistory(h, c);
    expect(h.present).toBe(c);
    expect(canUndo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present).toBe(b);
    expect(canRedo(h)).toBe(true);
    h = redoHistory(h);
    expect(h.present).toBe(c);
    h = undoHistory(undoHistory(h));
    expect(h.present).toBe(a);
    expect(undoHistory(h)).toBe(h); // nothing to undo
    h = commitHistory(h, b);
    expect(canRedo(h)).toBe(false);
    expect(redoHistory(h)).toBe(h);
  });

  it('is a no-op when committing the same state and respects the limit', () => {
    const a = createPages(0, 1);
    let h = createHistory(a);
    expect(commitHistory(h, a)).toBe(h);
    for (let i = 0; i < 10; i++) h = commitHistory(h, createPages(0, i), 3);
    expect(h.past).toHaveLength(3);
  });
});

describe('organizePages: split helpers', () => {
  it('computes groups for each split mode', () => {
    expect(splitGroups({ type: 'every' }, 3)).toEqual([[1], [2], [3]]);
    expect(splitGroups({ type: 'pages', pages: [3, 1, 3, 9] }, 5)).toEqual([[1], [3]]);
    expect(splitGroups({ type: 'ranges', ranges: '1-2\n4\n' }, 5)).toEqual([[1, 2], [4]]);
    expect(splitGroups({ type: 'chunk', size: 2 }, 5)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitGroups({ type: 'chunk', size: 0 }, 2)).toEqual([[1], [2]]);
    expect(() => splitGroups({ type: 'ranges', ranges: 'abc' }, 5)).toThrow();
  });

  it('describes the outcome', () => {
    expect(describeSplit(0, 0)).toBe('No pages');
    expect(describeSplit(0, 4)).toBe('No files will be produced');
    expect(describeSplit(1, 1)).toBe('1 PDF file will be produced from 1 page');
    expect(describeSplit(3, 10)).toBe('3 PDF files will be produced from 10 pages');
  });
});

describe('organizePages: sources and scan helpers', () => {
  it('assigns stable badge colors and short names', () => {
    expect(sourceColor(1)).toBe(sourceColor(1));
    expect(sourceColor(1)).not.toBe(sourceColor(2));
    expect(shortName('report.pdf')).toBe('report');
    expect(shortName('a-very-long-file-name-here.pdf', 10)).toBe('a-very-lo…');
    expect(shortName('.pdf')).toBe('.pdf');
  });

  it('clamps and converts crop rectangles', () => {
    const clamped = clampCrop({ x: -1, y: 0.5, width: 2, height: 0.8 });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBeCloseTo(0.2);
    expect(clamped.width).toBe(1);
    expect(clamped.height).toBe(0.8);
    const fromPoints = rectFromPoints({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 });
    expect(fromPoints.x).toBeCloseTo(0.2);
    expect(fromPoints.y).toBeCloseTo(0.1);
    expect(fromPoints.width).toBeCloseTo(0.6);
    expect(fromPoints.height).toBeCloseTo(0.8);
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
    expect(cropToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 400, 200)).toEqual({ sx: 100, sy: 100, sw: 200, sh: 100 });
    // never exceeds the image bounds
    expect(cropToPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ sx: 50, sy: 50, sw: 50, sh: 50 });
  });

  it('builds the enhance filter and the scan file name', () => {
    expect(enhanceFilter(false, false)).toBe('none');
    expect(enhanceFilter(true, false)).toBe('contrast(1.25) brightness(1.05)');
    expect(enhanceFilter(true, true)).toBe('contrast(1.25) brightness(1.05) grayscale(1)');
    expect(enhanceFilter(false, true)).toBe('grayscale(1)');
    expect(scanFileName(new Date(2026, 0, 5))).toBe('scan-2026-01-05.pdf');
  });
});

describe('SplitPdfTool', () => {
  it('renders the upload step with the tool title', () => {
    render(
      <Provider store={createAppStore()}>
        <MemoryRouter>
          <SplitPdfTool />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByTestId('step-upload')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Split PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeInTheDocument();
    expect(screen.queryByTestId('step-configure')).not.toBeInTheDocument();
  });
});
