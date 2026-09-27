import { describe, expect, it } from 'vitest';
import { assertNotAborted, base64ToBytes, bytesToBase64, concatBytes, inflate, latin1Decode, latin1Encode, looksLikePdf, messageOf } from './common';

describe('engine helpers', () => {
  it('latin1 round-trips every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(Array.from(latin1Encode(latin1Decode(bytes)))).toEqual(Array.from(bytes));
  });

  it('base64 round-trips and concatenates', () => {
    const a = Uint8Array.from([1, 2, 3]);
    const b = Uint8Array.from([250, 251]);
    const joined = concatBytes([a, b]);
    expect(Array.from(joined)).toEqual([1, 2, 3, 250, 251]);
    expect(Array.from(base64ToBytes(bytesToBase64(joined)))).toEqual(Array.from(joined));
  });

  it('inflates zlib and raw deflate streams', async () => {
    const text = 'hello hello hello hello';
    const zlib = new Uint8Array(await new Response(new Response(text).body!.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const raw = new Uint8Array(await new Response(new Response(text).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    expect(new TextDecoder().decode(await inflate(zlib, 'deflate'))).toBe(text);
    expect(new TextDecoder().decode(await inflate(raw, 'deflate-raw'))).toBe(text);
  });

  it('detects PDF headers and reports cancellation', () => {
    expect(looksLikePdf(latin1Encode('%PDF-1.4\n'))).toBe(true);
    expect(looksLikePdf(latin1Encode('nope'))).toBe(false);
    const c = new AbortController();
    expect(() => assertNotAborted(c.signal)).not.toThrow();
    c.abort();
    expect(() => assertNotAborted(c.signal)).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
    expect(messageOf(new Error('first line\nsecond'))).toBe('first line');
    expect(messageOf({ code: 'X', message: 'obj' })).toBe('obj');
  });
});
