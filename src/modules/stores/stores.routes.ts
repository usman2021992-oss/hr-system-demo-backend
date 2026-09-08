import { Router } from 'express';
import { z } from 'zod';
import {
  listStores,
  getStore,
  createStore,
  updateStore,
  deactivateStore,
  activateStore,
  deleteStorePermanent,
  listStoreOperatingHours,
  updateStoreOperatingHours,
} from './stores.controller';
import { authenticate, requireRole, enforceCompany, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';
import { deleteStoreLogo, storeLogoUploadMiddleware, uploadStoreLogo } from './logo.controller';

const router = Router();

const storeSchema = z.object({
  name: z.string().min(1, 'Nome negozio obbligatorio').max(255),
  code: z.string().min(1, 'Codice obbligatorio').max(50).toUpperCase(),
  address: z.string().nullable().optional(),
  cap: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  phone: z.string().max(255).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  max_staff: z.number().int().min(0).optional(),
  company_id: z.number().int().nullable().optional(),
  terminal: z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password del terminale deve essere di almeno 8 caratteri')
  }).optional()
});

const storeHoursEntrySchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  open_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  close_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  peak_start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  peak_end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  planned_shift_count: z.number().int().min(0).nullable().optional(),
  planned_staff_count: z.number().int().min(0).nullable().optional(),
  shift_plan_notes: z.string().max(500).nullable().optional(),
  is_closed: z.boolean(),
});

const storeHoursSchema = z.object({
  hours: z.array(storeHoursEntrySchema).min(1).max(7),
});

const storeReaders = ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'] as const;
const storeWriters = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

router.get('/', authenticate, requireRole(...storeReaders), enforceCompany, requireModulePermission('negozi', 'read'), listStores);
router.get('/:id/operating-hours', authenticate, requireRole(...storeReaders), enforceCompany, requireModulePermission('negozi', 'read'), listStoreOperatingHours);
router.get('/:id', authenticate, requireRole(...storeReaders), enforceCompany, requireModulePermission('negozi', 'read'), getStore);
router.post('/', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), validate(storeSchema), auditLog('store'), createStore);
router.put('/:id', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), validate(storeSchema), auditLog('store'), updateStore);
router.put('/:id/operating-hours', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), validate(storeHoursSchema), auditLog('store'), updateStoreOperatingHours);
router.post('/:id/logo', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), storeLogoUploadMiddleware, auditLog('store'), uploadStoreLogo);
router.delete('/:id/logo', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), auditLog('store'), deleteStoreLogo);
router.delete('/:id/permanent', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), auditLog('store'), deleteStorePermanent);
router.delete('/:id', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), auditLog('store'), deactivateStore);
router.patch('/:id/activate', authenticate, requireRole(...storeWriters), enforceCompany, requireModulePermission('negozi', 'write'), auditLog('store'), activateStore);

export default router;
