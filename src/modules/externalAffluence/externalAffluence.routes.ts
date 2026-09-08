import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireModulePermission, requireRole, requireSuperAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  getAffluenceConfiguration,
  deleteMapping,
  getAffluencePreview,
  getExternalCatalog,
  getExternalTableData,
  getWeekAffluenceLive,
  getOverview,
  getIngressiData,
  listDepositi,
  listMappings,
  syncAffluenceFromExternal,
  updateAffluenceConfiguration,
  upsertMapping,
  getAffluenceForecast,
  upsertForecastOverride,
  deleteForecastOverride,
} from './externalAffluence.controller';

const router = Router();

const readRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const mappingWriteRoles = ['admin', 'hr', 'area_manager'] as const;
const syncRoles = ['admin', 'hr', 'area_manager'] as const;

const upsertMappingSchema = z.object({
  external_store_code: z.string().trim().min(1).max(20),
  notes: z.string().trim().max(800).optional().nullable(),
  target_company_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
});

const syncAffluenceSchema = z.object({
  store_id: z.number().int().positive(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  overwrite_default: z.boolean().optional(),
  target_company_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
});

const updateAffluenceConfigurationSchema = z.object({
  store_id: z.number().int().positive(),
  visitors_per_staff: z.number().positive().max(10000).optional(),
  low_max_staff: z.number().int().min(0).max(100000).optional(),
  medium_max_staff: z.number().int().min(0).max(100000).optional(),
  coverage_tolerance: z.number().min(0).max(10).optional(),
  slot_weights: z.array(z.object({
    time_slot: z.enum(['00:00-06:00', '06:00-12:00', '12:00-18:00', '18:00-24:00']),
    weight: z.number().min(0).max(1),
  })).optional(),
  target_company_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
});

type AnyMiddleware = (...args: any[]) => any;
type RegisterExternalAffluenceLocalDebugRoutes = (router: Router, deps: {
  authenticate: AnyMiddleware;
  requireRole: (...roles: string[]) => AnyMiddleware;
  requireModulePermission: (moduleKey: string, action: string) => AnyMiddleware;
  getExternalCatalog: AnyMiddleware;
  getExternalTableData: AnyMiddleware;
}) => void;

function isLocalHostname(hostname: string): boolean {
  const host = (hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function registerBuiltInLocalDebugRoutes(targetRouter: Router): void {
  const requireLocalDebugAccess: AnyMiddleware = (req: any, res: any, next: any) => {
    const isNonProduction = process.env.NODE_ENV !== 'production';
    if (isNonProduction || isLocalHostname(req?.hostname ?? '')) {
      next();
      return;
    }

    res.status(404).json({
      success: false,
      error: 'Not found',
    });
  };

  targetRouter.get(
    '/catalog',
    authenticate,
    requireSuperAdmin,
    requireLocalDebugAccess,
    getExternalCatalog,
  );

  targetRouter.get(
    '/table-data',
    authenticate,
    requireSuperAdmin,
    requireLocalDebugAccess,
    getExternalTableData,
  );
}

function registerLocalDebugRoutes(targetRouter: Router): void {
  const moduleCandidates = [
    './local-only/externalAffluence.debug.routes.local',
    './local-only/externalAffluence.debug.routes.local.ts',
    './local-only/externalAffluence.debug.routes.local.js',
  ];

  for (const modulePath of moduleCandidates) {
    try {
      const localModule = require(modulePath) as {
        registerExternalAffluenceLocalDebugRoutes?: RegisterExternalAffluenceLocalDebugRoutes;
      };

      if (typeof localModule.registerExternalAffluenceLocalDebugRoutes === 'function') {
        localModule.registerExternalAffluenceLocalDebugRoutes(targetRouter, {
          authenticate,
          requireRole: (...roles: string[]) => requireRole(...roles as any),
          requireModulePermission: (moduleKey: string, action: string) => requireModulePermission(moduleKey as any, action as any),
          getExternalCatalog,
          getExternalTableData,
        });
        return;
      }
    } catch {
      // Keep trying candidate module paths.
    }
  }

  // Fallback keeps local behavior available when local-only module is absent.
  registerBuiltInLocalDebugRoutes(targetRouter);
}

router.get(
  '/overview',
  authenticate,
  requireSuperAdmin,
  getOverview,
);

router.get(
  '/depositi',
  authenticate,
  requireSuperAdmin,
  listDepositi,
);

router.get(
  '/mappings',
  authenticate,
  requireSuperAdmin,
  listMappings,
);

router.put(
  '/mappings/:storeId',
  authenticate,
  requireSuperAdmin,
  validate(upsertMappingSchema),
  upsertMapping,
);

router.delete(
  '/mappings/:storeId',
  authenticate,
  requireSuperAdmin,
  deleteMapping,
);

router.get(
  '/ingressi',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getIngressiData,
);

router.get(
  '/affluence-preview',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getAffluencePreview,
);

router.get(
  '/week-affluence',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getWeekAffluenceLive,
);

router.get(
  '/configuration',
  authenticate,
  requireSuperAdmin,
  getAffluenceConfiguration,
);

router.patch(
  '/configuration',
  authenticate,
  requireSuperAdmin,
  validate(updateAffluenceConfigurationSchema),
  updateAffluenceConfiguration,
);

router.post(
  '/sync-affluence',
  authenticate,
  requireSuperAdmin,
  validate(syncAffluenceSchema),
  syncAffluenceFromExternal,
);

router.get(
  '/forecast',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getAffluenceForecast,
);

router.put(
  '/forecast/override',
  authenticate,
  requireRole(...mappingWriteRoles),
  requireModulePermission('turni', 'write'),
  upsertForecastOverride,
);

router.delete(
  '/forecast/override',
  authenticate,
  requireRole(...mappingWriteRoles),
  requireModulePermission('turni', 'write'),
  deleteForecastOverride,
);

registerLocalDebugRoutes(router);

export default router;
