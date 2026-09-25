import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFRef, StandardFonts, PDFString, decodePDFRawStream } from 'pdf-lib';
import { pdfToPdfa, validatePdfa, collectFonts } from './pdfToPdfa.js';
import { createWorkDir } from '../../utils/tmp.js';
import { getSrgbIccProfile, isIccProfile } from '../../utils/icc.js';
import { extractText } from '../render.js';

let dir: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  const w = await createWorkDir('pdfa-test');
  dir = w.dir;
  cleanup = w.cleanup;
});
afterAll(async () => {
  await cleanup();
});

async function makeTextPdf(file: string, withJs = false): Promise<string> {
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
  const p = path.join(dir, file);
  await writeFile(p, await doc.save());
  return p;
}

function metadataXml(doc: PDFDocument): string {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  expect(ref).toBeInstanceOf(PDFRef);
  const stream = doc.context.lookup(ref as PDFRef, PDFStream);
  const bytes = stream instanceof PDFRawStream && stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : (stream as PDFRawStream).contents;
  return Buffer.from(bytes).toString('utf8');
}

describe('sRGB ICC profile', () => {
  it('extracts a valid ICC profile from sharp', async () => {
    const icc = await getSrgbIccProfile();
    expect(isIccProfile(icc)).toBe(true);
    expect(icc.subarray(36, 40).toString('latin1')).toBe('acsp');
    expect(icc.subarray(16, 20).toString('latin1')).toBe('RGB ');
    // cached
    expect(await getSrgbIccProfile()).toBe(icc);
  });
});

describe('pdfToPdfa', () => {
  it('adds OutputIntent + XMP and reports non-embedded standard fonts', async () => {
    const input = await makeTextPdf('sample.pdf');
    const r = await pdfToPdfa(input, dir, { level: '2b' });
    expect(['ghostscript', 'libreoffice', 'js']).toContain(r.engine);
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

    const bytes = await readFile(r.pdfPath);
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(1);
    expect(out.getTitle()).toBe('Sample document');
    expect(out.getProducer()).toBe('PDFly');
    const intents = out.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    expect(intents.size()).toBeGreaterThanOrEqual(1);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    const profile = out.context.lookup(intent.get(PDFName.of('DestOutputProfile')) as PDFRef, PDFStream);
    expect(profile).toBeInstanceOf(PDFStream);
    const xmp = metadataXml(out);
    expect(xmp).toContain('pdfaid:part>2<');
    expect(xmp).toContain('pdfaid:conformance>B<');
    expect(xmp).toContain('Sample document');
    expect(xmp).toContain('<?xpacket begin=');
    const text = (await extractText(new Uint8Array(bytes))).map((p) => p.text).join('');
    expect(text).toContain('Archive me please');

    if (r.engine === 'js') {
      // the standard Helvetica font is not embedded and the JS engine cannot embed it
      expect(byName['All fonts embedded'].passed).toBe(false);
      expect(byName['All fonts embedded'].message).toMatch(/Font Helvetica is not embedded/);
      expect(r.validation.valid).toBe(false);
      expect(r.warnings.some((w) => /Helvetica/.test(w))).toBe(true);
      expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
      // PDF/A metadata streams must be unfiltered
      const meta = out.context.lookup(out.catalog.get(PDFName.of('Metadata')) as PDFRef, PDFStream);
      expect(meta.dict.has(PDFName.of('Filter'))).toBe(false);
    }
  });

  it('produces a PDF 1.4 header and part=1 for level 1b', async () => {
    const input = await makeTextPdf('sample1b.pdf');
    const r = await pdfToPdfa(input, dir, { level: '1b' });
    const bytes = await readFile(r.pdfPath);
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(metadataXml(out)).toContain('pdfaid:part>1<');
    if (r.engine === 'js') expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(r.validation.checks.find((c) => c.name === 'XMP metadata with pdfaid identification')?.passed).toBe(true);
  });

  it('validates a page-only document (no fonts) as compliant with the built-in checks', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    const input = path.join(dir, 'blank.pdf');
    await writeFile(input, await doc.save());
    const r = await pdfToPdfa(input, dir, { level: '3b' });
    expect(r.validation.checks.find((c) => c.name === 'All fonts embedded')?.passed).toBe(true);
    expect(r.validation.valid).toBe(true);
    expect(r.level).toBe('3b');
    const out = await PDFDocument.load(await readFile(r.pdfPath));
    expect(metadataXml(out)).toContain('pdfaid:part>3<');
  });

  it('strips JavaScript actions', async () => {
    const input = await makeTextPdf('js.pdf', true);
    const before = await validatePdfa(await readFile(input), '2b');
    expect(before.valid).toBe(false);
    expect(before.checks.find((c) => c.name === 'No JavaScript')?.passed).toBe(false);
    const r = await pdfToPdfa(input, dir, { level: '2b' });
    const check = r.validation.checks.find((c) => c.name === 'No JavaScript');
    expect(check?.passed).toBe(true);
    if (r.engine === 'js') expect(r.warnings.some((w) => /JavaScript/.test(w))).toBe(true);
    const out = await PDFDocument.load(await readFile(r.pdfPath));
    expect(out.catalog.has(PDFName.of('AA'))).toBe(false);
    expect(out.catalog.has(PDFName.of('OpenAction'))).toBe(false);
  });

  it('fails validation for a plain (non-archival) PDF', async () => {
    const input = await makeTextPdf('plain.pdf');
    const v = await validatePdfa(await readFile(input), '2b');
    expect(v.valid).toBe(false);
    expect(v.checks.find((c) => c.name === 'XMP metadata with pdfaid identification')?.passed).toBe(false);
    expect(v.checks.find((c) => c.name === 'OutputIntent with ICC profile')?.passed).toBe(false);
    expect(v.checks.find((c) => c.name === 'No encryption')?.passed).toBe(true);
  });

  it('collectFonts lists fonts used on pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    doc.addPage().drawText('x', { font });
    // font objects are materialised on save; re-load like the service does
    const reloaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    const fonts = collectFonts(reloaded);
    expect(fonts).toEqual([{ name: 'Times-Roman', embedded: false }]);
  });

  it('rejects a corrupted input', async () => {
    const input = path.join(dir, 'broken.pdf');
    await writeFile(input, 'this is not a pdf');
    await expect(pdfToPdfa(input, dir, { level: '2b' })).rejects.toMatchObject({ code: 'CORRUPTED_PDF' });
  });
});
