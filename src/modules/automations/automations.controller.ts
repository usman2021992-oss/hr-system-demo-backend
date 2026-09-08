import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, badRequest, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { getDefaultAutomationRoles, sanitizeAutomationRoles } from './automationDefaults';

// GET /api/automations
export const getAutomations = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.query.company_id || req.query.companyId || req.body.company_id || req.body.companyId;
  const targetCompanyId = explicit ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const automations = await query<{ automation_id: string; is_enabled: boolean; recipient_roles: string[] | null }>(
    `SELECT automation_id, is_enabled, recipient_roles FROM company_automations WHERE company_id = $1`,
    [targetCompanyId],
  );

  // Return a map of automation_id -> { is_enabled, recipient_roles }
  const automationsMap = automations.reduce((acc, row) => {
    acc[row.automation_id] = {
      is_enabled: row.is_enabled,
      recipient_roles: sanitizeAutomationRoles(row.recipient_roles, row.automation_id),
    };
    return acc;
  }, {} as Record<string, { is_enabled: boolean; recipient_roles: string[] }>);

  ok(res, automationsMap);
});

// PUT /api/automations/:id
export const updateAutomation = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body.company_id || req.body.companyId || req.query.company_id || req.query.companyId;
  const targetCompanyId = explicit ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { id } = req.params;
  const isEnabledValue = typeof req.body.is_enabled === 'boolean'
    ? req.body.is_enabled
    : req.body.isEnabled;
  const hasIsEnabled = typeof isEnabledValue === 'boolean';
  const hasRoles = Object.prototype.hasOwnProperty.call(req.body, 'recipient_roles')
    || Object.prototype.hasOwnProperty.call(req.body, 'recipientRoles');
  const recipientRolesInput = req.body.recipient_roles ?? req.body.recipientRoles;

  if (!hasIsEnabled && !hasRoles) {
    badRequest(res, 'Provide is_enabled and/or recipient_roles');
    return;
  }

  if (hasRoles && req.user?.is_super_admin !== true) {
    forbidden(res, 'Only super admin can update automation recipient roles');
    return;
  }

  const current = await queryOne<{ is_enabled: boolean; recipient_roles: string[] | null }>(
    `SELECT is_enabled, recipient_roles
     FROM company_automations
     WHERE company_id = $1 AND automation_id = $2`,
    [targetCompanyId, id],
  );

  const finalIsEnabled = hasIsEnabled ? isEnabledValue : (current?.is_enabled ?? false);
  const finalRecipientRoles = hasRoles
    ? sanitizeAutomationRoles(recipientRolesInput, id)
    : (current ? sanitizeAutomationRoles(current.recipient_roles, id) : getDefaultAutomationRoles(id));

  const result = await queryOne<{ automation_id: string; is_enabled: boolean; recipient_roles: string[] | null }>(
    `INSERT INTO company_automations (company_id, automation_id, is_enabled, recipient_roles)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, automation_id)
     DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       recipient_roles = EXCLUDED.recipient_roles,
       updated_at = CURRENT_TIMESTAMP
     RETURNING automation_id, is_enabled, recipient_roles`,
    [targetCompanyId, id, finalIsEnabled, finalRecipientRoles],
  );

  ok(res, {
    automation_id: result?.automation_id ?? id,
    is_enabled: result?.is_enabled ?? finalIsEnabled,
    recipient_roles: sanitizeAutomationRoles(result?.recipient_roles ?? finalRecipientRoles, id),
  });
});
