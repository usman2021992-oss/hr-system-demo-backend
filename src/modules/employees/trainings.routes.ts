import { Router } from 'express';
import { z } from 'zod';
import { listTrainings, createTraining, updateTraining, deleteTraining } from './trainings.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router({ mergeParams: true }); // mergeParams to access :id from parent

const trainingSchema = z.object({
  training_type: z.enum(['product', 'general', 'low_risk_safety', 'fire_safety']),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const hrAndAbove = ['admin', 'hr'] as const;

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager', 'store_manager', 'employee'), enforceCompany, listTrainings);
router.post('/', authenticate, requireRole(...hrAndAbove), enforceCompany, validate(trainingSchema), createTraining);
router.put('/:trainingId', authenticate, requireRole(...hrAndAbove), enforceCompany, validate(trainingSchema), updateTraining);
router.delete('/:trainingId', authenticate, requireRole(...hrAndAbove), enforceCompany, deleteTraining);

export default router;
