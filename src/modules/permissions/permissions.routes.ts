import { Router } from 'express';
import { z } from 'zod';
import { getPermissions, updatePermissions, getMyPermissions, getEffectivePermissions } from './permissions.controller';
import { authenticate, requireRole, enforceCompany, requireSuperAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getCompaniesPermissions, updateCompanyPermissions } from './system-permissions.controller';
import { MANAGED_ROLES, SYSTEM_MODULES } from './permission-catalog';

const router = Router();

const updatePermissionsSchema = z.object({
  updates: z.array(z.object({
    role: z.enum(MANAGED_ROLES),
    module: z.string().min(1),
    enabled: z.boolean(),
  })).min(1, 'Almeno una modifica è richiesta'),
});

const systemUpdateSchema = z.object({
  updates: z.array(z.object({
    role:    z.enum(MANAGED_ROLES),
    module:  z.enum(SYSTEM_MODULES),
    enabled: z.boolean(),
  })).min(1, 'Almeno una modifica è richiesta'),
});

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, getPermissions);
router.put('/', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, validate(updatePermissionsSchema), updatePermissions);
router.get('/my', authenticate, enforceCompany, getMyPermissions);
router.get('/effective', authenticate, enforceCompany, getEffectivePermissions);
router.get('/companies', authenticate, requireSuperAdmin, getCompaniesPermissions);
router.put('/companies/:companyId', authenticate, requireSuperAdmin, validate(systemUpdateSchema), updateCompanyPermissions);

export default router;
