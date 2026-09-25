import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { listStoredFiles, getStoredFile, downloadStoredFile, deleteStoredFile, renameFile } from '../controllers/files.controller.js';

const router = Router();

router.get('/', asyncHandler(listStoredFiles));
router.get('/:id', asyncHandler(getStoredFile));
router.get('/:id/download', asyncHandler(downloadStoredFile));
router.patch('/:id', validateBody(z.object({ name: z.string().min(1).max(200) })), asyncHandler(renameFile));
router.delete('/:id', asyncHandler(deleteStoredFile));

export default router;
