import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { checkin, createManualEvent, listAttendanceEvents, listMyAttendanceEvents, syncEvents, getAnomalies, updateAttendanceEvent, deleteAttendanceEvent, getDailyState } from './attendance.controller';

const router = Router();

const checkinSchema = z.object({
  qr_token:   z.string().min(1, 'Token QR obbligatorio'),
  event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
  user_id:    z.number().int().positive().optional(),
  unique_id:  z.string().optional(),
  // Device binding: sent by the employee's own device.
  // For non-employee roles we ignore it.
  device_fingerprint: z.string().min(10).optional(),
  device_metadata: z.record(z.string(), z.any()).optional(),
  notes:      z.string().max(500).optional(),
});

const allRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'] as const;
const managementRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

// POST /api/attendance/checkin — validate QR token and record event
// NOTE: No requireModulePermission here — attendance actions (clock-in/out)
// must always work regardless of whether the 'presenze' module is enabled.
// Disabling the module only hides UI screens; it does NOT block actions.
router.post(
  '/checkin',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  validate(checkinSchema),
  checkin,
);

// GET /api/attendance — filterable attendance log
router.get(
  '/',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  listAttendanceEvents,
);

const manualEventSchema = z.object({
  user_id:    z.number().int().positive(),
  store_id:   z.number().int().positive(),
  event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
  event_time: z.string().min(1),
  notes:      z.string().max(500).optional(),
});

// POST /api/attendance — create manual entry (admin/hr only)
router.post(
  '/',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  validate(manualEventSchema),
  createManualEvent,
);

const syncSchema = z.object({
  events: z.array(z.object({
    event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
    user_id:    z.number().int().positive().optional(),
    unique_id:  z.string().min(1).optional(),
    event_time: z.string().datetime(),
    notes:      z.string().max(500).optional(),
  }).refine(
    (e) => e.user_id != null || (e.unique_id != null && e.unique_id.length > 0),
    { message: 'user_id o unique_id obbligatorio' },
  )).min(1).max(500),
});

// POST /api/attendance/sync — terminal and employee check-ins
// NOTE: No requireModulePermission — same rationale as /checkin above.
router.post(
  '/sync',
  authenticate,
  requireRole('store_terminal', 'employee', 'store_manager', 'hr', 'area_manager'),
  enforceCompany,
  validate(syncSchema),
  syncEvents,
);

// GET /api/attendance/anomalies — management roles only
router.get(
  '/anomalies',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  requireModulePermission('anomalie', 'read'),
  getAnomalies,
);

// GET /api/attendance/my — employee/store_manager/hr/area_manager self-service attendance history
router.get(
  '/my',
  authenticate,
  requireRole('employee', 'store_manager', 'hr', 'area_manager'),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  listMyAttendanceEvents,
);

// GET /api/attendance/daily-state — employee/store_manager/hr/area_manager today's attendance state (for state machine)
// Does NOT require the presenze module permission — functionality vs visibility
router.get(
  '/daily-state',
  authenticate,
  requireRole('employee', 'store_manager', 'hr', 'area_manager'),
  enforceCompany,
  getDailyState,
);

// PUT /api/attendance/:id — admin or hr only
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  updateAttendanceEvent,
);

// DELETE /api/attendance/:id — admin or hr only
router.delete(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  deleteAttendanceEvent,
);

export default router;
