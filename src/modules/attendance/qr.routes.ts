import { Router } from 'express';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { generateQr } from './attendance.controller';

const router = Router();

// GET /api/qr/generate?store_id=N
// store_manager and above can generate QR codes
// NOTE: No requireModulePermission — QR generation is essential for attendance
// actions which must always work regardless of module toggle.
router.get(
  '/generate',
  authenticate,
  requireRole('admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'),
  enforceCompany,
  generateQr,
);

export default router;
