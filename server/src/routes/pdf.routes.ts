import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { heavyRateLimiter } from '../middleware/rateLimit.js';
import { mergeSchema, splitSchema, pagesSchema, organizeSchema, compressSchema, repairSchema, ocrSchema } from '../validators/pdf.validators.js';
import { merge, split, removePagesCtrl, extractPagesCtrl, organize, info, compress, repair, ocr } from '../controllers/pdf.controller.js';

const router = Router();

router.post('/info', upload({ kinds: ['pdf'], multiple: false }), asyncHandler(info));
router.post('/merge', upload({ kinds: ['pdf'], maxCount: 50 }), validateBody(mergeSchema), asyncHandler(merge));
router.post('/split', upload({ kinds: ['pdf'], multiple: false }), validateBody(splitSchema), asyncHandler(split));
router.post('/remove-pages', upload({ kinds: ['pdf'], multiple: false }), validateBody(pagesSchema), asyncHandler(removePagesCtrl));
router.post('/extract-pages', upload({ kinds: ['pdf'], multiple: false }), validateBody(pagesSchema), asyncHandler(extractPagesCtrl));
router.post('/organize', upload({ kinds: ['pdf'], maxCount: 20 }), validateBody(organizeSchema), asyncHandler(organize));
router.post('/compress', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(compressSchema), asyncHandler(compress));
router.post('/repair', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(repairSchema), asyncHandler(repair));
router.post('/ocr', heavyRateLimiter, upload({ kinds: ['pdf'], multiple: false }), validateBody(ocrSchema), asyncHandler(ocr));

export default router;
