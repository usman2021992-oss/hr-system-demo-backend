// src/modules/window-display/window-display.controller.ts
import { Request, Response } from 'express';
import { pool, query, queryOne } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, notFound, conflict } from '../../utils/response';
import { CUSTOM_ACTIVITY_TYPE, WindowDisplayActivityType } from './activity-types';

interface WindowDisplayActivity {
  id: number;
  company_id: number;
  store_id: number;
  store_name?: string | null;
  date: string; // Deprecated: use start_date
  start_date: string;
  end_date: string;
  year_month: string;
  flagged_by: number;
  activity_type: WindowDisplayActivityType;
  activity_icon: string | null;
  custom_activity_name: string | null;
  duration_hours: number | null;
  notes: string | null;
  flagged_by_name?: string | null;
  flagged_by_surname?: string | null;
  created_at: string;
  updated_at: string;
}

type OptionalIntParseResult =
  | { ok: true; value: number | null }
  | { ok: false };

function parseOptionalPositiveInt(value: unknown): OptionalIntParseResult {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function resolveRequestedCompanyId(req: Request): OptionalIntParseResult {
  const parsed = parseOptionalPositiveInt(req.query?.company_id ?? req.body?.company_id);
  if (!parsed.ok) return parsed;

  if (parsed.value != null) {
    return { ok: true, value: parsed.value };
  }

  // Super admins should default to all-company scope when no explicit company
  // target is provided, even if their token carries a home company id.
  if (req.user?.is_super_admin === true) {
    return { ok: true, value: null };
  }

  return { ok: true, value: req.user!.companyId };
}

const WINDOW_DISPLAY_SELECT = `
  SELECT
    wda.id,
    wda.company_id,
    wda.store_id,
    s.name AS store_name,
    TO_CHAR(wda.date, 'YYYY-MM-DD') AS date,
    TO_CHAR(wda.start_date, 'YYYY-MM-DD') AS start_date,
    TO_CHAR(wda.end_date, 'YYYY-MM-DD') AS end_date,
    wda.year_month,
    wda.flagged_by,
    wda.activity_type,
    wda.activity_icon,
    wda.custom_activity_name,
    wda.duration_hours,
    wda.notes,
    u.name AS flagged_by_name,
    u.surname AS flagged_by_surname,
    wda.created_at,
    wda.updated_at
  FROM window_display_activities wda
  JOIN stores s ON s.id = wda.store_id
  LEFT JOIN users u ON u.id = wda.flagged_by
`;

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes == null) return null;
  const value = String(notes).trim();
  return value.length > 0 ? value : null;
}

function normalizeActivityIcon(activityIcon: string | null | undefined): string | null {
  if (activityIcon == null) return null;
  const value = String(activityIcon).trim();
  return value.length > 0 ? value.slice(0, 16) : null;
}

function normalizeCustomActivityName(customActivityName: string | null | undefined): string | null {
  if (customActivityName == null) return null;
  const value = String(customActivityName).trim();
  return value.length > 0 ? value.slice(0, 120) : null;
}

async function findWindowDisplayById(companyId: number | null, id: number): Promise<WindowDisplayActivity | null> {
  if (companyId == null) {
    return queryOne<WindowDisplayActivity>(
      `${WINDOW_DISPLAY_SELECT}
       WHERE wda.id = $1`,
      [id],
    );
  }

  return queryOne<WindowDisplayActivity>(
    `${WINDOW_DISPLAY_SELECT}
     WHERE wda.company_id = $1 AND wda.id = $2`,
    [companyId, id],
  );
}

export const getWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const scopedCompany = resolveRequestedCompanyId(req);
  if (!scopedCompany.ok) return badRequest(res, 'company_id must be a positive integer');

  const companyId = scopedCompany.value;
  const rawStoreId = req.query.store_id;
  const month = String(req.query.month ?? '');

  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest(res, 'month must be YYYY-MM');

  if (rawStoreId === undefined || rawStoreId === null || rawStoreId === '') {
    const rows = companyId == null
      ? await query<WindowDisplayActivity>(
        `${WINDOW_DISPLAY_SELECT}
         WHERE wda.year_month = $1
         ORDER BY wda.date ASC, s.name ASC`,
        [month],
      )
      : await query<WindowDisplayActivity>(
        `${WINDOW_DISPLAY_SELECT}
         WHERE wda.company_id = $1 AND wda.year_month = $2
         ORDER BY wda.date ASC, s.name ASC`,
        [companyId, month],
      );
    return ok(res, rows);
  }

  const storeId = parseInt(String(rawStoreId), 10);
  if (isNaN(storeId)) return badRequest(res, 'store_id must be a number');

  // A store can now hold multiple activities in a month (one per date), so this
  // returns the full list for the store instead of a single row.
  const rows = companyId == null
    ? await query<WindowDisplayActivity>(
      `${WINDOW_DISPLAY_SELECT}
       WHERE wda.store_id = $1 AND wda.year_month = $2
       ORDER BY wda.start_date ASC`,
      [storeId, month],
    )
    : await query<WindowDisplayActivity>(
      `${WINDOW_DISPLAY_SELECT}
       WHERE wda.company_id = $1 AND wda.store_id = $2 AND wda.year_month = $3
       ORDER BY wda.start_date ASC`,
      [companyId, storeId, month],
    );

  return ok(res, rows);
});

export const createWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const scopedCompany = resolveRequestedCompanyId(req);
  if (!scopedCompany.ok) return badRequest(res, 'company_id must be a positive integer');

  const companyId = scopedCompany.value;
  const {
    store_id,
    date, // Deprecated: use start_date/end_date
    start_date,
    end_date,
    dates, // New: one activity per date (multi-date create)
    activity_type,
    activity_icon,
    custom_activity_name,
    duration_hours,
    notes,
  } = req.body as {
    store_id: number;
    date?: string; // Deprecated
    start_date?: string;
    end_date?: string;
    dates?: string[];
    activity_type?: WindowDisplayActivityType;
    activity_icon?: string | null;
    custom_activity_name?: string | null;
    duration_hours?: number | null;
    notes?: string | null;
  };

  const normalizedNotes = normalizeNotes(notes);
  const nextActivityType = activity_type ?? 'window_display';
  const normalizedActivityIcon = normalizeActivityIcon(activity_icon);
  const normalizedCustomActivityName = normalizeCustomActivityName(custom_activity_name);

  if (nextActivityType === CUSTOM_ACTIVITY_TYPE && !normalizedCustomActivityName) {
    return badRequest(res, 'custom_activity_name is required when activity_type is custom_activity');
  }
  if (nextActivityType !== CUSTOM_ACTIVITY_TYPE && normalizedCustomActivityName) {
    return badRequest(res, 'custom_activity_name can only be used when activity_type is custom_activity');
  }

  // Verify store belongs to this company
  const store = companyId == null
    ? await queryOne<{ id: number; company_id: number }>(
      'SELECT id, company_id FROM stores WHERE id = $1',
      [store_id],
    )
    : await queryOne<{ id: number; company_id: number }>(
      'SELECT id, company_id FROM stores WHERE id = $1 AND company_id = $2',
      [store_id, companyId],
    );
  if (!store) return notFound(res, 'Store not found');

  const targetCompanyId = store.company_id;

  const customName = nextActivityType === CUSTOM_ACTIVITY_TYPE ? normalizedCustomActivityName : null;
  const INSERT_SQL = `INSERT INTO window_display_activities
       (company_id, store_id, date, start_date, end_date, year_month, flagged_by, activity_type, activity_icon, custom_activity_name, duration_hours, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  const rowValues = (theDate: string) => [
    targetCompanyId,
    store_id,
    theDate,
    theDate,
    theDate,
    theDate.slice(0, 7),
    userId,
    nextActivityType,
    normalizedActivityIcon,
    customName,
    duration_hours ?? null,
    normalizedNotes,
  ];

  // ---- New multi-date path: create one single-day activity per selected date ----
  // Dates that already have an activity are skipped (not an error) and reported back.
  if (Array.isArray(dates) && dates.length > 0) {
    const uniqueDates = Array.from(new Set(dates)).sort();
    const client = await pool.connect();
    const createdIds: number[] = [];
    const skipped: string[] = [];
    try {
      await client.query('BEGIN');
      for (const theDate of uniqueDates) {
        const result = await client.query<{ id: number }>(
          `${INSERT_SQL} ON CONFLICT (store_id, start_date) DO NOTHING RETURNING id`,
          rowValues(theDate),
        );
        if (result.rows[0]?.id) createdIds.push(result.rows[0].id);
        else skipped.push(theDate);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const createdRows: WindowDisplayActivity[] = [];
    for (const id of createdIds) {
      const row = await findWindowDisplayById(targetCompanyId, id);
      if (row) createdRows.push(row);
    }
    return created(res, { created: createdRows, skipped });
  }

  // ---- Legacy single-date path (back-compat with date / start_date+end_date) ----
  const activityStartDate = start_date || date;
  const activityEndDate = end_date || date;

  if (!activityStartDate || !activityEndDate) {
    return badRequest(res, 'start_date and end_date are required');
  }

  if (activityEndDate < activityStartDate) {
    return badRequest(res, 'end_date must be greater than or equal to start_date');
  }

  try {
    const inserted = await queryOne<{ id: number }>(
      `${INSERT_SQL} RETURNING id`,
      [
        targetCompanyId,
        store_id,
        activityStartDate, // Keep date for backward compatibility
        activityStartDate,
        activityEndDate,
        activityStartDate.slice(0, 7),
        userId,
        nextActivityType,
        normalizedActivityIcon,
        customName,
        duration_hours ?? null,
        normalizedNotes,
      ],
    );

    const row = await findWindowDisplayById(targetCompanyId, inserted!.id);
    return created(res, row!);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return conflict(res, 'An activity already exists on this date for this store. Please pick another date.', 'WINDOW_DISPLAY_ALREADY_SET');
    }
    throw err;
  }
});

export const updateWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const scopedCompany = resolveRequestedCompanyId(req);
  if (!scopedCompany.ok) return badRequest(res, 'company_id must be a positive integer');

  const companyId = scopedCompany.value;
  const id = Number(req.params.id);
  const {
    date, // Deprecated
    start_date,
    end_date,
    activity_type,
    activity_icon,
    custom_activity_name,
    duration_hours,
    notes,
  } = req.body as {
    date?: string; // Deprecated
    start_date?: string;
    end_date?: string;
    activity_type?: WindowDisplayActivityType;
    activity_icon?: string | null;
    custom_activity_name?: string | null;
    duration_hours?: number | null;
    notes?: string | null;
  };

  const existing = companyId == null
    ? await queryOne<WindowDisplayActivity>(
      `SELECT
         id,
         TO_CHAR(date, 'YYYY-MM-DD') AS date,
         TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
         TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
         year_month,
         activity_type,
         activity_icon,
         custom_activity_name,
         duration_hours,
         notes,
         company_id,
         store_id,
         flagged_by,
         created_at,
         updated_at
       FROM window_display_activities
       WHERE id = $1`,
      [id],
    )
    : await queryOne<WindowDisplayActivity>(
      `SELECT
         id,
         TO_CHAR(date, 'YYYY-MM-DD') AS date,
         TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
         TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
         year_month,
         activity_type,
         activity_icon,
         custom_activity_name,
         duration_hours,
         notes,
         company_id,
         store_id,
         flagged_by,
         created_at,
         updated_at
       FROM window_display_activities
       WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
  if (!existing) return notFound(res, 'Window display activity not found');

  // Support both old (date) and new (start_date/end_date) formats
  const nextStartDate = start_date || date || existing.start_date;
  const nextEndDate = end_date || date || existing.end_date;

  if (nextEndDate < nextStartDate) {
    return badRequest(res, 'end_date must be greater than or equal to start_date');
  }

  const nextYearMonth = nextStartDate.slice(0, 7);
  const nextActivityType = activity_type ?? existing.activity_type;
  const nextActivityIcon = activity_icon !== undefined ? normalizeActivityIcon(activity_icon) : normalizeActivityIcon(existing.activity_icon);
  const nextCustomActivityNameCandidate = custom_activity_name !== undefined
    ? normalizeCustomActivityName(custom_activity_name)
    : normalizeCustomActivityName(existing.custom_activity_name);
  const nextCustomActivityName = nextActivityType === CUSTOM_ACTIVITY_TYPE
    ? nextCustomActivityNameCandidate
    : null;
  const nextDurationHours = duration_hours !== undefined ? duration_hours : existing.duration_hours;
  const nextNotes = notes !== undefined ? normalizeNotes(notes) : normalizeNotes(existing.notes);

  if (custom_activity_name !== undefined && nextActivityType !== CUSTOM_ACTIVITY_TYPE && nextCustomActivityNameCandidate) {
    return badRequest(res, 'custom_activity_name can only be used when activity_type is custom_activity');
  }

  if (nextActivityType === CUSTOM_ACTIVITY_TYPE && !nextCustomActivityName) {
    return badRequest(res, 'custom_activity_name is required when activity_type is custom_activity');
  }

  try {
    await queryOne<WindowDisplayActivity>(
      `UPDATE window_display_activities
       SET date = $1,
           start_date = $2,
           end_date = $3,
           year_month = $4,
           activity_type = $5,
           activity_icon = $6,
           custom_activity_name = $7,
           duration_hours = $8,
           notes = $9,
           updated_at = NOW()
         WHERE id = $10`,
        [nextStartDate, nextStartDate, nextEndDate, nextYearMonth, nextActivityType, nextActivityIcon, nextCustomActivityName, nextDurationHours, nextNotes, id],
    );

    const row = await findWindowDisplayById(companyId, id);
    return ok(res, row!);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return conflict(res, 'Another activity already exists on this date for this store. Please pick another date.', 'WINDOW_DISPLAY_ALREADY_SET');
    }
    throw err;
  }
});

export const deleteWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const scopedCompany = resolveRequestedCompanyId(req);
  if (!scopedCompany.ok) return badRequest(res, 'company_id must be a positive integer');

  const companyId = scopedCompany.value;
  const id = Number(req.params.id);

  const existing = companyId == null
    ? await queryOne<{ id: number }>(
      'SELECT id FROM window_display_activities WHERE id = $1',
      [id],
    )
    : await queryOne<{ id: number }>(
      'SELECT id FROM window_display_activities WHERE id = $1 AND company_id = $2',
      [id, companyId],
    );
  if (!existing) return notFound(res, 'Window display activity not found');

  await query('DELETE FROM window_display_activities WHERE id = $1', [id]);
  return ok(res, { deleted: true });
});
