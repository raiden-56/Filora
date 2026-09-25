/**
 * PDF -> PDF/A (1b / 2b / 3b).
 *
 * With Ghostscript installed the conversion is delegated to `gs -dPDFA` (which also handles
 * colour conversion and font embedding). Otherwise a pure pdf-lib path adds the structures
 * PDF/A requires (OutputIntent with sRGB ICC profile, XMP identification metadata, document
 * info) and strips forbidden ones (JavaScript, additional actions, embedded files for 1b/2b).
 * Fonts cannot be embedded without external tools; missing embeddings are reported.
 *
 * Both engines finish with the same built-in validation of the output file.
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFStream,
  PDFRawStream,
  PDFString,
  PDFHexString,
  PDFHeader,
  PDFNumber,
  decodePDFRawStream,
  type PDFObject,
  type PDFContext,
} from 'pdf-lib';
import { detectTools } from '../../config/tools.js';
import { config } from '../../config/index.js';
import { run } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { getSrgbIccProfile } from '../../utils/icc.js';
import type { PdfaCheck, PdfToPdfaResult } from './types.js';

export type PdfaLevel = '1b' | '2b' | '3b';

const VALIDATION_WARNING = 'Validated with built-in checks only; use veraPDF for full ISO 19005 compliance verification.';

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isoDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildXmp(opts: { part: 1 | 2 | 3; title: string; created: Date; modified: Date; producer: string }): string {
  const created = isoDate(opts.created);
  const modified = isoDate(opts.modified);
  const body = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="PDFly">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>${opts.part}</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(opts.title)}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreateDate>${created}</xmp:CreateDate>
      <xmp:ModifyDate>${modified}</xmp:ModifyDate>
      <xmp:MetadataDate>${modified}</xmp:MetadataDate>
      <xmp:CreatorTool>${xmlEscape(opts.producer)}</xmp:CreatorTool>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${xmlEscape(opts.producer)}</pdf:Producer>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
${' '.repeat(80).concat('\n').repeat(20)}<?xpacket end="w"?>`;
  return body;
}

function partOf(level: PdfaLevel): 1 | 2 | 3 {
  return level === '1b' ? 1 : level === '2b' ? 2 : 3;
}

function nameOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

function textOf(obj: PDFObject | undefined): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try {
      return obj.decodeText();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function streamBytes(stream: PDFStream): Uint8Array | null {
  try {
    if (stream instanceof PDFRawStream) {
      if (stream.dict.has(PDFName.of('Filter'))) return decodePDFRawStream(stream).decode();
      return stream.contents;
    }
    return stream.getContents();
  } catch {
    return null;
  }
}

function isJavaScriptAction(ctx: PDFContext, obj: PDFObject | undefined): boolean {
  const dict = obj instanceof PDFDict ? obj : obj instanceof PDFRef ? ctx.lookupMaybe(obj, PDFDict) : undefined;
  if (!dict) return false;
  if (nameOf(dict.get(PDFName.of('S'))) === 'JavaScript') return true;
  const next = dict.get(PDFName.of('Next'));
  if (next instanceof PDFArray) return next.asArray().some((n) => isJavaScriptAction(ctx, n));
  return next ? isJavaScriptAction(ctx, next) : false;
}

function dictHasJavaScript(ctx: PDFContext, dict: PDFDict | undefined): boolean {
  if (!dict) return false;
  for (const [, v] of dict.entries()) if (isJavaScriptAction(ctx, v)) return true;
  return false;
}

interface FontInfo {
  name: string;
  embedded: boolean;
}

function fontInfo(ctx: PDFContext, dict: PDFDict): FontInfo {
  const subtype = nameOf(dict.get(PDFName.of('Subtype')));
  const name = (nameOf(dict.get(PDFName.of('BaseFont'))) ?? nameOf(dict.get(PDFName.of('Name'))) ?? 'unnamed font').replace(/^[A-Z]{6}\+/, '');
  if (subtype === 'Type3') return { name: name || 'Type3', embedded: true };
  let host: PDFDict | undefined = dict;
  if (subtype === 'Type0') {
    const desc = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    const first = desc?.get(0);
    host = first instanceof PDFDict ? first : first instanceof PDFRef ? ctx.lookupMaybe(first, PDFDict) : undefined;
  }
  const fd = host?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const embedded = Boolean(fd && (fd.has(PDFName.of('FontFile')) || fd.has(PDFName.of('FontFile2')) || fd.has(PDFName.of('FontFile3'))));
  return { name, embedded };
}

/** Collect every font referenced by page content, form XObjects and annotation appearances. */
export function collectFonts(doc: PDFDocument): FontInfo[] {
  const ctx = doc.context;
  const fonts = new Map<string, FontInfo>();
  const visited = new Set<string>();
  const walkResources = (res: PDFDict | undefined, depth: number) => {
    if (!res || depth > 12) return;
    const fontDict = res.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (fontDict) {
      for (const [key, val] of fontDict.entries()) {
        const id = val instanceof PDFRef ? val.toString() : `${key.toString()}#${depth}#${visited.size}`;
        if (fonts.has(id)) continue;
        const d = val instanceof PDFDict ? val : val instanceof PDFRef ? ctx.lookupMaybe(val, PDFDict) : undefined;
        if (d) fonts.set(id, fontInfo(ctx, d));
      }
    }
    const xobjs = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (xobjs) {
      for (const [, val] of xobjs.entries()) {
        const id = val instanceof PDFRef ? val.toString() : null;
        if (id && visited.has(id)) continue;
        if (id) visited.add(id);
        const stream = val instanceof PDFStream ? val : val instanceof PDFRef ? ctx.lookupMaybe(val, PDFStream) : undefined;
        if (stream && nameOf(stream.dict.get(PDFName.of('Subtype'))) === 'Form') walkResources(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1);
      }
    }
  };
  for (const page of doc.getPages()) {
    walkResources(page.node.Resources(), 0);
    const annots = page.node.Annots();
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookupMaybe(i, PDFDict);
        const ap = a?.lookupMaybe(PDFName.of('AP'), PDFDict);
        const n = ap?.get(PDFName.of('N'));
        const stream = n instanceof PDFRef ? ctx.lookupMaybe(n, PDFStream) : n instanceof PDFStream ? n : undefined;
        if (stream) walkResources(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), 1);
        else if (n instanceof PDFRef || n instanceof PDFDict) {
          // appearance sub-dictionary (state -> stream)
          const sub = n instanceof PDFDict ? n : ctx.lookupMaybe(n, PDFDict);
          if (sub) for (const [, v] of sub.entries()) {
            const s = v instanceof PDFRef ? ctx.lookupMaybe(v, PDFStream) : undefined;
            if (s) walkResources(s.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), 1);
          }
        }
      }
    }
  }
  return [...fonts.values()];
}

/** Remove JavaScript actions and additional-action dictionaries. Returns the number of removals. */
function stripJavaScript(doc: PDFDocument): number {
  const ctx = doc.context;
  const catalog = doc.catalog;
  let removed = 0;
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.has(PDFName.of('JavaScript'))) {
    names.delete(PDFName.of('JavaScript'));
    removed++;
  }
  if (catalog.has(PDFName.of('AA'))) {
    catalog.delete(PDFName.of('AA'));
    removed++;
  }
  if (isJavaScriptAction(ctx, catalog.get(PDFName.of('OpenAction')))) {
    catalog.delete(PDFName.of('OpenAction'));
    removed++;
  }
  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of('AA'))) {
      page.node.delete(PDFName.of('AA'));
      removed++;
    }
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      if (a.has(PDFName.of('AA'))) {
        a.delete(PDFName.of('AA'));
        removed++;
      }
      if (isJavaScriptAction(ctx, a.get(PDFName.of('A')))) {
        a.delete(PDFName.of('A'));
        removed++;
      }
    }
  }
  // form field level actions
  const acro = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  const visitField = (ref: PDFObject, depth: number) => {
    if (depth > 20) return;
    const f = ref instanceof PDFDict ? ref : ref instanceof PDFRef ? ctx.lookupMaybe(ref, PDFDict) : undefined;
    if (!f) return;
    if (f.has(PDFName.of('AA'))) {
      f.delete(PDFName.of('AA'));
      removed++;
    }
    const kids = f.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (const k of kids.asArray()) visitField(k, depth + 1);
  };
  if (fields) for (const f of fields.asArray()) visitField(f, 0);
  return removed;
}

// ---------------------------------------------------------------------------------------
// JS engine
// ---------------------------------------------------------------------------------------

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    throw AppError.from(err, 'CORRUPTED_PDF');
  }
  if (doc.isEncrypted) throw new AppError('CORRUPTED_PDF', 'This PDF is password protected. Please remove the password first.');
  return doc;
}

async function convertWithPdfLib(inputBytes: Uint8Array, level: PdfaLevel, warnings: string[]): Promise<Uint8Array> {
  const doc = await loadPdf(inputBytes);
  const ctx = doc.context;
  const catalog = doc.catalog;
  const now = new Date();
  const title = (doc.getTitle() ?? '').trim() || 'Document';
  const created = doc.getCreationDate() ?? now;
  const producer = 'PDFly';

  // (2) OutputIntent with an sRGB ICC profile
  let icc: Buffer | null = null;
  try {
    icc = await getSrgbIccProfile();
  } catch {
    warnings.push('The sRGB ICC profile could not be generated; the OutputIntent has no embedded profile.');
  }
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
  });
  if (icc) {
    const iccStream = ctx.flateStream(icc, { N: 3, Alternate: 'DeviceRGB' });
    intent.set(PDFName.of('DestOutputProfile'), ctx.register(iccStream));
  }
  catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  // (3) XMP metadata (must not be compressed)
  const xmp = buildXmp({ part: partOf(level), title, created, modified: now, producer });
  const metaStream = ctx.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), ctx.register(metaStream));

  // (4) document info, consistent with the XMP
  doc.setTitle(title);
  doc.setProducer(producer);
  doc.setCreationDate(created);
  doc.setModificationDate(now);

  // (6) JavaScript / additional actions
  const removed = stripJavaScript(doc);
  if (removed) warnings.push(`Removed ${removed} JavaScript/action entr${removed === 1 ? 'y' : 'ies'} (not allowed in PDF/A).`);

  // embedded files: forbidden in 1b, restricted in 2b, allowed in 3b
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (level !== '3b' && names?.has(PDFName.of('EmbeddedFiles'))) {
    names.delete(PDFName.of('EmbeddedFiles'));
    warnings.push(`Embedded file attachments were removed (not allowed in PDF/A-${level}).`);
  }
  if (names && names.entries().length === 0) catalog.delete(PDFName.of('Names'));

  // (7) fonts
  const missing = collectFonts(doc).filter((f) => !f.embedded);
  if (missing.length) {
    const list = [...new Set(missing.map((f) => f.name))];
    warnings.push(`${list.length === 1 ? 'Font' : 'Fonts'} ${list.slice(0, 5).join(', ')}${list.length > 5 ? ', ...' : ''} ${list.length === 1 ? 'is' : 'are'} not embedded; PDF/A requires embedded fonts. Install Ghostscript or LibreOffice on the server to embed them.`);
  }

  // MarkInfo is not required for level B; leave as is.
  // (8) no object streams (forbidden in PDF/A-1, harmless to skip for 2/3)
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  // PDF/A-1 is based on PDF 1.4. pdf-lib always writes "%PDF-1.7"; patching the version in
  // place keeps every byte offset (and therefore the xref table) valid.
  if (level === '1b') {
    const expected = PDFHeader.forVersion(1, 7).toString().slice(0, 8);
    if (Buffer.from(out.subarray(0, 8)).toString('latin1') === expected) {
      const patched = Buffer.from('%PDF-1.4', 'latin1');
      out.set(patched, 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Ghostscript engine
// ---------------------------------------------------------------------------------------

function psString(s: string): string {
  return `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

async function convertWithGhostscript(gs: string, inputPath: string, level: PdfaLevel, workDir: string, warnings: string[]): Promise<string> {
  const outPath = path.join(workDir, `pdfa-${level}.pdf`);
  const defPath = path.join(workDir, 'PDFA_def.ps');
  let iccPath: string | null = null;
  try {
    const icc = await getSrgbIccProfile();
    iccPath = path.join(workDir, 'srgb.icc');
    await writeFile(iccPath, icc);
  } catch {
    warnings.push('The sRGB ICC profile could not be generated; the OutputIntent has no embedded profile.');
  }
  const bytes = await readFile(inputPath);
  const title = (await loadPdf(bytes)).getTitle()?.trim() || 'Document';
  const iccPs = iccPath ? psString(iccPath.replace(/\\/g, '/')) : null;
  const def = [
    '%!',
    '% PDF/A definition file generated by PDFly',
    `[ /Title ${psString(title)} /DOCINFO pdfmark`,
    ...(iccPs
      ? ['[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark', '[{icc_PDFA} << /N 3 >> /PUT pdfmark', `[{icc_PDFA} ${iccPs} (r) file /PUT pdfmark`]
      : []),
    '[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark',
    `[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 ${iccPs ? '/DestOutputProfile {icc_PDFA} ' : ''}/OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /RegistryName (http://www.color.org) >> /PUT pdfmark`,
    '[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark',
    '',
  ].join('\n');
  await writeFile(defPath, def, 'latin1');
  const args = [
    `-dPDFA=${partOf(level)}`,
    '-dBATCH',
    '-dNOPAUSE',
    '-dQUIET',
    `-dCompatibilityLevel=${level === '1b' ? '1.4' : '1.7'}`,
    '-sColorConversionStrategy=RGB',
    '-sDEVICE=pdfwrite',
    '-dPDFACompatibilityPolicy=1',
    '-dEmbedAllFonts=true',
    '-dSubsetFonts=true',
    `--permit-file-read=${workDir}${path.sep}`,
    `-sOutputFile=${outPath}`,
    defPath,
    inputPath,
  ];
  await run(gs, args, { cwd: workDir, timeoutMs: config.processTimeoutMs });
  if (!existsSync(outPath)) throw new AppError('CONVERSION_FAILED', 'Ghostscript did not produce a PDF.');
  return outPath;
}

// ---------------------------------------------------------------------------------------
// Validation (built-in)
// ---------------------------------------------------------------------------------------

export async function validatePdfa(bytes: Uint8Array, level: PdfaLevel): Promise<{ valid: boolean; checks: PdfaCheck[] }> {
  const checks: PdfaCheck[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    return { valid: false, checks: [{ name: 'File is a readable PDF', passed: false, message: err instanceof Error ? err.message : String(err) }] };
  }
  const ctx = doc.context;
  const catalog = doc.catalog;
  const part = partOf(level);

  // XMP
  {
    let passed = false;
    let message: string | undefined;
    const meta = catalog.get(PDFName.of('Metadata'));
    const stream = meta instanceof PDFRef ? ctx.lookupMaybe(meta, PDFStream) : meta instanceof PDFStream ? meta : undefined;
    if (!stream) message = 'The document has no XMP metadata stream.';
    else {
      const raw = streamBytes(stream);
      const xml = raw ? Buffer.from(raw).toString('utf8') : '';
      const partMatch = /pdfaid:part\s*(?:>\s*|=\s*")\s*(\d)/.exec(xml);
      const confMatch = /pdfaid:conformance\s*(?:>\s*|=\s*")\s*([ABU])/i.exec(xml);
      if (!partMatch || !confMatch) message = 'XMP metadata lacks pdfaid:part / pdfaid:conformance.';
      else if (Number(partMatch[1]) !== part) message = `XMP declares PDF/A-${partMatch[1]} but PDF/A-${part} was requested.`;
      else if (confMatch[1].toUpperCase() !== 'B' && confMatch[1].toUpperCase() !== 'A') message = `Unexpected conformance level ${confMatch[1]}.`;
      else passed = true;
      if (passed && stream.dict.has(PDFName.of('Filter')) && level === '1b') {
        passed = false;
        message = 'The XMP metadata stream must not be compressed in PDF/A-1.';
      }
    }
    checks.push({ name: 'XMP metadata with pdfaid identification', passed, message });
  }

  // OutputIntent
  {
    let passed = false;
    let message: string | undefined = 'No GTS_PDFA1 OutputIntent found.';
    const intents = catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
    if (intents) {
      for (let i = 0; i < intents.size(); i++) {
        const d = intents.lookupMaybe(i, PDFDict);
        if (!d || nameOf(d.get(PDFName.of('S'))) !== 'GTS_PDFA1') continue;
        const prof = d.get(PDFName.of('DestOutputProfile'));
        const stream = prof instanceof PDFRef ? ctx.lookupMaybe(prof, PDFStream) : prof instanceof PDFStream ? prof : undefined;
        if (!stream) {
          message = 'The OutputIntent has no ICC profile stream (DestOutputProfile).';
          continue;
        }
        const n = stream.dict.get(PDFName.of('N'));
        const bytes = streamBytes(stream);
        const looksIcc = bytes && bytes.length > 128 && Buffer.from(bytes.subarray(36, 40)).toString('latin1') === 'acsp';
        if (!looksIcc) {
          message = 'The DestOutputProfile stream is not a valid ICC profile.';
          continue;
        }
        if (n instanceof PDFNumber && ![1, 3, 4].includes(n.asNumber())) {
          message = 'The ICC profile has an unexpected number of components.';
          continue;
        }
        passed = true;
        message = undefined;
        break;
      }
    }
    checks.push({ name: 'OutputIntent with ICC profile', passed, message });
  }

  // encryption
  checks.push({ name: 'No encryption', passed: !doc.isEncrypted, message: doc.isEncrypted ? 'The document is encrypted.' : undefined });

  // fonts
  {
    const fonts = collectFonts(doc);
    const missing = [...new Set(fonts.filter((f) => !f.embedded).map((f) => f.name))];
    checks.push({
      name: 'All fonts embedded',
      passed: missing.length === 0,
      message: missing.length ? missing.map((n) => `Font ${n} is not embedded`).join('; ') : fonts.length ? undefined : 'No fonts used.',
    });
  }

  // JavaScript
  {
    const problems: string[] = [];
    const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names?.has(PDFName.of('JavaScript'))) problems.push('document-level JavaScript');
    if (catalog.has(PDFName.of('AA'))) problems.push('catalog additional actions');
    if (isJavaScriptAction(ctx, catalog.get(PDFName.of('OpenAction')))) problems.push('JavaScript open action');
    for (const page of doc.getPages()) {
      if (dictHasJavaScript(ctx, page.node.lookupMaybe(PDFName.of('AA'), PDFDict))) problems.push('page action');
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookupMaybe(i, PDFDict);
        if (!a) continue;
        if (isJavaScriptAction(ctx, a.get(PDFName.of('A'))) || dictHasJavaScript(ctx, a.lookupMaybe(PDFName.of('AA'), PDFDict))) problems.push('annotation action');
      }
    }
    checks.push({ name: 'No JavaScript', passed: problems.length === 0, message: problems.length ? `Found ${[...new Set(problems)].join(', ')}.` : undefined });
  }

  // embedded files
  {
    const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const has = Boolean(names?.has(PDFName.of('EmbeddedFiles')));
    if (level === '3b') checks.push({ name: 'No embedded files (1b/2b)', passed: true, message: has ? 'Embedded files are allowed in PDF/A-3.' : undefined });
    else checks.push({ name: 'No embedded files (1b/2b)', passed: !has, message: has ? `Embedded files are not allowed in PDF/A-${level}.` : undefined });
  }

  return { valid: checks.every((c) => c.passed), checks };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export async function pdfToPdfa(pdfPath: string, workDir: string, opts: { level: PdfaLevel }): Promise<PdfToPdfaResult> {
  const level = opts.level ?? '2b';
  const tools = await detectTools();
  const warnings: string[] = [];
  let engine: PdfToPdfaResult['engine'] = 'js';
  let outPath: string | null = null;

  if (tools.ghostscript) {
    try {
      outPath = await convertWithGhostscript(tools.ghostscript, pdfPath, level, workDir, warnings);
      engine = 'ghostscript';
    } catch (err) {
      if (err instanceof AppError && (err.code === 'CORRUPTED_PDF' || err.code === 'TIMEOUT')) throw err;
      warnings.push('Ghostscript failed to convert this file; the built-in converter was used instead.');
      outPath = null;
    }
  }

  if (!outPath) {
    const input = await readFile(pdfPath);
    const bytes = await convertWithPdfLib(input, level, warnings);
    outPath = path.join(workDir, `pdfa-${level}.pdf`);
    await writeFile(outPath, bytes);
    engine = 'js';
  }

  const output = await readFile(outPath);
  const validation = await validatePdfa(output, level);
  warnings.push(VALIDATION_WARNING);
  return {
    pdfPath: outPath,
    engine,
    level,
    validation: { valid: validation.valid, validator: 'built-in', checks: validation.checks },
    warnings: [...new Set(warnings)],
  };
}
