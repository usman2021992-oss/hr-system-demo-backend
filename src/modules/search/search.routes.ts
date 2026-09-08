import { Router } from 'express';
import { globalSearch } from './search.controller';
import { authenticate, requireRole } from '../../middleware/auth';

const router = Router();

// Allow super admins, company admins, HR, and area managers to perform global search
router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager', 'system_admin'), globalSearch);

export default router;
