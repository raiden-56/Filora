import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { rotateSchema, pageNumbersSchema, watermarkSchema, cropSchema, editSchema, formsSchema } from '../validators/edit.validators.js';
import { rotate, pageNumbers, watermark, crop, edit, forms } from '../controllers/edit.controller.js';

const router = Router();

router.post('/rotate', upload({ kinds: ['pdf'], multiple: false }), validateBody(rotateSchema), asyncHandler(rotate));
router.post('/page-numbers', upload({ kinds: ['pdf'], multiple: false }), validateBody(pageNumbersSchema), asyncHandler(pageNumbers));
router.post('/watermark', upload({ kinds: ['pdf'], multiple: false, extra: [{ field: 'image', kinds: ['image'] }] }), validateBody(watermarkSchema), asyncHandler(watermark));
router.post('/crop', upload({ kinds: ['pdf'], multiple: false }), validateBody(cropSchema), asyncHandler(crop));
router.post('/forms', upload({ kinds: ['pdf'], multiple: false }), validateBody(formsSchema), asyncHandler(forms));
router.post('/', upload({ kinds: ['pdf'], multiple: false }), validateBody(editSchema), asyncHandler(edit));

export default router;
