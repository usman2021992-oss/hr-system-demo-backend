import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

interface MedicalRow {
  id: number; user_id: number; company_id: number;
  start_date: string | null; end_date: string | null; notes: string | null; created_at: string;
}

async function resolveCompanyId(
  empId: number,
  callerCompanyId: number | null,
  isSuperAdmin: boolean,
  allowedCompanyIds: number[],
): Promise<number | null> {
  if (!isSuperAdmin && allowedCompanyIds.length <= 1) return callerCompanyId;
  const emp = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM users WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`,
    [empId, allowedCompanyIds],
  );
  return emp?.company_id ?? null;
}

async function checkSuperAdmin(userId: number): Promise<boolean> {
  const row = await queryOne<{ is_super_admin: boolean }>(`SELECT is_super_admin FROM users WHERE id = $1`, [userId]);
  return row?.is_super_admin ?? false;
}

export const listMedicals = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }
  if (role === 'employee' && userId !== empId) { forbidden(res, 'Accesso negato'); return; }
  // store_manager can only access employees in their own store
  if (role === 'store_manager' && empId !== userId) {
    const inStore = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND store_id = $3`,
      [empId, companyId, storeId]
    );
    if (!inStore) { forbidden(res, 'Accesso negato'); return; }
  }
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const rows = await query<MedicalRow>(
    `SELECT * FROM employee_medical_checks WHERE user_id = $1 AND company_id = $2 ORDER BY start_date DESC`,
    [empId, effectiveCompanyId]
  );
  ok(res, rows);
});

export const createMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }
  const { start_date, end_date, notes } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const emp = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
    [empId, effectiveCompanyId]
  );
  if (!emp) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<MedicalRow>(
    `INSERT INTO employee_medical_checks (user_id, company_id, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [empId, effectiveCompanyId, start_date || null, end_date || null, notes || null]
  );
  created(res, row, 'Visita medica aggiunta');
});

export const updateMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const medId = parseInt(req.params.medicalId, 10);
  if (isNaN(empId) || isNaN(medId)) { notFound(res, 'Visita medica non trovata'); return; }
  const { start_date, end_date, notes } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<MedicalRow>(
    `UPDATE employee_medical_checks SET start_date = $1, end_date = $2, notes = $3, updated_at = NOW()
     WHERE id = $4 AND user_id = $5 AND company_id = $6 RETURNING *`,
    [start_date || null, end_date || null, notes || null, medId, empId, effectiveCompanyId]
  );
  if (!row) { notFound(res, 'Visita medica non trovata'); return; }
  ok(res, row, 'Visita medica aggiornata');
});

export const deleteMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const medId = parseInt(req.params.medicalId, 10);
  if (isNaN(empId) || isNaN(medId)) { notFound(res, 'Visita medica non trovata'); return; }
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne(
    `DELETE FROM employee_medical_checks WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id`,
    [medId, empId, effectiveCompanyId]
  );
  if (!row) { notFound(res, 'Visita medica non trovata'); return; }
  ok(res, { id: medId }, 'Visita medica eliminata');
});
