/**
 * Obtain an sRGB ICC profile without shipping a binary: sharp bundles one (libvips) and
 * writes it into JPEG APP2 "ICC_PROFILE" segments when asked to. We generate a 1x1 JPEG,
 * pull the segments back out and cache the result.
 */
import sharp from 'sharp';

let cached: Promise<Buffer> | null = null;

function extractIccFromJpeg(jpeg: Buffer): Buffer | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  const chunks: { seq: number; data: Buffer }[] = [];
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = jpeg.readUInt16BE(i + 2);
    if (marker === 0xe2 && len > 16) {
      const seg = jpeg.subarray(i + 4, i + 2 + len);
      if (seg.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0') {
        chunks.push({ seq: seg[12], data: Buffer.from(seg.subarray(14)) });
      }
    }
    i += 2 + len;
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return Buffer.concat(chunks.map((c) => c.data));
}

/** True when the buffer looks like an ICC profile (magic 'acsp' at byte 36). */
export function isIccProfile(buf: Buffer | null | undefined): buf is Buffer {
  return Boolean(buf && buf.length > 128 && buf.subarray(36, 40).toString('latin1') === 'acsp');
}

/** Returns the bundled sRGB ICC profile bytes. Throws if it cannot be obtained. */
export function getSrgbIccProfile(): Promise<Buffer> {
  if (!cached) {
    cached = (async () => {
      const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } })
        .jpeg()
        .withMetadata({ icc: 'srgb' })
        .toBuffer();
      let icc = extractIccFromJpeg(jpeg);
      if (!isIccProfile(icc)) {
        // Fallback: let sharp parse the metadata for us.
        const meta = await sharp(jpeg).metadata();
        icc = meta.icc ? Buffer.from(meta.icc) : null;
      }
      if (!isIccProfile(icc)) throw new Error('Could not extract an sRGB ICC profile from sharp');
      return icc;
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
