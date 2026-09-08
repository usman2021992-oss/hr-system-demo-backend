import { Router } from 'express';
import { z } from 'zod';
import { authenticate, enforceCompany, requireModulePermission, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  listTransfers,
  getTransfer,
  listTransferShifts,
  createTransfer,
  updateTransfer,
  deleteTransfer,
  cancelTransfer,
  completeTransfer,
  listTransferBlocks,
  listTransferGuests,
  getEmployeeUnifiedSchedule,
} from './transfers.controller';

const router = Router();

const readRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const writeRoles = ['admin', 'hr', 'area_manager'] as const;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const createTransferSchema = z.object({
  user_id: z.number().int().positive(),
  origin_store_id: z.number().int().positive().optional().nullable(),
  target_store_id: z.number().int().positive(),
  start_date: z.string().regex(isoDate, 'Formato data non valido (YYYY-MM-DD)'),
  end_date: z.string().regex(isoDate, 'Formato data non valido (YYYY-MM-DD)'),
  cancel_origin_shifts: z.boolean().optional(),
  reason: z.string().max(500).optional().nullable(),
  notes: z.string().max(1500).optional().nullable(),
  target_company_id: z.number().int().positive().optional().nullable(),
}).refine((data) => data.start_date <= data.end_date, {
  message: 'La data di inizio non puo essere successiva alla data di fine',
  path: ['end_date'],
});

const updateTransferSchema = z.object({
  origin_store_id: z.number().int().positive().optional().nullable(),
  target_store_id: z.number().int().positive().optional(),
  start_date: z.string().regex(isoDate, 'Formato data non valido (YYYY-MM-DD)').optional(),
  end_date: z.string().regex(isoDate, 'Formato data non valido (YYYY-MM-DD)').optional(),
  cancel_origin_shifts: z.boolean().optional(),
  reason: z.string().max(500).optional().nullable(),
  notes: z.string().max(1500).optional().nullable(),
  target_company_id: z.number().int().positive().optional().nullable(),
}).refine((data) => (
  data.origin_store_id !== undefined
  || data.target_store_id !== undefined
  || data.start_date !== undefined
  || data.end_date !== undefined
  || data.cancel_origin_shifts !== undefined
  || data.reason !== undefined
  || data.notes !== undefined
), {
  message: 'Nessuna modifica fornita',
});

const cancelSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
  restore_origin_shifts: z.boolean().optional(),
});

router.get(
  '/blocks',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  listTransferBlocks,
);

router.get(
  '/guests',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  listTransferGuests,
);

router.get(
  '/employee-schedule/:userId',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  getEmployeeUnifiedSchedule,
);

router.get(
  '/',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  listTransfers,
);

router.get(
  '/:id/shifts',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  listTransferShifts,
);

router.get(
  '/:id',
  authenticate,
  enforceCompany,
  requireRole(...readRoles),
  requireModulePermission('trasferimenti', 'read'),
  getTransfer,
);

router.post(
  '/',
  authenticate,
  enforceCompany,
  requireRole(...writeRoles),
  requireModulePermission('trasferimenti', 'write'),
  validate(createTransferSchema),
  createTransfer,
);

router.put(
  '/:id',
  authenticate,
  enforceCompany,
  requireRole(...writeRoles),
  requireModulePermission('trasferimenti', 'write'),
  validate(updateTransferSchema),
  updateTransfer,
);

router.delete(
  '/:id',
  authenticate,
  enforceCompany,
  requireRole(...writeRoles),
  requireModulePermission('trasferimenti', 'write'),
  deleteTransfer,
);

router.post(
  '/:id/cancel',
  authenticate,
  enforceCompany,
  requireRole(...writeRoles),
  requireModulePermission('trasferimenti', 'write'),
  validate(cancelSchema),
  cancelTransfer,
);

router.post(
  '/:id/complete',
  authenticate,
  enforceCompany,
  requireRole(...writeRoles),
  requireModulePermission('trasferimenti', 'write'),
  completeTransfer,
);

export default router;
