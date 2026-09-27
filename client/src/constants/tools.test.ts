import { describe, it, expect } from 'vitest';
import { TOOLS, CATEGORIES, searchTools, toolPath, TOOL_BY_SLUG, toolsInCategory, categoryPath } from './tools';

describe('tool registry', () => {
  it('has 29 tools across 6 categories with unique ids and slugs', () => {
    expect(TOOLS).toHaveLength(29);
    expect(CATEGORIES).toHaveLength(6);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(29);
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(29);
    expect(toolsInCategory('organize').map((t) => t.name)).toEqual(['Merge PDF', 'Split PDF', 'Remove Pages', 'Extract Pages', 'Organize PDF', 'Scan to PDF']);
    expect(toolsInCategory('optimize')).toHaveLength(3);
    expect(toolsInCategory('convert-to')).toHaveLength(5);
    expect(toolsInCategory('convert-from')).toHaveLength(5);
    expect(toolsInCategory('edit')).toHaveLength(6);
    expect(toolsInCategory('image').map((t) => t.name)).toEqual(['HEIC to JPG', 'HEIF to JPG', 'JPG to PNG', 'PNG to JPG']);
  });

  it('builds paths', () => {
    expect(toolPath(TOOL_BY_SLUG['merge-pdf'])).toBe('/tools/merge-pdf');
    expect(toolPath('split-pdf')).toBe('/tools/split-pdf');
    expect(categoryPath('convert-to')).toBe('/convert-to-pdf');
  });

  it('search finds tools by keyword', () => {
    const jpg = searchTools('jpg').map((t) => t.name);
    expect(jpg).toContain('JPG to PDF');
    expect(jpg).toContain('PDF to JPG');
    expect(searchTools('compress').map((t) => t.name)[0]).toBe('Compress PDF');
    expect(searchTools('heic').map((t) => t.name)).toEqual(['HEIC to JPG', 'HEIF to JPG']);
    expect(searchTools('png to jpg')[0].name).toBe('PNG to JPG');
    expect(searchTools('  ')).toHaveLength(29);
    expect(searchTools('zzzz')).toHaveLength(0);
    expect(searchTools('word to pdf')[0].name).toBe('Word to PDF');
  });
});
