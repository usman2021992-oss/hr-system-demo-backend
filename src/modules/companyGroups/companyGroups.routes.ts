import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, requireSuperAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  listCompanyGroups,
  createCompanyGroup,
  updateCompanyGroup,
  deleteCompanyGroup,
  getGroupRoleVisibility,
  updateGroupRoleVisibility,
} from './companyGroups.controller';

const router = Router();

const createGroupSchema = z.object({
  name: z.string().min(1, 'Nome gruppo obbligatorio').max(255),
  owner_user_id: z.number().int().positive().optional(),
});

const roleVisibilitySchema = z.object({
  hr: z.boolean(),
  area_manager: z.boolean(),
});

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), listCompanyGroups);
router.post('/', authenticate, requireSuperAdmin, validate(createGroupSchema), createCompanyGroup);
router.put('/:groupId', authenticate, requireSuperAdmin, validate(createGroupSchema), updateCompanyGroup);
router.delete('/:groupId', authenticate, requireSuperAdmin, deleteCompanyGroup);

router.get('/:groupId/role-visibility', authenticate, requireSuperAdmin, getGroupRoleVisibility);
router.put('/:groupId/role-visibility', authenticate, requireSuperAdmin, validate(roleVisibilitySchema), updateGroupRoleVisibility);

export default router;
