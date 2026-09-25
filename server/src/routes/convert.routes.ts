import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { heavyRateLimiter } from '../middleware/rateLimit.js';
import { imagesToPdfSchema, officeSchema, htmlToPdfSchema, pdfToImagesSchema, pdfToWordSchema, pdfToPptSchema, pdfToExcelSchema, pdfToPdfaSchema } from '../validators/convert.validators.js';
import { jpgToPdf, wordToPdf, pptToPdf, excelToPdf, htmlToPdfCtrl, pdfToJpg, pdfToWordCtrl, pdfToPptCtrl, pdfToExcelCtrl, pdfToPdfaCtrl } from '../controllers/convert.controller.js';

const router = Router();

router.post('/jpg-to-pdf', upload({ kinds: ['image'], maxCount: 200 }), validateBody(imagesToPdfSchema), asyncHandler(jpgToPdf));
router.post('/word-to-pdf', heavyRateLimiter, upload({ kinds: ['word'], maxCount: 10 }), validateBody(officeSchema), asyncHandler(wordToPdf));
router.post('/ppt-to-pdf', heavyRateLimiter, upload({ kinds: ['powerpoint'], maxCount: 10 }), validateBody(officeSchema), asyncHandler(pptToPdf));
router.post('/excel-to-pdf', heavyRateLimiter, upload({ kinds: ['excel'], maxCount: 10 }), validateBody(officeSchema), asyncHandler(excelToPdf));
router.post('/html-to-pdf', heavyRateLimiter, upload({ kinds: ['html'], multiple: false, required: false }), validateBody(htmlToPdfSchema), asyncHandler(htmlToPdfCtrl));

router.post('/pdf-to-jpg', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(pdfToImagesSchema), asyncHandler(pdfToJpg));
router.post('/pdf-to-word', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(pdfToWordSchema), asyncHandler(pdfToWordCtrl));
router.post('/pdf-to-ppt', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(pdfToPptSchema), asyncHandler(pdfToPptCtrl));
router.post('/pdf-to-excel', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(pdfToExcelSchema), asyncHandler(pdfToExcelCtrl));
router.post('/pdf-to-pdfa', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(pdfToPdfaSchema), asyncHandler(pdfToPdfaCtrl));

export default router;
