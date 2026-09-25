import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './index.js';

export type ExternalTool = 'soffice' | 'ghostscript' | 'qpdf' | 'tesseract' | 'pdftoppm' | 'ocrmypdf';

export interface ToolAvailability {
  soffice: string | null;
  ghostscript: string | null;
  qpdf: string | null;
  tesseract: string | null;
  pdftoppm: string | null;
  ocrmypdf: string | null;
  puppeteer: boolean;
}

const CANDIDATES: Record<ExternalTool, string[]> = {
  soffice: [
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/opt/libreoffice/program/soffice',
  ],
  ghostscript: ['gs', 'gswin64c', 'gswin32c', '/usr/bin/gs', '/usr/local/bin/gs'],
  qpdf: ['qpdf', 'C:\\Program Files\\qpdf\\bin\\qpdf.exe', '/usr/bin/qpdf', '/usr/local/bin/qpdf'],
  tesseract: ['tesseract', 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe', '/usr/bin/tesseract', '/usr/local/bin/tesseract'],
  pdftoppm: ['pdftoppm', '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm'],
  ocrmypdf: ['ocrmypdf', '/usr/bin/ocrmypdf', '/usr/local/bin/ocrmypdf'],
};

const VERSION_ARGS: Record<ExternalTool, string[]> = {
  soffice: ['--version'],
  ghostscript: ['--version'],
  qpdf: ['--version'],
  tesseract: ['--version'],
  pdftoppm: ['-v'],
  ocrmypdf: ['--version'],
};

function tryRun(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = execFile(bin, args, { timeout: 15000, windowsHide: true }, (err) => {
        // pdftoppm -v exits with 0 or 99 depending on version; treat "ran" as success
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve(false);
        resolve(true);
      });
      child.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

async function locate(tool: ExternalTool): Promise<string | null> {
  const explicit = config.bin[tool as keyof typeof config.bin];
  const candidates = explicit ? [explicit, ...CANDIDATES[tool]] : CANDIDATES[tool];
  for (const c of candidates) {
    if (path.isAbsolute(c) && !existsSync(c)) continue;
    if (await tryRun(c, VERSION_ARGS[tool])) return c;
  }
  return null;
}

let cached: ToolAvailability | null = null;
let detecting: Promise<ToolAvailability> | null = null;

async function puppeteerAvailable(): Promise<boolean> {
  try {
    const puppeteer = await import('puppeteer');
    const p = puppeteer.default.executablePath();
    return Boolean(p && existsSync(p));
  } catch {
    return false;
  }
}

/** Detect which optional external tools are installed. Cached after first call. */
export function detectTools(force = false): Promise<ToolAvailability> {
  if (cached && !force) return Promise.resolve(cached);
  if (detecting && !force) return detecting;
  detecting = (async () => {
    const [soffice, ghostscript, qpdf, tesseract, pdftoppm, ocrmypdf, puppeteer] = await Promise.all([
      locate('soffice'),
      locate('ghostscript'),
      locate('qpdf'),
      locate('tesseract'),
      locate('pdftoppm'),
      locate('ocrmypdf'),
      puppeteerAvailable(),
    ]);
    cached = { soffice, ghostscript, qpdf, tesseract, pdftoppm, ocrmypdf, puppeteer };
    return cached;
  })();
  return detecting;
}

export function getToolsSync(): ToolAvailability | null {
  return cached;
}
