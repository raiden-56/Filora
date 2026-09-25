import { describe, it, expect } from 'vitest';
import {
  parsePageSelection,
  parsePageRangeGroups,
  formatBytes,
  sanitizeFilename,
  withSuffix,
  normalizeAngle,
  resolvePageSize,
} from './utils';

describe('parsePageSelection', () => {
  it('parses ranges and single pages', () => {
    expect(parsePageSelection('1-3, 5, 8-10', 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });
  it('de-duplicates and sorts', () => {
    expect(parsePageSelection('5,1,3-5', 10)).toEqual([1, 3, 4, 5]);
  });
  it('drops out of range pages', () => {
    expect(parsePageSelection('1-20', 3)).toEqual([1, 2, 3]);
  });
  it('accepts reversed ranges', () => {
    expect(parsePageSelection('4-2', 10)).toEqual([2, 3, 4]);
  });
  it('throws on invalid syntax', () => {
    expect(() => parsePageSelection('a-b', 10)).toThrow();
    expect(() => parsePageSelection('1--3', 10)).toThrow();
  });
  it('handles empty input', () => {
    expect(parsePageSelection('', 10)).toEqual([]);
  });
});

describe('parsePageRangeGroups', () => {
  it('splits by newline and comma', () => {
    expect(parsePageRangeGroups('1-3\n5-7\n10', 10)).toEqual([[1, 2, 3], [5, 6, 7], [10]]);
    expect(parsePageRangeGroups('1-2, 4', 10)).toEqual([[1, 2], [4]]);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
  });
});

describe('sanitizeFilename', () => {
  it('removes dangerous characters and traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('_._etc_passwd');
    expect(sanitizeFilename('my file:v2?.pdf')).toBe('my file_v2_.pdf');
    expect(sanitizeFilename('')).toBe('file');
  });
  it('adds suffix', () => {
    expect(withSuffix('report.pdf', '-merged')).toBe('report-merged.pdf');
    expect(withSuffix('report', '-x', 'zip')).toBe('report-x.zip');
  });
});

describe('normalizeAngle', () => {
  it('wraps to 0-359', () => {
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(360)).toBe(0);
  });
});

describe('resolvePageSize', () => {
  it('returns landscape/portrait dimensions', () => {
    expect(resolvePageSize('A4', 'portrait')).toEqual([595.28, 841.89]);
    expect(resolvePageSize('A4', 'landscape')).toEqual([841.89, 595.28]);
    expect(resolvePageSize('Custom', 'portrait', { width: 300, height: 200 })).toEqual([200, 300]);
  });
});
