import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { generateQr } from '../controllers/qrController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// Managers generate QR for any company shift.
// Employees may also call this, but only for a shift assigned to them (enforced in controller).
router.get('/generate', asyncHandler(generateQr));

export default router;
