import { Router } from 'express';
import { getAutomations, updateAutomation } from './automations.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, getAutomations);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, updateAutomation);

export default router;
