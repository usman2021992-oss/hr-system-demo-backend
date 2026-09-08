import { query, queryOne } from '../config/database';
import { JwtPayload, UserRole } from '../config/jwt';

type CrossRole = 'hr' | 'area_manager';

export async function resolveCompanyGroupId(companyId: number): Promise<number | null> {
  const row = await queryOne<{ group_id: number | null }>(
    `SELECT group_id FROM companies WHERE id = $1`,
    [companyId]
  );
  return row?.group_id ?? null;
}

export async function resolveGroupRoleVisibility(
  groupId: number,
  role: CrossRole,
): Promise<boolean> {
  const row = await queryOne<{ can_cross_company: boolean }>(
    `SELECT can_cross_company
     FROM group_role_visibility
     WHERE group_id = $1 AND role = $2`,
    [groupId, role]
  );
  return row?.can_cross_company ?? false;
}

/**
 * Returns which company IDs the caller is allowed to operate on (read/write),
 * based on:
 * - is_super_admin: all companies
 * - standalone company (group_id NULL): only own company
 * - admin: all companies in the same group
 * - hr/area_manager: only if group_role_visibility allows cross-company access
 * - all other roles: only own company
 */
export async function resolveAllowedCompanyIds(user: JwtPayload): Promise<number[]> {
  if (user.is_super_admin === true) {
    const all = await query<{ id: number }>(`SELECT id FROM companies ORDER BY id`, []);
    return all.map((r) => r.id);
  }

  if (user.companyId === null) return [];

  const groupId = await resolveCompanyGroupId(user.companyId);

  let allowedIds: number[];
  if (groupId === null) {
    // Standalone company (isolated)
    allowedIds = [user.companyId];
  } else if (user.role === 'admin') {
    // Admin: all companies in the same group
    const rows = await query<{ id: number }>(
      `SELECT id FROM companies WHERE group_id = $1 ORDER BY id`,
      [groupId],
    );
    allowedIds = rows.map((r) => r.id);
  } else if (user.role === 'hr' || user.role === 'area_manager') {
    // If part of a group, check if the role has cross-company visibility permission.
    if (groupId === null) {
      allowedIds = [user.companyId];
    } else {
      const canCross = await resolveGroupRoleVisibility(groupId, user.role);
      if (canCross) {
        const rows = await query<{ id: number }>(
          `SELECT id FROM companies WHERE group_id = $1 ORDER BY id`,
          [groupId],
        );
        allowedIds = rows.map((r) => r.id);
      } else {
        allowedIds = [user.companyId];
      }
    }
  } else {
    // store_manager / employee / store_terminal: always isolated
    allowedIds = [user.companyId];
  }

  // Keep grouped sibling companies visible as long as they are active.
  // Access-window enforcement for the caller's own company and explicit targets
  // still happens in auth/login + enforceCompany middleware.
  const activeRows = await query<{ id: number }>(
    `SELECT id FROM companies WHERE id = ANY($1) AND is_active = true`,
    [allowedIds],
  );

  return activeRows.map((row) => row.id);
}

export function isCrossCompanyRole(role: UserRole): role is CrossRole {
  return role === 'hr' || role === 'area_manager';
}

