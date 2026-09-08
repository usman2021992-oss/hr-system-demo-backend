import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getDeviceStatus, registerDevice, getDeviceHistory, reRegisterDevice, checkDeviceRegistration } from './device.controller';

const router = Router();

// Zod v4: `z.record(z.any())` is invalid and throws at parse time → 500 SERVER_ERROR.
// Use explicit key + value schemas.
const registerDeviceSchema = z.object({
  fingerprint: z.string().min(10, 'Device fingerprint obbligatorio'),
  // Arbitrary client metadata (user-agent/screen/etc). Stored as JSONB.
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const reRegisterDeviceSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(1, 'Password obbligatoria'),
  fingerprint: z.string().min(10, 'Device fingerprint obbligatorio'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const checkDeviceRegistrationSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(1, 'Password obbligatoria'),
  fingerprint: z.string().min(10, 'Device fingerprint obbligatorio'),
});

router.get(
  '/status',
  authenticate,
  requireRole('employee', 'store_terminal', 'store_manager', 'hr', 'area_manager'),
  enforceCompany,
  getDeviceStatus,
);

router.post(
  '/register',
  authenticate,
  requireRole('employee', 'store_terminal', 'store_manager', 'hr', 'area_manager'),
  enforceCompany,
  validate(registerDeviceSchema),
  registerDevice,
);

router.post(
  '/re-register',
  authenticate,
  requireRole('store_terminal', 'admin', 'hr', 'area_manager', 'store_manager'),
  enforceCompany,
  validate(reRegisterDeviceSchema),
  reRegisterDevice,
);

router.post(
  '/check-fingerprint',
  validate(checkDeviceRegistrationSchema),
  checkDeviceRegistration,
);

router.get(
  '/history/:userId',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  getDeviceHistory,
);

export default router;

