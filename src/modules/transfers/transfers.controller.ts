import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, notFound, forbidden, conflict } from '../../utils/response';
import { UserRole } from '../../config/jwt';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

type TransferStatus = 'active' | 'cancelled' | 'completed';

interface TransferRow {
  id: number;
  company_id: number;
  user_id: number;
  origin_store_id: number;
  target_store_id: number;
  start_date: string;
  end_date: string;
  cancel_origin_shifts: boolean;
  status: TransferStatus;
  reason: string | null;
  notes: string | null;
  created_by: number | null;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface TransferWithNames extends TransferRow {
  user_name: string;
  user_surname: string;
  user_email: string;
  user_avatar_filename: string | null;
  company_name: string;
  group_name: string | null;
  origin_store_name: string;
  origin_store_logo_filename: string | null;
  target_store_name: string;
  target_store_logo_filename: string | null;
  created_by_name: string | null;
  created_by_surname: string | null;
  created_by_avatar_filename: string | null;
  cancelled_by_name: string | null;
  cancelled_by_surname: string | null;
  cancelled_by_avatar_filename: string | null;
}

interface ShiftWarningCounts {
  existing_shifts: number;
  target_store_shifts: number;
  origin_store_shifts: number;
}

const TRANSFER_SELECT = `
  tsa.id,
  tsa.company_id,
  tsa.user_id,
  tsa.origin_store_id,
  tsa.target_store_id,
  TO_CHAR(tsa.start_date::date, 'YYYY-MM-DD') AS start_date,
  TO_CHAR(tsa.end_date::date, 'YYYY-MM-DD') AS end_date,
  tsa.cancel_origin_shifts,
  tsa.status,
  tsa.reason,
  tsa.notes,
  tsa.created_by,
  tsa.cancelled_by,
  tsa.cancelled_at,
  tsa.cancellation_reason,
  tsa.created_at,
  tsa.updated_at,
  u.name AS user_name,
  u.surname AS user_surname,
  u.email AS user_email,
  u.avatar_filename AS user_avatar_filename,
  c.name AS company_name,
  cg.name AS group_name,
  s_from.name AS origin_store_name,
  s_from.logo_filename AS origin_store_logo_filename,
  s_to.name AS target_store_name,
  s_to.logo_filename AS target_store_logo_filename,
  creator.name AS created_by_name,
  creator.surname AS created_by_surname,
  creator.avatar_filename AS created_by_avatar_filename,
  canceller.name AS cancelled_by_name,
  canceller.surname AS cancelled_by_surname,
  canceller.avatar_filename AS cancelled_by_avatar_filename
`;

const TRANSFER_JOINS = `
  FROM temporary_store_assignments tsa
  JOIN users u ON u.id = tsa.user_id
  JOIN companies c ON c.id = tsa.company_id
  LEFT JOIN company_groups cg ON cg.id = c.group_id
  JOIN stores s_from ON s_from.id = tsa.origin_store_id
  JOIN stores s_to ON s_to.id = tsa.target_store_id
  LEFT JOIN users creator ON creator.id = tsa.created_by
  LEFT JOIN users canceller ON canceller.id = tsa.cancelled_by
`;

function isoToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoWeekRange(week: string): { dateFrom: string; dateTo: string } | null {
  const match = week.match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);
  if (weekNum < 1 || weekNum > 53) return null;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNum - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    dateFrom: formatUtcDate(monday),
    dateTo: formatUtcDate(sunday),
  };
}

function parseMonthRange(month: string): { dateFrom: string; dateTo: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const monthNum = parseInt(match[2], 10);
  if (monthNum < 1 || monthNum > 12) return null;

  const first = new Date(Date.UTC(year, monthNum - 1, 1));
  const last = new Date(Date.UTC(year, monthNum, 0));
  return {
    dateFrom: formatUtcDate(first),
    dateTo: formatUtcDate(last),
  };
}

function resolveDateRangeFromQuery(query: Record<string, string>): { dateFrom: string; dateTo: string } | null {
  if (query.date_from && query.date_to) {
    return { dateFrom: query.date_from, dateTo: query.date_to };
  }
  if (query.week) {
    return parseIsoWeekRange(query.week);
  }
  if (query.month) {
    return parseMonthRange(query.month);
  }
  return null;
}

async function getAreaManagerStoreIds(userId: number, allowedCompanyIds: number[]): Promise<number[]> {
  const rows = await query<{ store_id: number }>(
    `SELECT DISTINCT store_id
     FROM users
     WHERE role = 'store_manager'
       AND supervisor_id = $1
       AND company_id = ANY($2)
       AND status = 'active'
       AND store_id IS NOT NULL`,
    [userId, allowedCompanyIds],
  );
  return rows.map((r) => r.store_id);
}

async function buildTransferReadScope(
  role: UserRole,
  allowedCompanyIds: number[],
  userId: number,
  storeId: number | null,
  alias = 'tsa',
): Promise<{ where: string; params: any[] }> {
  const base = `${alias}.company_id = ANY($1)`;

  if (role === 'admin' || role === 'hr') {
    return { where: base, params: [allowedCompanyIds] };
  }

  if (role === 'store_manager') {
    return {
      where: `${base} AND (${alias}.origin_store_id = $2 OR ${alias}.target_store_id = $2)`,
      params: [allowedCompanyIds, storeId],
    };
  }

  if (role === 'area_manager') {
    const managedStoreIds = await getAreaManagerStoreIds(userId, allowedCompanyIds);
    if (managedStoreIds.length === 0) {
      return { where: `${base} AND 1=0`, params: [allowedCompanyIds] };
    }
    const placeholders = managedStoreIds.map((_, i) => `$${i + 2}`).join(',');
    return {
      where: `${base} AND (${alias}.origin_store_id IN (${placeholders}) OR ${alias}.target_store_id IN (${placeholders}))`,
      params: [allowedCompanyIds, ...managedStoreIds],
    };
  }

  return { where: `${base} AND 1=0`, params: [allowedCompanyIds] };
}

async function enforceAreaManagerWriteScope(
  callerUserId: number,
  companyId: number,
  requiredStoreIds: number[],
): Promise<boolean> {
  const managed = await query<{ store_id: number }>(
    `SELECT DISTINCT store_id
     FROM users
     WHERE role = 'store_manager'
       AND supervisor_id = $1
       AND company_id = $2
       AND status = 'active'
       AND store_id IS NOT NULL`,
    [callerUserId, companyId],
  );
  const managedSet = new Set(managed.map((r) => r.store_id));
  return requiredStoreIds.every((id) => managedSet.has(id));
}

async function getShiftWarningCounts(
  companyId: number,
  userId: number,
  startDate: string,
  endDate: string,
  targetStoreId: number,
  originStoreId: number,
): Promise<ShiftWarningCounts> {
  const row = await queryOne<{
    existing_shifts: number;
    target_store_shifts: number;
    origin_store_shifts: number;
  }>(
    `SELECT
       COUNT(*)::int AS existing_shifts,
       COUNT(*) FILTER (WHERE store_id = $5)::int AS target_store_shifts,
       COUNT(*) FILTER (WHERE store_id = $6)::int AS origin_store_shifts
     FROM shifts
     WHERE company_id = $1
       AND user_id = $2
       AND status != 'cancelled'
       AND date BETWEEN $3 AND $4`,
    [companyId, userId, startDate, endDate, targetStoreId, originStoreId],
  );

  return {
    existing_shifts: row?.existing_shifts ?? 0,
    target_store_shifts: row?.target_store_shifts ?? 0,
    origin_store_shifts: row?.origin_store_shifts ?? 0,
  };
}

async function getTransferByIdInScope(
  transferId: number,
  allowedCompanyIds: number[],
): Promise<TransferWithNames | null> {
  return queryOne<TransferWithNames>(
    `SELECT ${TRANSFER_SELECT}
     ${TRANSFER_JOINS}
     WHERE tsa.id = $1
       AND tsa.company_id = ANY($2)
     LIMIT 1`,
    [transferId, allowedCompanyIds],
  );
}

async function canReadTransfer(
  transfer: TransferWithNames,
  role: UserRole,
  userId: number,
  storeId: number | null,
): Promise<boolean> {
  if (role === 'admin' || role === 'hr') return true;
  if (role === 'store_manager') {
    return transfer.origin_store_id === storeId || transfer.target_store_id === storeId;
  }
  if (role === 'area_manager') {
    const managedStores = await query<{ store_id: number }>(
      `SELECT DISTINCT store_id
       FROM users
       WHERE role = 'store_manager'
         AND supervisor_id = $1
         AND company_id = $2
         AND status = 'active'
         AND store_id IS NOT NULL`,
      [userId, transfer.company_id],
    );
    const managedSet = new Set(managedStores.map((r) => r.store_id));
    return managedSet.has(transfer.origin_store_id) || managedSet.has(transfer.target_store_id);
  }
  return false;
}

export const listTransfers = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId } = req.user!;
  const { status, user_id, store_id, date_from, date_to } = req.query as Record<string, string>;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const scope = await buildTransferReadScope(role, allowedCompanyIds, userId, storeId);

  let extraWhere = '';
  const extraParams: any[] = [];
  let idx = scope.params.length + 1;

  if (status) {
    extraWhere += ` AND tsa.status = $${idx}`;
    extraParams.push(status);
    idx++;
  }

  if (user_id) {
    const parsed = parseInt(user_id, 10);
    if (Number.isNaN(parsed)) {
      badRequest(res, 'user_id non valido', 'VALIDATION_ERROR');
      return;
    }
    extraWhere += ` AND tsa.user_id = $${idx}`;
    extraParams.push(parsed);
    idx++;
  }

  if (store_id) {
    const parsed = parseInt(store_id, 10);
    if (Number.isNaN(parsed)) {
      badRequest(res, 'store_id non valido', 'VALIDATION_ERROR');
      return;
    }
    extraWhere += ` AND (tsa.origin_store_id = $${idx} OR tsa.target_store_id = $${idx})`;
    extraParams.push(parsed);
    idx++;
  }

  if (date_from && date_to) {
    extraWhere += ` AND tsa.end_date::date >= $${idx}::date AND tsa.start_date::date <= $${idx + 1}::date`;
    extraParams.push(date_from, date_to);
    idx += 2;
  } else if (date_from) {
    extraWhere += ` AND tsa.end_date::date >= $${idx}::date`;
    extraParams.push(date_from);
    idx++;
  } else if (date_to) {
    extraWhere += ` AND tsa.start_date::date <= $${idx}::date`;
    extraParams.push(date_to);
    idx++;
  }

  const transfers = await query<TransferWithNames>(
    `SELECT ${TRANSFER_SELECT}
     ${TRANSFER_JOINS}
     WHERE ${scope.where}${extraWhere}
     ORDER BY tsa.start_date DESC, tsa.created_at DESC`,
    [...scope.params, ...extraParams],
  );

  ok(res, { transfers });
});

export const getTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const transfer = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!transfer) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const allowed = await canReadTransfer(transfer, role, userId, storeId);
  if (!allowed) {
    forbidden(res, 'Accesso negato');
    return;
  }

  ok(res, transfer);
});

export const listTransferShifts = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const transfer = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!transfer) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const allowed = await canReadTransfer(transfer, role, userId, storeId);
  if (!allowed) {
    forbidden(res, 'Accesso negato');
    return;
  }

  const shifts = await query(
    `SELECT s.id,
            s.assignment_id,
            TO_CHAR(s.date::date, 'YYYY-MM-DD') AS date,
            s.start_time,
            s.end_time,
            s.status,
            s.store_id,
            st.name AS store_name,
            s.is_split,
            s.split_start2,
            s.split_end2,
            CASE
              WHEN s.status = 'cancelled' THEN 0
              ELSE ROUND(
                GREATEST(
                  0,
                  (
                    (
                      EXTRACT(EPOCH FROM (s.end_time - s.start_time))
                      + CASE
                          WHEN s.is_split = true AND s.split_start2 IS NOT NULL AND s.split_end2 IS NOT NULL
                            THEN EXTRACT(EPOCH FROM (s.split_end2 - s.split_start2))
                          ELSE 0
                        END
                    )
                    - CASE
                        WHEN s.break_type = 'flexible' AND s.break_minutes IS NOT NULL
                          THEN (s.break_minutes * 60)
                        WHEN s.break_start IS NOT NULL AND s.break_end IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (s.break_end - s.break_start))
                        ELSE 0
                      END
                  ) / 3600.0
                )::numeric,
                2
              )
            END AS shift_hours
     FROM shifts s
     JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1
       AND (
         s.assignment_id = $2
         OR (
           s.user_id = $3
           AND s.date BETWEEN $4::date AND $5::date
           AND (s.store_id = $6 OR s.store_id = $7)
         )
       )
     ORDER BY s.date ASC, s.start_time ASC`,
    [
      transfer.company_id,
      transfer.id,
      transfer.user_id,
      transfer.start_date,
      transfer.end_date,
      transfer.target_store_id,
      transfer.origin_store_id,
    ],
  );

  ok(res, {
    transfer_id: transfer.id,
    shifts,
  });
});

export const createTransfer = asyncHandler(async (req: Request, res: Response) => {
  const { userId: callerId, role } = req.user!;
  const body = req.body as {
    user_id: number;
    target_store_id: number;
    origin_store_id?: number | null;
    start_date: string;
    end_date: string;
    cancel_origin_shifts?: boolean;
    reason?: string | null;
    notes?: string | null;
  };

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const employee = await queryOne<{
    id: number;
    company_id: number;
    store_id: number | null;
    role: string;
    status: string;
  }>(
    `SELECT id, company_id, store_id, role, status
     FROM users
     WHERE id = $1
       AND company_id = ANY($2)`,
    [body.user_id, allowedCompanyIds],
  );

  if (!employee || employee.role !== 'employee' || employee.status !== 'active') {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  const companyId = employee.company_id;
  const originStoreId = body.origin_store_id ?? employee.store_id;
  const shouldCancelOriginShifts = body.cancel_origin_shifts !== false;

  if (!originStoreId) {
    badRequest(res, 'Il dipendente non ha un negozio di origine assegnato', 'MISSING_ORIGIN_STORE');
    return;
  }

  if (originStoreId === body.target_store_id) {
    badRequest(res, 'Negozio origine e destinazione devono essere diversi', 'INVALID_TRANSFER_STORES');
    return;
  }

  const validStores = await query<{ id: number }>(
    `SELECT id
     FROM stores
     WHERE company_id = $1
       AND is_active = true
       AND id = ANY($2::int[])`,
    [companyId, [originStoreId, body.target_store_id]],
  );
  if (validStores.length !== 2) {
    notFound(res, 'Negozio non trovato');
    return;
  }

  if (role === 'area_manager') {
    const canManage = await enforceAreaManagerWriteScope(callerId, companyId, [originStoreId, body.target_store_id]);
    if (!canManage) {
      forbidden(res, 'Accesso negato');
      return;
    }
  }

  const overlap = await queryOne<{ id: number }>(
    `SELECT id
     FROM temporary_store_assignments
     WHERE company_id = $1
       AND user_id = $2
       AND status = 'active'
       AND start_date::date <= $4::date
       AND end_date::date >= $3::date
     LIMIT 1`,
    [companyId, body.user_id, body.start_date, body.end_date],
  );

  if (overlap) {
    conflict(res, 'Esiste gia un trasferimento attivo sovrapposto per questo dipendente', 'TRANSFER_OVERLAP');
    return;
  }

  const warnings = await getShiftWarningCounts(
    companyId,
    body.user_id,
    body.start_date,
    body.end_date,
    body.target_store_id,
    originStoreId,
  );

  const createdRow = await queryOne<TransferWithNames>(
    `INSERT INTO temporary_store_assignments (
       company_id, user_id, origin_store_id, target_store_id,
       start_date, end_date, cancel_origin_shifts, status, reason, notes, created_by
     )
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, 'active', $8, $9, $10)
     RETURNING id, company_id, user_id, origin_store_id, target_store_id,
               start_date, end_date, cancel_origin_shifts, status, reason, notes, created_by,
               cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at`,
    [
      companyId,
      body.user_id,
      originStoreId,
      body.target_store_id,
      body.start_date,
      body.end_date,
      shouldCancelOriginShifts,
      body.reason ?? null,
      body.notes ?? null,
      callerId,
    ],
  );

  if (!createdRow) {
    badRequest(res, 'Impossibile creare il trasferimento', 'TRANSFER_CREATE_FAILED');
    return;
  }

  let cancelledOriginShiftsCount = 0;
  if (shouldCancelOriginShifts) {
    const cancelledOriginShifts = await query<{ id: number }>(
      `UPDATE shifts
       SET status = 'cancelled',
           cancelled_by_transfer_id = $1,
           updated_at = NOW()
       WHERE company_id = $2
         AND user_id = $3
         AND store_id = $4
         AND status != 'cancelled'
         AND date BETWEEN $5 AND $6
       RETURNING id`,
      [createdRow.id, companyId, body.user_id, originStoreId, body.start_date, body.end_date],
    );
    cancelledOriginShiftsCount = cancelledOriginShifts.length;
  }

  await query(
    `UPDATE shifts
     SET assignment_id = $1,
         cancelled_by_transfer_id = NULL
     WHERE company_id = $2
       AND user_id = $3
       AND store_id = $4
       AND status != 'cancelled'
       AND date BETWEEN $5 AND $6`,
    [createdRow.id, companyId, body.user_id, body.target_store_id, body.start_date, body.end_date],
  );

  const createdTransfer = await getTransferByIdInScope(createdRow.id, [companyId]);
  if (!createdTransfer) {
    badRequest(res, 'Impossibile recuperare il trasferimento creato', 'TRANSFER_CREATE_FAILED');
    return;
  }

  created(
    res,
    {
      transfer: createdTransfer,
      warnings,
      origin_shifts_cancelled: cancelledOriginShiftsCount,
    },
    'Trasferimento temporaneo creato',
  );
});

export const updateTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const { role, userId: callerId } = req.user!;
  const body = req.body as {
    origin_store_id?: number | null;
    target_store_id?: number;
    start_date?: string;
    end_date?: string;
    cancel_origin_shifts?: boolean;
    reason?: string | null;
    notes?: string | null;
  };

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const existing = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!existing) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  if (role === 'area_manager') {
    const canManageCurrent = await enforceAreaManagerWriteScope(callerId, existing.company_id, [existing.origin_store_id, existing.target_store_id]);
    if (!canManageCurrent) {
      forbidden(res, 'Accesso negato');
      return;
    }
  }

  if (existing.status !== 'active') {
    badRequest(res, 'Puoi modificare solo trasferimenti attivi', 'INVALID_TRANSFER_STATE');
    return;
  }

  const nextOriginStoreId = body.origin_store_id ?? existing.origin_store_id;
  const nextTargetStoreId = body.target_store_id ?? existing.target_store_id;
  const nextStartDate = body.start_date ?? existing.start_date;
  const nextEndDate = body.end_date ?? existing.end_date;
  const nextCancelOriginShifts = body.cancel_origin_shifts ?? existing.cancel_origin_shifts;

  if (nextStartDate > nextEndDate) {
    badRequest(res, 'La data di inizio non puo essere successiva alla data di fine', 'INVALID_DATE_RANGE');
    return;
  }

  if (nextOriginStoreId === nextTargetStoreId) {
    badRequest(res, 'Negozio origine e destinazione devono essere diversi', 'INVALID_TRANSFER_STORES');
    return;
  }

  const validStores = await query<{ id: number }>(
    `SELECT id
     FROM stores
     WHERE company_id = $1
       AND is_active = true
       AND id = ANY($2::int[])`,
    [existing.company_id, [nextOriginStoreId, nextTargetStoreId]],
  );
  if (validStores.length !== 2) {
    notFound(res, 'Negozio non trovato');
    return;
  }

  if (role === 'area_manager') {
    const canManageNext = await enforceAreaManagerWriteScope(callerId, existing.company_id, [nextOriginStoreId, nextTargetStoreId]);
    if (!canManageNext) {
      forbidden(res, 'Accesso negato');
      return;
    }
  }

  const overlap = await queryOne<{ id: number }>(
    `SELECT id
     FROM temporary_store_assignments
     WHERE company_id = $1
       AND user_id = $2
       AND status = 'active'
       AND id != $3
       AND start_date::date <= $5::date
       AND end_date::date >= $4::date
     LIMIT 1`,
    [existing.company_id, existing.user_id, existing.id, nextStartDate, nextEndDate],
  );

  if (overlap) {
    conflict(res, 'Esiste gia un trasferimento attivo sovrapposto per questo dipendente', 'TRANSFER_OVERLAP');
    return;
  }

  const warnings = await getShiftWarningCounts(
    existing.company_id,
    existing.user_id,
    nextStartDate,
    nextEndDate,
    nextTargetStoreId,
    nextOriginStoreId,
  );

  const updated = await queryOne<TransferRow>(
    `UPDATE temporary_store_assignments
     SET origin_store_id = $1,
         target_store_id = $2,
       start_date = $3::date,
       end_date = $4::date,
         cancel_origin_shifts = $5,
         reason = $6,
         notes = $7,
         updated_at = NOW()
     WHERE id = $8
       AND company_id = $9
     RETURNING id, company_id, user_id, origin_store_id, target_store_id,
               start_date, end_date, cancel_origin_shifts, status, reason, notes, created_by,
               cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at`,
    [
      nextOriginStoreId,
      nextTargetStoreId,
      nextStartDate,
      nextEndDate,
      nextCancelOriginShifts,
      body.reason !== undefined ? body.reason : existing.reason,
      body.notes !== undefined ? body.notes : existing.notes,
      existing.id,
      existing.company_id,
    ],
  );

  if (!updated) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  await query(
    `UPDATE shifts
     SET assignment_id = NULL
     WHERE assignment_id = $1
       AND (date < $2 OR date > $3 OR store_id != $4)`,
    [existing.id, nextStartDate, nextEndDate, nextTargetStoreId],
  );

  await query(
    `UPDATE shifts
     SET assignment_id = $1,
         cancelled_by_transfer_id = NULL
     WHERE company_id = $2
       AND user_id = $3
       AND store_id = $4
       AND status != 'cancelled'
       AND date BETWEEN $5 AND $6`,
    [existing.id, existing.company_id, existing.user_id, nextTargetStoreId, nextStartDate, nextEndDate],
  );

  const restoredOriginShifts = await query<{ id: number }>(
    `UPDATE shifts
     SET status = 'scheduled',
         cancelled_by_transfer_id = NULL,
         updated_at = NOW()
     WHERE cancelled_by_transfer_id = $1
       AND (
         $2::boolean = false
         OR store_id != $3
         OR date < $4::date
         OR date > $5::date
       )
     RETURNING id`,
    [existing.id, nextCancelOriginShifts, nextOriginStoreId, nextStartDate, nextEndDate],
  );

  let cancelledOriginShiftsCount = 0;
  if (nextCancelOriginShifts) {
    const cancelledOriginShifts = await query<{ id: number }>(
      `UPDATE shifts
       SET status = 'cancelled',
           cancelled_by_transfer_id = $1,
           updated_at = NOW()
       WHERE company_id = $2
         AND user_id = $3
         AND store_id = $4
         AND status != 'cancelled'
         AND date BETWEEN $5::date AND $6::date
       RETURNING id`,
      [existing.id, existing.company_id, existing.user_id, nextOriginStoreId, nextStartDate, nextEndDate],
    );
    cancelledOriginShiftsCount = cancelledOriginShifts.length;
  }

  const updatedTransfer = await getTransferByIdInScope(existing.id, [existing.company_id]);
  if (!updatedTransfer) {
    badRequest(res, 'Impossibile recuperare il trasferimento aggiornato', 'TRANSFER_UPDATE_FAILED');
    return;
  }

  ok(
    res,
    {
      transfer: updatedTransfer,
      warnings,
      origin_shifts_cancelled: cancelledOriginShiftsCount,
      origin_shifts_restored: restoredOriginShifts.length,
    },
    'Trasferimento aggiornato',
  );
});

export const cancelTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const { role, userId: callerId, storeId } = req.user!;
  const { reason, restore_origin_shifts } = req.body as {
    reason?: string | null;
    restore_origin_shifts?: boolean;
  };
  const shouldRestoreOriginShifts = restore_origin_shifts !== false;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const transfer = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!transfer) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const allowed = await canReadTransfer(transfer, role, callerId, storeId);
  if (!allowed) {
    forbidden(res, 'Accesso negato');
    return;
  }

  if (transfer.status !== 'active') {
    badRequest(res, 'Il trasferimento non e attivo', 'INVALID_TRANSFER_STATE');
    return;
  }

  const cancelled = await queryOne<TransferRow>(
    `UPDATE temporary_store_assignments
     SET status = 'cancelled',
         cancelled_by = $1,
         cancelled_at = NOW(),
         cancellation_reason = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, company_id, user_id, origin_store_id, target_store_id,
               start_date, end_date, cancel_origin_shifts, status, reason, notes, created_by,
               cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at`,
    [callerId, reason ?? null, transfer.id],
  );

  if (!cancelled) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const cancelledTargetShifts = await query<{ id: number }>(
    `UPDATE shifts
     SET status = 'cancelled',
         assignment_id = $5,
         cancelled_by_transfer_id = NULL,
         updated_at = NOW()
     WHERE company_id = $1
       AND user_id = $2
       AND status != 'cancelled'
       AND date BETWEEN $3::date AND $4::date
       AND (
         assignment_id = $5
         OR store_id = $6
       )
     RETURNING id`,
    [
      transfer.company_id,
      transfer.user_id,
      transfer.start_date,
      transfer.end_date,
      transfer.id,
      transfer.target_store_id,
    ],
  );

  let restoredOriginShifts: Array<{ id: number }> = [];
  if (shouldRestoreOriginShifts) {
    restoredOriginShifts = await query<{ id: number }>(
      `UPDATE shifts
       SET status = 'scheduled',
           cancelled_by_transfer_id = NULL,
           updated_at = NOW()
       WHERE company_id = $1
         AND user_id = $2
         AND cancelled_by_transfer_id = $3
       RETURNING id`,
      [
        transfer.company_id,
        transfer.user_id,
        transfer.id,
      ],
    );
  }

  const cancelledTransfer = await getTransferByIdInScope(transfer.id, [transfer.company_id]);
  if (!cancelledTransfer) {
    badRequest(res, 'Impossibile recuperare il trasferimento annullato', 'TRANSFER_CANCEL_FAILED');
    return;
  }

  ok(
    res,
    {
      transfer: cancelledTransfer,
      cancelled_shifts: cancelledTargetShifts.length,
      cancelled_target_shifts: cancelledTargetShifts.length,
      restored_origin_shifts: restoredOriginShifts.length,
      restore_original_shifts_enabled: shouldRestoreOriginShifts,
      // Keep legacy field for backward compatibility with older frontend clients.
      detached_shifts: cancelledTargetShifts.length,
    },
    'Trasferimento annullato',
  );
});

export const deleteTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const transfer = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!transfer) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const allowed = await canReadTransfer(transfer, role, userId, storeId);
  if (!allowed) {
    forbidden(res, 'Accesso negato');
    return;
  }

  const restoredOriginShifts = await query<{ id: number }>(
    `UPDATE shifts
     SET status = 'scheduled',
         cancelled_by_transfer_id = NULL,
         updated_at = NOW()
     WHERE company_id = $1
       AND user_id = $2
       AND cancelled_by_transfer_id = $3
     RETURNING id`,
    [transfer.company_id, transfer.user_id, transfer.id],
  );

  const deletedTargetShifts = await query<{ id: number }>(
    `DELETE FROM shifts
     WHERE company_id = $1
       AND user_id = $2
       AND (
         assignment_id = $3
         OR (
           $4 = 'cancelled'
           AND store_id = $5
           AND status = 'cancelled'
           AND date BETWEEN $6::date AND $7::date
           AND updated_at >= COALESCE($8::timestamptz, '-infinity'::timestamptz)
         )
       )
     RETURNING id`,
    [
      transfer.company_id,
      transfer.user_id,
      transfer.id,
      transfer.status,
      transfer.target_store_id,
      transfer.start_date,
      transfer.end_date,
      transfer.cancelled_at,
    ],
  );

  const deleted = await queryOne<{ id: number }>(
    `DELETE FROM temporary_store_assignments
     WHERE id = $1
     RETURNING id`,
    [transfer.id],
  );

  if (!deleted) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  ok(
    res,
    {
      id: transfer.id,
      deleted_target_shifts: deletedTargetShifts.length,
      restored_origin_shifts: restoredOriginShifts.length,
      // Keep legacy field for backward compatibility with older frontend clients.
      detached_shifts: deletedTargetShifts.length,
    },
    'Trasferimento eliminato',
  );
});

export const completeTransfer = asyncHandler(async (req: Request, res: Response) => {
  const transferId = parseInt(req.params.id, 10);
  if (Number.isNaN(transferId)) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const transfer = await getTransferByIdInScope(transferId, allowedCompanyIds);

  if (!transfer) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  if (transfer.status !== 'active') {
    badRequest(res, 'Il trasferimento non e attivo', 'INVALID_TRANSFER_STATE');
    return;
  }

  const completed = await queryOne<TransferRow>(
    `UPDATE temporary_store_assignments
     SET status = 'completed',
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, company_id, user_id, origin_store_id, target_store_id,
               start_date, end_date, cancel_origin_shifts, status, reason, notes, created_by,
               cancelled_by, cancelled_at, cancellation_reason, created_at, updated_at`,
    [transfer.id],
  );

  if (!completed) {
    notFound(res, 'Trasferimento non trovato', 'TRANSFER_NOT_FOUND');
    return;
  }

  const completedTransfer = await getTransferByIdInScope(transfer.id, [transfer.company_id]);
  if (!completedTransfer) {
    badRequest(res, 'Impossibile recuperare il trasferimento completato', 'TRANSFER_UPDATE_FAILED');
    return;
  }

  ok(res, completedTransfer, 'Trasferimento completato');
});

export const listTransferBlocks = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId } = req.user!;
  const queryParams = req.query as Record<string, string>;

  const range = resolveDateRangeFromQuery(queryParams);
  if (!range) {
    badRequest(res, 'Intervallo date non valido', 'INVALID_DATE_RANGE');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const scope = await buildTransferReadScope(role, allowedCompanyIds, userId, storeId);
  const statusFilter = queryParams.status;

  let extraWhere = '';
  const extraParams: any[] = [range.dateFrom, range.dateTo];
  let idx = scope.params.length + 3;

  if (statusFilter && statusFilter !== 'all') {
    if (!['active', 'completed', 'cancelled'].includes(statusFilter)) {
      badRequest(res, 'status non valido', 'VALIDATION_ERROR');
      return;
    }
    extraWhere += ` AND tsa.status = $${idx}`;
    extraParams.push(statusFilter);
    idx++;
  } else if (!statusFilter) {
    // Keep backward-compatible default behavior for callers that do not pass status.
    extraWhere += ` AND tsa.status = 'active'`;
  }

  if (queryParams.store_id) {
    const parsedStoreId = parseInt(queryParams.store_id, 10);
    if (Number.isNaN(parsedStoreId)) {
      badRequest(res, 'store_id non valido', 'VALIDATION_ERROR');
      return;
    }
    extraWhere += ` AND (tsa.origin_store_id = $${idx} OR tsa.target_store_id = $${idx})`;
    extraParams.push(parsedStoreId);
    idx++;
  }

  const rows = await query<TransferWithNames>(
    `SELECT ${TRANSFER_SELECT}
     ${TRANSFER_JOINS}
     WHERE ${scope.where}
       AND tsa.end_date::date >= $${scope.params.length + 1}::date
       AND tsa.start_date::date <= $${scope.params.length + 2}::date
       ${extraWhere}
     ORDER BY tsa.start_date ASC, u.surname ASC, u.name ASC`,
    [...scope.params, ...extraParams],
  );

  ok(res, {
    date_from: range.dateFrom,
    date_to: range.dateTo,
    blocks: rows,
  });
});

export const listTransferGuests = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId } = req.user!;
  const queryParams = req.query as Record<string, string>;

  const date = queryParams.date || isoToday();
  const parsedStoreId = queryParams.store_id ? parseInt(queryParams.store_id, 10) : null;

  let targetStoreId: number | null = null;
  if (role === 'store_manager') {
    targetStoreId = storeId;
  } else {
    targetStoreId = parsedStoreId;
  }

  if (!targetStoreId || Number.isNaN(targetStoreId)) {
    badRequest(res, 'store_id obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const store = await queryOne<{ id: number; company_id: number }>(
    `SELECT id, company_id
     FROM stores
     WHERE id = $1
       AND company_id = ANY($2)`,
    [targetStoreId, allowedCompanyIds],
  );

  if (!store) {
    notFound(res, 'Negozio non trovato');
    return;
  }

  if (role === 'area_manager') {
    const managed = await enforceAreaManagerWriteScope(userId, store.company_id, [targetStoreId]);
    if (!managed) {
      forbidden(res, 'Accesso negato');
      return;
    }
  }

  const guests = await query<TransferWithNames>(
    `SELECT ${TRANSFER_SELECT}
     ${TRANSFER_JOINS}
     WHERE tsa.company_id = $1
       AND tsa.target_store_id = $2
       AND tsa.status = 'active'
       AND tsa.start_date::date <= $3::date
       AND tsa.end_date::date >= $3::date
     ORDER BY u.surname ASC, u.name ASC`,
    [store.company_id, targetStoreId, date],
  );

  ok(res, {
    date,
    store_id: targetStoreId,
    guests,
  });
});

export const getEmployeeUnifiedSchedule = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = parseInt(req.params.userId, 10);
  if (Number.isNaN(employeeId)) {
    badRequest(res, 'userId non valido', 'VALIDATION_ERROR');
    return;
  }

  const queryParams = req.query as Record<string, string>;
  const range = resolveDateRangeFromQuery(queryParams) ?? {
    dateFrom: isoToday(),
    dateTo: isoToday(),
  };

  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const employee = await queryOne<{
    id: number;
    company_id: number;
    store_id: number | null;
    name: string;
    surname: string;
    role: string;
    avatar_filename: string | null;
  }>(
    `SELECT id, company_id, store_id, name, surname, role, avatar_filename
     FROM users
     WHERE id = $1
       AND company_id = ANY($2)`,
    [employeeId, allowedCompanyIds],
  );

  if (!employee || employee.role !== 'employee') {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  if (role === 'store_manager') {
    const hasDirectAccess = employee.store_id === storeId;
    if (!hasDirectAccess) {
      const hasTransferAccess = await queryOne<{ id: number }>(
        `SELECT id
         FROM temporary_store_assignments
         WHERE company_id = $1
           AND user_id = $2
           AND (origin_store_id = $3 OR target_store_id = $3)
           AND end_date::date >= $4::date
           AND start_date::date <= $5::date
         LIMIT 1`,
        [employee.company_id, employee.id, storeId, range.dateFrom, range.dateTo],
      );
      if (!hasTransferAccess) {
        forbidden(res, 'Accesso negato');
        return;
      }
    }
  }

  if (role === 'area_manager') {
    const managedStoreIds = await getAreaManagerStoreIds(userId, [employee.company_id]);
    const managedSet = new Set(managedStoreIds);
    const hasDirectAccess = employee.store_id != null && managedSet.has(employee.store_id);

    if (!hasDirectAccess) {
      const hasTransferAccess = await queryOne<{ id: number }>(
        `SELECT id
         FROM temporary_store_assignments
         WHERE company_id = $1
           AND user_id = $2
           AND (origin_store_id = ANY($3::int[]) OR target_store_id = ANY($3::int[]))
           AND end_date::date >= $4::date
           AND start_date::date <= $5::date
         LIMIT 1`,
        [employee.company_id, employee.id, managedStoreIds, range.dateFrom, range.dateTo],
      );
      if (!hasTransferAccess) {
        forbidden(res, 'Accesso negato');
        return;
      }
    }
  }

  const shifts = await query(
    `SELECT s.id, s.company_id, s.user_id, s.store_id, s.assignment_id,
            s.date, s.start_time, s.end_time, s.break_start, s.break_end,
            s.break_type, s.break_minutes, s.is_split, s.split_start2, s.split_end2,
            s.status, s.notes, s.created_at, s.updated_at,
            st.name AS store_name
     FROM shifts s
     JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1
       AND s.user_id = $2
       AND s.date BETWEEN $3 AND $4
     ORDER BY s.date ASC, s.start_time ASC`,
    [employee.company_id, employee.id, range.dateFrom, range.dateTo],
  );

  const assignments = await query<TransferWithNames>(
    `SELECT ${TRANSFER_SELECT}
     ${TRANSFER_JOINS}
     WHERE tsa.company_id = $1
       AND tsa.user_id = $2
       AND tsa.end_date::date >= $3::date
       AND tsa.start_date::date <= $4::date
     ORDER BY tsa.start_date ASC`,
    [employee.company_id, employee.id, range.dateFrom, range.dateTo],
  );

  ok(res, {
    date_from: range.dateFrom,
    date_to: range.dateTo,
    employee,
    shifts,
    assignments,
  });
});
