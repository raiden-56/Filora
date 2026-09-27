import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFRef, StandardFonts, PDFString, decodePDFRawStream } from 'pdf-lib';
import { collectFonts, pdfToPdfa, validatePdfa } from './pdfToPdfa';
import { buildSrgbIccProfile, getSrgbIccProfile, isIccProfile } from './srgbIcc';
import { latin1Decode, utf8Decode } from './common';

async function makeTextPdf(withJs = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample document');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Archive me please', { x: 50, y: 750, size: 18, font });
  if (withJs) {
    const ctx = doc.context;
    const js = ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("hi")') });
    doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js));
    const names = ctx.obj({ JavaScript: ctx.obj({ Names: ctx.obj([PDFString.of('a'), ctx.register(js)]) }) });
    doc.catalog.set(PDFName.of('Names'), names);
    doc.catalog.set(PDFName.of('AA'), ctx.obj({ WC: ctx.register(js) }));
  }
  return doc.save();
}

function metadataXml(doc: PDFDocument): string {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  expect(ref).toBeInstanceOf(PDFRef);
  const stream = doc.context.lookup(ref as PDFRef, PDFStream);
  const bytes = stream instanceof PDFRawStream && stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : (stream as PDFRawStream).contents;
  return utf8Decode(bytes);
}

describe('sRGB ICC profile', () => {
  it('builds a structurally valid v2 RGB display profile', () => {
    const icc = buildSrgbIccProfile();
    expect(isIccProfile(icc)).toBe(true);
    expect(latin1Decode(icc.subarray(36, 40))).toBe('acsp');
    expect(latin1Decode(icc.subarray(12, 16))).toBe('mntr');
    expect(latin1Decode(icc.subarray(16, 20))).toBe('RGB ');
    expect(latin1Decode(icc.subarray(20, 24))).toBe('XYZ ');
    const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
    expect(view.getUint32(0)).toBe(icc.length);
    const tagCount = view.getUint32(128);
    expect(tagCount).toBe(9);
    const sigs: string[] = [];
    for (let i = 0; i < tagCount; i++) {
      const at = 132 + i * 12;
      sigs.push(latin1Decode(icc.subarray(at, at + 4)));
      const offset = view.getUint32(at + 4);
      const size = view.getUint32(at + 8);
      expect(offset % 4).toBe(0);
      expect(offset + size).toBeLessThanOrEqual(icc.length);
    }
    expect([...sigs].sort()).toEqual(['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt']);
    expect(sigs).toEqual([...sigs].sort());
    // cached
    expect(getSrgbIccProfile()).toBe(getSrgbIccProfile());
  });
});

describe('pdfToPdfa', () => {
  it('adds OutputIntent + XMP and reports non-embedded standard fonts', async () => {
    const r = await pdfToPdfa(await makeTextPdf(), { level: '2b' });
    expect(r.engine).toBe('js');
    expect(r.level).toBe('2b');
    expect(r.validation.validator).toBe('built-in');
    expect(r.warnings).toContain('Validated with built-in checks only; use veraPDF for full ISO 19005 compliance verification.');
    expect(r.validation.checks.map((c) => c.name)).toEqual([
      'XMP metadata with pdfaid identification',
      'OutputIntent with ICC profile',
      'No encryption',
      'All fonts embedded',
      'No JavaScript',
      'No embedded files (1b/2b)',
    ]);
    const byName = Object.fromEntries(r.validation.checks.map((c) => [c.name, c]));
    expect(byName['XMP metadata with pdfaid identification'].passed).toBe(true);
    expect(byName['OutputIntent with ICC profile'].passed).toBe(true);
    expect(byName['No encryption'].passed).toBe(true);
    expect(byName['No JavaScript'].passed).toBe(true);
    expect(byName['No embedded files (1b/2b)'].passed).toBe(true);
    // the standard Helvetica font is not embedded and the browser cannot embed it
    expect(byName['All fonts embedded'].passed).toBe(false);
    expect(byName['All fonts embedded'].message).toMatch(/Font Helvetica is not embedded/);
    expect(r.validation.valid).toBe(false);
    expect(r.warnings.some((w) => /Helvetica/.test(w))).toBe(true);

    const out = await PDFDocument.load(r.pdf, { updateMetadata: false });
    expect(out.getPageCount()).toBe(1);
    expect(out.getTitle()).toBe('Sample document');
    expect(out.getProducer()).toBe('PDFly');
    const intents = out.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    const profile = out.context.lookup(intent.get(PDFName.of('DestOutputProfile')) as PDFRef, PDFStream);
    expect(profile).toBeInstanceOf(PDFStream);
    const xmp = metadataXml(out);
    expect(xmp).toContain('pdfaid:part>2<');
    expect(xmp).toContain('pdfaid:conformance>B<');
    expect(xmp).toContain('Sample document');
    expect(latin1Decode(r.pdf.subarray(0, 8))).toBe('%PDF-1.7');
    const meta = out.context.lookup(out.catalog.get(PDFName.of('Metadata')) as PDFRef, PDFStream);
    expect(meta.dict.has(PDFName.of('Filter'))).toBe(false);
  });

  it('produces a PDF 1.4 header and part=1 for level 1b', async () => {
    const r = await pdfToPdfa(await makeTextPdf(), { level: '1b' });
    const out = await PDFDocument.load(r.pdf, { updateMetadata: false });
    expect(metadataXml(out)).toContain('pdfaid:part>1<');
    expect(latin1Decode(r.pdf.subarray(0, 8))).toBe('%PDF-1.4');
    expect(r.validation.checks.find((c) => c.name === 'XMP metadata with pdfaid identification')?.passed).toBe(true);
  });

  it('validates a page-only document (no fonts) as compliant with the built-in checks', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    const r = await pdfToPdfa(await doc.save(), { level: '3b' });
    expect(r.validation.checks.find((c) => c.name === 'All fonts embedded')?.passed).toBe(true);
    expect(r.validation.valid).toBe(true);
    expect(metadataXml(await PDFDocument.load(r.pdf))).toContain('pdfaid:part>3<');
  });

  it('strips JavaScript actions', async () => {
    const input = await makeTextPdf(true);
    const before = await validatePdfa(input, '2b');
    expect(before.valid).toBe(false);
    expect(before.checks.find((c) => c.name === 'No JavaScript')?.passed).toBe(false);
    const r = await pdfToPdfa(input, { level: '2b' });
    expect(r.validation.checks.find((c) => c.name === 'No JavaScript')?.passed).toBe(true);
    expect(r.warnings.some((w) => /JavaScript/.test(w))).toBe(true);
    const out = await PDFDocument.load(r.pdf);
    expect(out.catalog.has(PDFName.of('AA'))).toBe(false);
    expect(out.catalog.has(PDFName.of('OpenAction'))).toBe(false);
  });

  it('collectFonts lists fonts used on pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    doc.addPage().drawText('x', { font });
    const reloaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(collectFonts(reloaded)).toEqual([{ name: 'Times-Roman', embedded: false }]);
  });

  it('rejects a corrupted input', async () => {
    await expect(pdfToPdfa(new TextEncoder().encode('this is not a pdf'), { level: '2b' })).rejects.toMatchObject({ code: 'CORRUPTED_PDF' });
  });
});
