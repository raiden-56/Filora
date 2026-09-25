import { Router } from 'express';
import { ok } from '../utils/response.js';
import { detectTools } from '../config/tools.js';
import { config } from '../config/index.js';
import { asyncHandler } from '../middleware/validate.js';
import { OCR_LANGUAGES } from '../services/optimize/languages.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tools = await detectTools();
    ok(res, {
      status: 'ok',
      version: '1.0.0',
      libreoffice: Boolean(tools.soffice),
      ghostscript: Boolean(tools.ghostscript),
      qpdf: Boolean(tools.qpdf),
      tesseract: Boolean(tools.tesseract) || true, // tesseract.js is always available as fallback
      nativeTesseract: Boolean(tools.tesseract),
      puppeteer: tools.puppeteer,
      maxFileSizeMb: config.maxFileSizeMb,
      fileTtlMinutes: config.fileTtlMinutes,
      ocrLanguages: OCR_LANGUAGES,
    });
  }),
);

export default router;
