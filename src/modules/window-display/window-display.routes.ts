// src/modules/window-display/window-display.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, enforceCompany, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  getWindowDisplay,
  createWindowDisplay,
  updateWindowDisplay,
  deleteWindowDisplay,
} from './window-display.controller';
import { CUSTOM_ACTIVITY_TYPE, WINDOW_DISPLAY_ACTIVITY_TYPES } from './activity-types';

const router = Router();

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const activityTypes = WINDOW_DISPLAY_ACTIVITY_TYPES;

function hasCustomActivityName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const createSchema = z.object({
  store_id: z.number().int().positive(),
  company_id: z.number().int().positive().nullable().optional(),
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD').optional(),
  start_date: z.string().regex(isoDate, 'start_date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(isoDate, 'end_date must be YYYY-MM-DD').optional(),
  dates: z.array(z.string().regex(isoDate, 'each date must be YYYY-MM-DD')).min(1).max(60).optional(),
  activity_type: z.enum(activityTypes).optional(),
  activity_icon: z.string().trim().min(1).max(16).nullable().optional(),
  custom_activity_name: z.string().trim().min(1).max(120).nullable().optional(),
  duration_hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((data, ctx) => {
  const activityType = data.activity_type ?? 'window_display';
  const hasCustomName = hasCustomActivityName(data.custom_activity_name);
  const hasDate = Boolean(data.date);
  const hasStart = Boolean(data.start_date);
  const hasEnd = Boolean(data.end_date);
  const hasDates = Array.isArray(data.dates) && data.dates.length > 0;

  if (!hasDate && !hasStart && !hasEnd && !hasDates) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dates, date, or start_date/end_date is required',
      path: ['dates'],
    });
  }

  if ((hasStart && !hasEnd) || (!hasStart && hasEnd)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start_date and end_date must be provided together',
      path: ['start_date'],
    });
  }

  if (hasStart && hasEnd && data.end_date! < data.start_date!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'end_date must be greater than or equal to start_date',
      path: ['end_date'],
    });
  }

  if (activityType === CUSTOM_ACTIVITY_TYPE && !hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name is required when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }

  if (activityType !== CUSTOM_ACTIVITY_TYPE && hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name can only be used when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }
});

const updateSchema = z.object({
  company_id: z.number().int().positive().nullable().optional(),
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD').optional(),
  start_date: z.string().regex(isoDate, 'start_date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(isoDate, 'end_date must be YYYY-MM-DD').optional(),
  activity_type: z.enum(activityTypes).optional(),
  activity_icon: z.string().trim().min(1).max(16).nullable().optional(),
  custom_activity_name: z.string().trim().min(1).max(120).nullable().optional(),
  duration_hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(
  (data) =>
    data.company_id !== undefined ||
    data.date !== undefined ||
    data.start_date !== undefined ||
    data.end_date !== undefined ||
    data.activity_type !== undefined ||
    data.activity_icon !== undefined ||
    data.custom_activity_name !== undefined ||
    data.duration_hours !== undefined ||
    data.notes !== undefined,
  { message: 'At least one field is required' },
).superRefine((data, ctx) => {
  const hasCustomName = hasCustomActivityName(data.custom_activity_name);

  if (data.activity_type === CUSTOM_ACTIVITY_TYPE && !hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name is required when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }

  if (data.activity_type && data.activity_type !== CUSTOM_ACTIVITY_TYPE && hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name can only be used when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }

  if (data.start_date && data.end_date && data.end_date < data.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'end_date must be greater than or equal to start_date',
      path: ['end_date'],
    });
  }
});

const readRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;
const writeRoles = ['admin', 'area_manager'] as const;

router.use(authenticate, enforceCompany);

router.get('/', requireRole(...readRoles), getWindowDisplay);
router.post('/', requireRole(...writeRoles), validate(createSchema), createWindowDisplay);
router.put('/:id', requireRole(...writeRoles), validate(updateSchema), updateWindowDisplay);
router.delete('/:id', requireRole(...writeRoles), deleteWindowDisplay);

export default router;
