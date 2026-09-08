import { Router } from 'express';
import { z } from 'zod';
import { listMedicals, createMedical, updateMedical, deleteMedical } from './medicals.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router({ mergeParams: true });

const medicalSchema = z.object({
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const hrAndAbove = ['admin', 'hr'] as const;

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager', 'store_manager', 'employee'), enforceCompany, listMedicals);
router.post('/', authenticate, requireRole(...hrAndAbove), enforceCompany, validate(medicalSchema), createMedical);
router.put('/:medicalId', authenticate, requireRole(...hrAndAbove), enforceCompany, validate(medicalSchema), updateMedical);
router.delete('/:medicalId', authenticate, requireRole(...hrAndAbove), enforceCompany, deleteMedical);

export default router;
