import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, badRequest, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveCompanyGroupId } from '../../utils/companyScope';

type RoleVisibilityRow = {
  role: 'hr' | 'area_manager';
  can_cross_company: boolean;
};

type GroupCompanyRoleRow = {
  id: number;
  name: string;
  is_active: boolean;
  has_active_hr: boolean;
  has_active_area_manager: boolean;
};

export const listCompanyGroups = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    badRequest(res, 'Non autenticato', 'NOT_AUTHENTICATED');
    return;
  }

  // Main Admin can see all groups; other scoped roles only see the group
  // associated with their own company (standalone companies return an empty list).
  if (user.is_super_admin === true) {
    const groups = await query<{ id: number; name: string; owner_user_id: number | null; companies: { id: number; name: string }[] | null }>(
      `SELECT
         cg.id,
         cg.name,
         cg.owner_user_id,
         (
           SELECT json_agg(json_build_object('id', c.id, 'name', c.name))
           FROM companies c
           WHERE c.group_id = cg.id
         ) as companies
       FROM company_groups cg
       ORDER BY cg.id ASC`
    );
    ok(res, groups);
    return;
  }

  if (user.companyId === null) {
    ok(res, []);
    return;
  }

  const groupId = await resolveCompanyGroupId(user.companyId);
  if (groupId === null) {
    ok(res, []);
    return;
  }

  const groups = await query<{ id: number; name: string; owner_user_id: number | null; companies: { id: number; name: string }[] | null }>(
    `SELECT
       cg.id,
       cg.name,
       cg.owner_user_id,
       (
         SELECT json_agg(json_build_object('id', c.id, 'name', c.name))
         FROM companies c
         WHERE c.group_id = cg.id
       ) as companies
     FROM company_groups cg
     WHERE cg.id = $1
     ORDER BY cg.id ASC`,
    [groupId]
  );
  ok(res, groups);
});

export const createCompanyGroup = asyncHandler(async (req: Request, res: Response) => {
  const { name, owner_user_id } = req.body as { name: string; owner_user_id?: number };
  const slugSafe = name.trim();
  const ownerUserId = owner_user_id ?? req.user!.userId;

  if (!slugSafe) {
    badRequest(res, 'Nome gruppo non valido', 'INVALID_GROUP_NAME');
    return;
  }

  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    badRequest(res, 'Proprietario gruppo non valido', 'INVALID_OWNER');
    return;
  }

  const ownerExists = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1`,
    [ownerUserId],
  );
  if (!ownerExists) {
    badRequest(res, 'Proprietario gruppo non trovato', 'INVALID_OWNER');
    return;
  }

  const group = await queryOne<{ id: number; name: string; owner_user_id: number | null }>(
    `INSERT INTO company_groups (name, owner_user_id)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
     SET name = EXCLUDED.name,
         owner_user_id = COALESCE(company_groups.owner_user_id, EXCLUDED.owner_user_id)
     RETURNING id, name, owner_user_id`,
    [slugSafe, ownerUserId]
  );

  if (!group) {
    badRequest(res, 'Impossibile creare il gruppo', 'GROUP_CREATE_FAILED');
    return;
  }
  created(res, group, 'Gruppo creato');
});

export const getGroupRoleVisibility = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const id = parseInt(groupId, 10);
  if (Number.isNaN(id)) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  const row = await query<RoleVisibilityRow>(
    `SELECT role, can_cross_company
     FROM group_role_visibility
     WHERE group_id = $1`,
    [id]
  );

  const hr = row.find((r) => r.role === 'hr')?.can_cross_company ?? false;
  const area_manager = row.find((r) => r.role === 'area_manager')?.can_cross_company ?? false;

  const companies = await query<GroupCompanyRoleRow>(
    `SELECT
       c.id,
       c.name,
       c.is_active,
       EXISTS(
         SELECT 1
         FROM users u
         WHERE u.company_id = c.id
           AND u.role = 'hr'
           AND u.status = 'active'
       ) AS has_active_hr,
       EXISTS(
         SELECT 1
         FROM users u
         WHERE u.company_id = c.id
           AND u.role = 'area_manager'
           AND u.status = 'active'
       ) AS has_active_area_manager
     FROM companies c
     WHERE c.group_id = $1
     ORDER BY c.name ASC`,
    [id],
  );

  ok(res, { hr, area_manager, companies });
});

export const updateGroupRoleVisibility = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const id = parseInt(groupId, 10);
  if (Number.isNaN(id)) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  // Ensure group exists
  const groupExists = await queryOne<{ id: number }>(
    `SELECT id FROM company_groups WHERE id = $1`,
    [id]
  );
  if (!groupExists) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  const { hr, area_manager } = req.body as { hr: boolean; area_manager: boolean };
  const updatedBy = req.user!.userId;

  await query(
    `INSERT INTO group_role_visibility (group_id, role, can_cross_company, updated_by, updated_at)
     VALUES
       ($1, 'hr', $2, $3, NOW()),
       ($1, 'area_manager', $4, $3, NOW())
     ON CONFLICT (group_id, role)
     DO UPDATE SET can_cross_company = EXCLUDED.can_cross_company, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [id, hr, updatedBy, area_manager]
  );

  ok(res, null, 'Permessi del gruppo aggiornati');
});

export const updateCompanyGroup = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const id = parseInt(groupId, 10);
  if (Number.isNaN(id)) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  const { name } = req.body as { name: string };
  const slugSafe = name?.trim();
  if (!slugSafe) {
    badRequest(res, 'Nome gruppo non valido', 'INVALID_GROUP_NAME');
    return;
  }

  const group = await queryOne<{ id: number; name: string }>(
    `UPDATE company_groups
     SET name = $1
     WHERE id = $2
     RETURNING id, name`,
    [slugSafe, id]
  );

  if (!group) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  ok(res, group, 'Gruppo aggiornato con successo');
});

export const deleteCompanyGroup = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const id = parseInt(groupId, 10);
  if (Number.isNaN(id)) {
    notFound(res, 'Gruppo non trovato');
    return;
  }

  // Set group_id to null for companies belonging to this group
  await query(`UPDATE companies SET group_id = NULL WHERE group_id = $1`, [id]);

  // Delete associated roles visibility
  await query(`DELETE FROM group_role_visibility WHERE group_id = $1`, [id]);

  // Delete the group itself
  const deleted = await queryOne<{ id: number }>(
    `DELETE FROM company_groups WHERE id = $1 RETURNING id`,
    [id]
  );

  if (!deleted) {
    notFound(res, 'Gruppo non trovato o già eliminato');
    return;
  }

  ok(res, null, 'Gruppo eliminato con successo');
});
