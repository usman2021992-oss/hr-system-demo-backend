import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

interface TrainingRow {
  id: number;
  user_id: number;
  company_id: number;
  training_type: string;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

/** Resolve the effective company_id for the target employee.
 *  Super admins can operate cross-company — we look up the employee's actual company.
 *  Regular users get their own companyId (also the security boundary). */
async function resolveCompanyId(
  empId: number,
  callerCompanyId: number | null,
  isSuperAdmin: boolean,
  allowedCompanyIds: number[],
): Promise<number | null> {
  // If caller cannot cross-company (allowedCompanyIds length = 1) and
  // is not super admin, restrict to caller's company.
  if (!isSuperAdmin && allowedCompanyIds.length <= 1) return callerCompanyId;

  // Otherwise, resolve the employee's actual company, but ensure it is within allowed scope.
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

// GET /api/employees/:id/trainings
export const listTrainings = asyncHandler(async (req: Request, res: Response) => {
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
  const rows = await query<TrainingRow>(
    `SELECT * FROM employee_trainings WHERE user_id = $1 AND company_id = $2 ORDER BY training_type, start_date DESC`,
    [empId, effectiveCompanyId]
  );
  ok(res, rows);
});

// POST /api/employees/:id/trainings
export const createTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }
  const { training_type, start_date, end_date, notes } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  // Verify employee belongs to the resolved company
  const emp = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
    [empId, effectiveCompanyId]
  );
  if (!emp) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<TrainingRow>(
    `INSERT INTO employee_trainings (user_id, company_id, training_type, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [empId, effectiveCompanyId, training_type, start_date || null, end_date || null, notes || null]
  );
  created(res, row, 'Formazione aggiunta');
});

// PUT /api/employees/:id/trainings/:trainingId
export const updateTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const trainingId = parseInt(req.params.trainingId, 10);
  if (isNaN(empId) || isNaN(trainingId)) { notFound(res, 'Record formazione non trovato'); return; }
  const { training_type, start_date, end_date, notes } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<TrainingRow>(
    `UPDATE employee_trainings SET training_type = $1, start_date = $2, end_date = $3, notes = $4, updated_at = NOW()
     WHERE id = $5 AND user_id = $6 AND company_id = $7 RETURNING *`,
    [training_type, start_date || null, end_date || null, notes || null, trainingId, empId, effectiveCompanyId]
  );
  if (!row) { notFound(res, 'Record formazione non trovato'); return; }
  ok(res, row, 'Formazione aggiornata');
});

// DELETE /api/employees/:id/trainings/:trainingId
export const deleteTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const trainingId = parseInt(req.params.trainingId, 10);
  if (isNaN(empId) || isNaN(trainingId)) { notFound(res, 'Record formazione non trovato'); return; }
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = await checkSuperAdmin(userId);
  const effectiveCompanyId = await resolveCompanyId(empId, companyId ?? null, isSuperAdmin, allowedCompanyIds);
  if (effectiveCompanyId === null) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne(
    `DELETE FROM employee_trainings WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id`,
    [trainingId, empId, effectiveCompanyId]
  );
  if (!row) { notFound(res, 'Record formazione non trovato'); return; }
  ok(res, { id: trainingId }, 'Formazione eliminata');
});
