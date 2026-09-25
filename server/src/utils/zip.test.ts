import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import { writeZip, readZipEntries, crc32, isZip } from './zip.js';

describe('zip utils', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('round-trips text, binary and nested entries (store method)', () => {
    const binary = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256));
    const accented = 'caf' + String.fromCharCode(233) + '.txt';
    const zip = writeZip([
      { name: 'hello.txt', data: 'Hello, zip!' },
      { name: 'dir/sub/binary.bin', data: binary },
      { name: accented, data: 'unicode name' },
      { name: 'empty.txt', data: '' },
    ]);
    expect(isZip(zip)).toBe(true);
    const entries = readZipEntries(zip);
    expect([...entries.keys()].sort()).toEqual(['dir/sub/binary.bin', 'empty.txt', 'hello.txt', accented].sort());
    expect(entries.get('hello.txt')!.toString('utf8')).toBe('Hello, zip!');
    expect(Buffer.compare(entries.get('dir/sub/binary.bin')!, binary)).toBe(0);
    expect(entries.get(accented)!.toString('utf8')).toBe('unicode name');
    expect(entries.get('empty.txt')!.length).toBe(0);
  });

  it('accepts a Map of entries', () => {
    const zip = writeZip(new Map<string, string | Buffer>([['a.txt', 'A'], ['b.txt', Buffer.from('B')]]));
    const entries = readZipEntries(zip);
    expect(entries.get('a.txt')!.toString()).toBe('A');
    expect(entries.get('b.txt')!.toString()).toBe('B');
  });

  it('reads deflated archives produced by another zip writer (docx package)', async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph('Deflate test paragraph')] }] });
    const buf = await Packer.toBuffer(doc);
    expect(isZip(buf)).toBe(true);
    const entries = readZipEntries(buf);
    expect(entries.has('word/document.xml')).toBe(true);
    expect(entries.has('[Content_Types].xml')).toBe(true);
    const xml = entries.get('word/document.xml')!.toString('utf8');
    expect(xml).toContain('<w:document');
    expect(xml).toContain('Deflate test paragraph');
  });

  it('rejects data that is not a zip archive', () => {
    expect(() => readZipEntries(Buffer.from('definitely not a zip file at all'))).toThrow(/ZIP/);
    expect(isZip(Buffer.from('%PDF-1.7'))).toBe(false);
  });
});
