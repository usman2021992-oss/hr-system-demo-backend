import { Request, Response } from 'express';
import { query, queryOne, pool } from '../../config/database';
import { ok, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { UserRole } from '../../config/jwt';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';
import {
  ALL_MODULES,
  ACTIVE_MODULES,
  ACTIVE_MODULE_SET,
  ModuleName,
  VALID_ROLES,
  isRoleEligibleForModule,
  isDefaultEnabledForModule,
  canManageRole,
  ManagedRole,
} from './permission-catalog';

interface PermissionRow {
  role: UserRole;
  module_name: string;
  is_enabled: boolean;
}

async function resolveTargetCompanyId(req: Request): Promise<number | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const explicit = req.query?.target_company_id ?? req.body?.target_company_id;

  if (explicit != null) {
    const explicitTarget = parseInt(String(explicit), 10);
    if (!Number.isFinite(explicitTarget) || !allowedCompanyIds.includes(explicitTarget)) {
      return null;
    }
    return explicitTarget;
  }

  const fallback = req.user?.companyId ?? allowedCompanyIds[0];
  if (!Number.isFinite(fallback) || !allowedCompanyIds.includes(fallback)) {
    return null;
  }
  return fallback;
}

// GET /api/permissions — Returns permission grid for company
// Returns: { [module]: { [role]: boolean } }
export const getPermissions = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveTargetCompanyId(req);
  if (companyId == null) {
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }

  const rows = await query<PermissionRow>(
    `SELECT role, module_name, is_enabled FROM role_module_permissions
     WHERE company_id = $1 ORDER BY module_name, role`,
    [companyId]
  );

  // Build grid structure
  const grid: Record<string, Record<string, boolean>> = {};
  for (const mod of ALL_MODULES) {
    grid[mod] = {};
    for (const role of VALID_ROLES) {
      // Always include the 'admin' role in the grid, even if the requesting user
      // can't manage it. The frontend needs admin's status to determine module
      // visibility (modules disabled for admin are hidden from the permissions table).
      if (role !== 'admin' && !canManageRole(req.user!.role, req.user!.is_super_admin, role as ManagedRole)) {
        continue;
      }
      grid[mod][role] = isDefaultEnabledForModule(role, mod);
    }
  }
  for (const row of rows) {
    if (!grid[row.module_name]) grid[row.module_name] = {};
    const mod = row.module_name as ModuleName;
    if (ALL_MODULES.includes(mod) && VALID_ROLES.includes(row.role)) {
      grid[row.module_name][row.role] = isRoleEligibleForModule(row.role, mod) ? row.is_enabled : false;
    } else {
      grid[row.module_name][row.role] = row.is_enabled;
    }
  }

  // Mark which modules are active in Phase 1
  const moduleMeta: Record<string, { active: boolean }> = {};
  for (const mod of ALL_MODULES) {
    moduleMeta[mod] = { active: ACTIVE_MODULE_SET.has(mod) };
  }

  ok(res, { grid, moduleMeta });
});

// PUT /api/permissions — Update permission toggles (admin only, active modules only)
export const updatePermissions = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const targetCompanyId = await resolveTargetCompanyId(req);
  if (targetCompanyId == null) {
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }
  const { updates } = req.body as { updates: Array<{ role: UserRole; module: string; enabled: boolean }> };

  if (!Array.isArray(updates) || updates.length === 0) {
    badRequest(res, 'Nessuna modifica fornita', 'NO_UPDATES');
    return;
  }

  for (const update of updates) {
    // Only allow toggling active Phase 1 modules
    if (!ACTIVE_MODULE_SET.has(update.module as ModuleName)) {
      badRequest(res, `Il modulo '${update.module}' non è disponibile in questa fase`, 'MODULE_NOT_ACTIVE');
      return;
    }
    if (!VALID_ROLES.includes(update.role)) {
      badRequest(res, `Ruolo non valido: ${update.role}`, 'INVALID_ROLE');
      return;
    }
    if (!isRoleEligibleForModule(update.role, update.module as ModuleName)) {
      badRequest(res, `Il ruolo '${update.role}' non è abilitabile per il modulo '${update.module}'`, 'ROLE_NOT_ELIGIBLE');
      return;
    }
    if (!canManageRole(req.user!.role, req.user!.is_super_admin, update.role as ManagedRole)) {
      badRequest(res, `Non hai i permessi per modificare il ruolo '${update.role}'`, 'ROLE_HIERARCHY_VIOLATION');
      return;
    }

  }

  // All upserts + audit log run in a single transaction for atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of updates) {
      // Enforce admin-first rule: non-admin roles can only be enabled if admin is already enabled
      if (update.enabled && update.role !== 'admin') {
        const adminRow = await client.query(
          `SELECT is_enabled FROM role_module_permissions
           WHERE company_id = $1 AND role = 'admin' AND module_name = $2`,
          [targetCompanyId, update.module]
        );
        const adminEnabled = adminRow.rows.length > 0
          ? adminRow.rows[0].is_enabled
          : isDefaultEnabledForModule('admin', update.module as ModuleName);
        if (!adminEnabled) {
          badRequest(res, `Il modulo '${update.module}' deve essere prima abilitato per il ruolo Admin`, 'ADMIN_MUST_BE_ENABLED_FIRST');
          await client.query('ROLLBACK');
          client.release();
          return;
        }
      }
      await client.query(
        `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (company_id, role, module_name)
         DO UPDATE SET is_enabled = $4, updated_by = $5, updated_at = NOW()`,
        [targetCompanyId, update.role, update.module, update.enabled, userId]
      );
    }

    const ip = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress;
    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, new_data, ip_address)
       VALUES ($1, $2, 'UPDATE', 'permission', $3, $4)`,
      [targetCompanyId, userId, JSON.stringify(updates), ip]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ok(res, null, 'Permessi aggiornati con successo');
});

// GET /api/permissions/my — Returns permission map for current user's role
// Used by AuthContext on login to load permission map
// Active modules default to false unless explicitly enabled in DB
export const getMyPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const rows = await query<{ module_name: string; is_enabled: boolean }>(
    `SELECT module_name, BOOL_AND(is_enabled)::boolean AS is_enabled
     FROM role_module_permissions
     WHERE company_id = ANY($1) AND role = $2 AND module_name = ANY($3)
     GROUP BY module_name`,
    [allowedCompanyIds, role, [...ACTIVE_MODULES]]
  );

  // Default active modules by policy — DB rows override the default
  const permissions: Record<string, boolean> = {};
  for (const mod of ACTIVE_MODULES) {
    permissions[mod] = isDefaultEnabledForModule(role, mod);
  }
  for (const row of rows) {
    const mod = row.module_name as ModuleName;
    if (ALL_MODULES.includes(mod) && VALID_ROLES.includes(role)) {
      permissions[row.module_name] = isRoleEligibleForModule(role, mod) ? row.is_enabled : false;
    } else {
      permissions[row.module_name] = row.is_enabled;
    }
  }

  ok(res, permissions);
});

// GET /api/permissions/effective — role + scoped module toggles for frontend guards
export const getEffectivePermissions = asyncHandler(async (req: Request, res: Response) => {
  const { role, is_super_admin: isSuperAdmin } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const targetCompanyId = await resolveTargetCompanyId(req);
  if (targetCompanyId == null) {
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }

  const rows = await query<{ module_name: string; is_enabled: boolean }>(
    `SELECT module_name, is_enabled
     FROM role_module_permissions
     WHERE company_id = $1 AND role = $2 AND module_name = ANY($3)`,
    [targetCompanyId, role, [...ACTIVE_MODULES]]
  );

  const moduleMap: Record<string, boolean> = {};
  for (const mod of ACTIVE_MODULES) {
    moduleMap[mod] = isDefaultEnabledForModule(role, mod);
  }
  for (const row of rows) {
    const mod = row.module_name as ModuleName;
    if (ALL_MODULES.includes(mod) && VALID_ROLES.includes(role)) {
      moduleMap[row.module_name] = isRoleEligibleForModule(role, mod) ? row.is_enabled : false;
    } else {
      moduleMap[row.module_name] = row.is_enabled;
    }
  }

  ok(res, {
    role,
    isSuperAdmin,
    allowedCompanyIds,
    targetCompanyId,
    modules: moduleMap,
  });
});
