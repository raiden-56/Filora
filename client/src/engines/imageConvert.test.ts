import { describe, expect, it } from 'vitest';
import { SAFE_CANVAS_PIXELS, convertedName, fitWithinPixels, isHeifBytes } from './imageConvert';
import { latin1Encode } from './common';

describe('imageConvert helpers', () => {
  it('recognises HEIC/HEIF headers only', () => {
    const head = (brand: string) => latin1Encode(`\0\0\0\x18ftyp${brand}\0\0\0\0`);
    expect(isHeifBytes(head('heic'))).toBe(true);
    expect(isHeifBytes(head('heix'))).toBe(true);
    expect(isHeifBytes(head('mif1'))).toBe(true);
    expect(isHeifBytes(head('isom'))).toBe(false);
    expect(isHeifBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });

  it('names outputs after the source file', () => {
    expect(convertedName('IMG_0001.HEIC', 'jpeg')).toBe('IMG_0001.jpg');
    expect(convertedName('holiday.photo.heif', 'jpeg')).toBe('holiday.photo.jpg');
    expect(convertedName('scan.jpeg', 'png')).toBe('scan.png');
    expect(convertedName('.hidden', 'png')).toBe('.hidden.png');
  });

  it('scales oversized images down to the canvas limit, keeping the aspect ratio', () => {
    expect(fitWithinPixels(4032, 3024, SAFE_CANVAS_PIXELS)).toEqual({ width: 4032, height: 3024 });
    const big = fitWithinPixels(8064, 6048, SAFE_CANVAS_PIXELS); // 48 MP iPhone photo
    expect(big.width * big.height).toBeLessThanOrEqual(SAFE_CANVAS_PIXELS);
    expect(big.width / big.height).toBeCloseTo(8064 / 6048, 2);
  });
});
