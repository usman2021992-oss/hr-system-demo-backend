import { Request, Response } from 'express';
import { pool, query, queryOne } from '../../config/database';
import { ok, created, badRequest, conflict, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { assertLicenseCapacity } from '../billing/license.service';
import bcrypt from 'bcryptjs';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';
import { revokeAllRefreshTokensForUser } from '../auth/refreshTokens';
import { recordHeadcountEvent } from '../billing/headcount.service';
import { resolveAreaManagerStoreIds } from '../../utils/storeScope';

/**
 * Whether the terminal has actually completed device registration.
 *
 * This is distinct from `users.status`, which only says whether the account is
 * enabled for login. A terminal whose credentials were created but which was
 * never registered on a device is `status = 'active'` yet cannot take any
 * attendance — reporting it simply as "Active" is what made GRA-01 look ready
 * when it was not.
 */
const REGISTRATION_STATE_SQL = `
  CASE
    WHEN u.registered_device_token IS NULL AND u.registered_device_identifier IS NULL THEN 'pending'
    WHEN u.device_reset_pending THEN 'reset_pending'
    ELSE 'registered'
  END`;

/**
 * An archived terminal keeps its row, but not its address.
 *
 * `users.email` is unique, and the usual reason for archiving a terminal is to
 * create a fresh one for the same store — normally with the same address. So
 * the address is parked under a prefix that carries the id, which frees it
 * immediately and hands it back if the terminal is ever restored.
 */
const ARCHIVED_EMAIL_PREFIX = 'deleted:';

function archivedEmail(id: number, email: string): string {
  return `${ARCHIVED_EMAIL_PREFIX}${id}:${email}`.slice(0, 255);
}

/** The address an archived terminal had before it was archived. */
export function originalEmail(email: string): string {
  const match = /^deleted:\d+:(.+)$/.exec(email);
  return match ? match[1] : email;
}

/** Writes the trail for one terminal operation. Never throws. */
async function recordTerminalAudit(params: {
  client?: { query: Function };
  companyId: number;
  actorId: number;
  action: string;
  terminalId: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  const runner = params.client ?? { query };
  try {
    await runner.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
       VALUES ($1, $2, $3, 'user', $4, $5)`,
      [params.companyId, params.actorId, params.action, params.terminalId, params.details ?? null],
    );
  } catch (err: any) {
    console.error(`[Terminals] Could not record ${params.action}:`, err?.message || err);
  }
}

interface ScopedTerminal {
  id: number;
  company_id: number;
  store_id: number | null;
  name: string | null;
  email: string;
  status: string;
  deleted_at: string | null;
}

/**
 * The terminal, when the caller may act on it. `includeArchived` is for the
 * Super Admin's deleted view; every other path refuses to touch an archived row.
 */
async function resolveTerminal(
  req: Request,
  terminalId: number,
  includeArchived = false,
): Promise<ScopedTerminal | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  return queryOne<ScopedTerminal>(
    `SELECT u.id, u.company_id, u.store_id, u.name, u.email, u.status, u.deleted_at
     FROM users u
     WHERE u.id = $1 AND u.role = 'store_terminal' AND u.company_id = ANY($2)
       ${includeArchived ? '' : 'AND u.deleted_at IS NULL'}`,
    [terminalId, allowedCompanyIds],
  );
}

export const listTerminals = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, companyId: callerCompanyId } = req.user!;
  const { search, status, registration, company_id, store_id, page = '1', limit = '20' } = req.query as Record<string, string>;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  
  // The deleted view belongs to the Super Admin alone; everyone else only ever
  // sees live terminals.
  const wantsArchived = String((req.query as Record<string, string>).deleted ?? '') === 'true';
  const showArchived = wantsArchived && req.user!.is_super_admin === true;

  let where = `u.role = 'store_terminal' AND u.deleted_at IS ${showArchived ? 'NOT NULL' : 'NULL'}`;
  const params: any[] = [];

  // Company filtering based on role and query
  if (company_id) {
    const ids = company_id.split(',').map(id => parseInt(id, 10)).filter(Number.isInteger);
    if (ids.length > 0) {
      const filteredIds = ids.filter(id => allowedCompanyIds.includes(id));
      if (filteredIds.length > 0) {
        params.push(filteredIds);
        where += ` AND u.company_id = ANY($${params.length})`;
      } else {
        where += " AND 1=0";
      }
    } else {
      where += " AND 1=0";
    }
  } else {
    params.push(allowedCompanyIds);
    where += ` AND u.company_id = ANY($${params.length})`;
  }

  // A store manager sees their own store's terminal, an area manager the ones
  // in the stores they run. Seeing every terminal in the company is for the
  // roles that manage them.
  if (role === 'store_manager') {
    if (req.user!.storeId == null) {
      where += ' AND 1=0';
    } else {
      params.push(req.user!.storeId);
      where += ` AND u.store_id = $${params.length}`;
    }
  } else if (role === 'area_manager') {
    const areaStoreIds = await resolveAreaManagerStoreIds(userId, allowedCompanyIds);
    if (areaStoreIds.length === 0) {
      where += ' AND 1=0';
    } else {
      params.push(areaStoreIds);
      where += ` AND u.store_id = ANY($${params.length})`;
    }
  }

  // Store filtering
  if (store_id) {
    const ids = store_id.split(',').map(id => parseInt(id, 10)).filter(Number.isInteger);
    if (ids.length > 0) {
      params.push(ids);
      where += ` AND u.store_id = ANY($${params.length})`;
    }
  }

  // Status filtering
  if (status) {
    params.push(status);
    where += ` AND u.status = $${params.length}`;
  }

  // Registration filtering ('pending' | 'reset_pending' | 'registered')
  if (registration) {
    const states = registration.split(',').map(s => s.trim()).filter(Boolean);
    if (states.length > 0) {
      params.push(states);
      where += ` AND ${REGISTRATION_STATE_SQL} = ANY($${params.length})`;
    }
  }

  // Search filtering (name or email)
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }

  // Count total for pagination
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`,
    params
  ).catch(err => {
    console.error('Error in listTerminals count query:', err);
    throw err;
  });
  const total = parseInt(countRow?.count || '0', 10);

  // Fetch data
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  params.push(limitNum, offset);
  const terminals = await query(`
    SELECT 
      u.id, 
      u.name, 
      u.email, 
      u.role, 
      u.status, 
      u.company_id,
      u.store_id,
      -- The password is deliberately not here: it is read one terminal at a
      -- time, by a role allowed to manage terminals, and that read is logged.
      u.device_reset_pending,
      u.deleted_at,
      TRIM(CONCAT(db.name, ' ', db.surname)) AS deleted_by_name,
      ((u.registered_device_token IS NOT NULL) OR (u.registered_device_identifier IS NOT NULL)) AS device_registered,
      u.registered_device_registered_at AS device_registered_at,
      u.registered_device_metadata AS device_metadata,
      u.last_seen_ip,
      u.last_seen_at,
      ${REGISTRATION_STATE_SQL} AS registration_state,
      u.created_at,
      u.updated_at,
      TRIM(CONCAT(cb.name, ' ', cb.surname)) AS created_by_name,
      TRIM(CONCAT(ub.name, ' ', ub.surname)) AS updated_by_name,
      c.name as company_name,
      s.name as store_name,
      -- The store's clock, shown beside the terminal: the clock-in window this
      -- terminal opens is judged on it, not on the tablet's own setting.
      s.timezone as store_timezone
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    LEFT JOIN stores s ON s.id = u.store_id
    LEFT JOIN users cb ON cb.id = u.created_by
    LEFT JOIN users ub ON ub.id = u.updated_by
    LEFT JOIN users db ON db.id = u.deleted_by
    WHERE ${where}
    ORDER BY c.name, s.name, u.name
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params).catch(err => {
    console.error('Error in listTerminals data query:', err);
    throw err;
  });

  ok(res, {
    // An archived terminal shows the address it had, not the parked one.
    data: terminals.map((t: any) => ({ ...t, email: originalEmail(t.email) })),
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  });
});

/**
 * GET /api/terminals/:id/password — the terminal's password, one at a time.
 *
 * It used to travel in every list response, which meant any authenticated
 * employee could read every terminal password in their company and sign in as a
 * store terminal. Now it is a deliberate, logged read by a role that manages
 * terminals.
 */
export const revealTerminalPassword = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId);
  if (!terminal) return notFound(res, 'Terminal not found or access denied');

  const row = await queryOne<{ plain_password: string | null }>(
    `SELECT plain_password FROM users WHERE id = $1`,
    [terminalId],
  );

  await recordTerminalAudit({
    companyId: terminal.company_id,
    actorId: req.user!.userId,
    action: 'TERMINAL_PASSWORD_VIEW',
    terminalId,
    details: { email: terminal.email },
  });

  ok(res, { password: row?.plain_password ?? null });
});

export const listStoresWithTerminalStatus = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const stores = await query(`
    SELECT 
      s.id, 
      s.name, 
      s.code, 
      s.address, 
      s.cap, 
      s.max_staff, 
      s.company_id,
      -- The clock this store's shifts and clock-ins run on. Shown next to the
      -- terminal so whoever sets it up can see it is not necessarily their own.
      s.timezone,
      c.name as company_name,
      -- Any terminal account at all, regardless of whether it is currently
      -- enabled. Filtering on status here used to let a store with a disabled
      -- terminal look terminal-less, so a duplicate could be created for it.
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.store_id = s.id
        AND u.role = 'store_terminal'
        -- An archived terminal no longer occupies its store: the whole point of
        -- archiving one is to be able to set the store up again.
        AND u.deleted_at IS NULL
      ) as "hasTerminal"
    FROM stores s
    LEFT JOIN companies c ON c.id = s.company_id
    WHERE s.company_id = ANY($1)
    ORDER BY c.name, s.name
  `, [allowedCompanyIds]);

  ok(res, stores);
});

export const createTerminal = asyncHandler(async (req: Request, res: Response) => {
  const { store_id, email, password } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (!store_id || !email || !password) {
    return badRequest(res, 'Store ID, email and password are required');
  }

  // Verify store exists and is in scope
  const store = await queryOne<{ id: number; company_id: number; name: string }>(
    'SELECT id, company_id, name FROM stores WHERE id = $1 AND company_id = ANY($2)',
    [store_id, allowedCompanyIds]
  );

  if (!store) {
    return badRequest(res, 'Store not found or access denied');
  }

  // One terminal account per store. Deliberately not filtered by status: a
  // disabled terminal still occupies the store, and ignoring it allowed a second
  // account to be created for the same store.
  const existingTerminal = await queryOne(
    "SELECT id FROM users WHERE store_id = $1 AND role = 'store_terminal' AND deleted_at IS NULL",
    [store_id]
  );

  if (existingTerminal) {
    return conflict(res, 'A terminal already exists for this store');
  }

  // Check if email is available. An archived terminal parks its address, so the
  // only way this still collides is a live user — worth saying plainly.
  const emailExists = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (emailExists) {
    return conflict(res, 'Email already in use');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // NOTE: `status` stays 'active' because login is gated on it — a terminal
    // created as 'inactive' could never sign in to complete its registration.
    // "Has this terminal actually been registered?" is reported separately, via
    // registration_state, so the list no longer presents an unregistered
    // terminal as ready to use.
    // A terminal takes one paid license. Refuse before creating anything.
    await assertLicenseCapacity(store.company_id, 'terminal', 1);

    const terminalRes = await client.query(
      `INSERT INTO users (
         company_id, store_id, name, surname, email, password_hash, plain_password, role, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'store_terminal', 'active', $8, $8) RETURNING id, name, email, created_at`,
      [store.company_id, store.id, store.name, 'Terminale', email, passwordHash, password, req.user!.userId]
    );

    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
       VALUES ($1, $2, 'TERMINAL_CREATE', 'user', $3, $4)`,
      [store.company_id, req.user!.userId, terminalRes.rows[0].id, { store_id: store.id, email }]
    );

    await client.query('COMMIT');

    // Billing ledger: this terminal counts from now on.
    void recordHeadcountEvent({
      companyId: store.company_id,
      resourceType: 'terminal',
      changeType: 'added',
      userId: terminalRes.rows[0].id,
      userLabel: `${store.name} - Terminale`,
    });

    created(res, { ...terminalRes.rows[0], registration_state: 'pending' }, 'Terminal created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  const { email, password } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  // Verify terminal exists, is a terminal, and is in scope
  const terminal = await queryOne<{ id: number; company_id: number; email: string; plain_password?: string }>(
    `SELECT u.id, u.company_id, u.email, u.plain_password
     FROM users u
     WHERE u.id = $1 AND u.role = 'store_terminal' AND u.company_id = ANY($2)
       AND u.deleted_at IS NULL`,
    [terminalId, allowedCompanyIds]
  );

  if (!terminal) return notFound(res, 'Terminal not found or access denied');

  const updates: string[] = [];
  const params: any[] = [];

  if (email && email !== terminal.email) {
    // Check if email is available
    const emailExists = await queryOne('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, terminalId]);
    if (emailExists) {
      return conflict(res, 'Email already in use');
    }
    params.push(email);
    updates.push(`email = $${params.length}`);
  }

  if (password && password !== terminal.plain_password) {
    if (password.length < 8) {
      return badRequest(res, 'Password must be at least 8 characters');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    params.push(passwordHash);
    updates.push(`password_hash = $${params.length}`);
    params.push(password);
    updates.push(`plain_password = $${params.length}`);
  }

  if (updates.length === 0) {
    return ok(res, null, 'No updates performed');
  }

  params.push(req.user!.userId);
  updates.push(`updated_by = $${params.length}`);

  params.push(terminalId);
  await query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params
  );

  // A new terminal password ends the sessions opened with the old one.
  if (password && password !== terminal.plain_password) {
    await revokeAllRefreshTokensForUser(terminalId);
  }

  query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'TERMINAL_UPDATE', 'user', $3)`,
    [terminal.company_id, req.user!.userId, terminalId]
  ).catch(() => {});

  ok(res, null, 'Terminal updated successfully');
});

/**
 * DELETE /api/terminals/:id — archives the terminal.
 *
 * It used to delete the user row together with its attendance_events and every
 * audit_logs row naming it, so a terminal could vanish with no trace of having
 * existed. Now it is archived: the row and its history stay, the account stops
 * working and stops being billable, it leaves every list, and it waits in the
 * Super Admin's deleted view to be restored or removed for good.
 */
export const deleteTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId);
  if (!terminal) return notFound(res, 'Terminal not found or access denied');

  const wasActive = terminal.status === 'active';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users
          SET deleted_at = NOW(),
              deleted_by = $2,
              status = 'inactive',
              email = $3,
              -- Release the tablet as well. The device token is unique across
              -- users, so leaving it here would stop the same tablet being set
              -- up again on the terminal that replaces this one.
              registered_device_token = NULL,
              registered_device_identifier = NULL,
              registered_device_metadata = NULL,
              device_reset_pending = false,
              updated_by = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [terminalId, req.user!.userId, archivedEmail(terminalId, terminal.email)],
    );

    await recordTerminalAudit({
      client,
      companyId: terminal.company_id,
      actorId: req.user!.userId,
      action: 'TERMINAL_ARCHIVE',
      terminalId,
      details: { email: terminal.email, store_id: terminal.store_id, was_active: wasActive },
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // The archived account must not keep a live session.
  await revokeAllRefreshTokensForUser(terminalId).catch(() => undefined);

  // Billing: an archived terminal is inactive, so it stops counting.
  if (wasActive) {
    void recordHeadcountEvent({
      companyId: terminal.company_id,
      resourceType: 'terminal',
      changeType: 'removed',
      userId: terminalId,
      userLabel: terminal.name ?? terminal.email,
    });
  }

  ok(res, null, 'Terminal moved to deleted');
});

/**
 * POST /api/terminals/:id/restore — Super Admin only.
 *
 * Comes back inactive on purpose: reactivating it is a separate, licence-checked
 * step, so restoring something from the bin can never quietly add to the bill.
 */
export const restoreTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId, true);
  if (!terminal || !terminal.deleted_at) {
    return notFound(res, 'Deleted terminal not found or access denied');
  }

  // Give the address back if nothing has taken it in the meantime.
  const wanted = originalEmail(terminal.email);
  const taken = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE email = $1 AND id <> $2`,
    [wanted, terminalId],
  );
  const restoredEmail = taken ? terminal.email : wanted;

  // The store may have been given a new terminal while this one was archived;
  // two live terminals on one store is exactly what createTerminal prevents.
  if (terminal.store_id !== null) {
    const occupied = await queryOne<{ id: number }>(
      `SELECT id FROM users
        WHERE store_id = $1 AND role = 'store_terminal' AND deleted_at IS NULL AND id <> $2`,
      [terminal.store_id, terminalId],
    );
    if (occupied) {
      return conflict(
        res,
        'This store already has a terminal. Delete that one first, or reassign this terminal to another store.',
        'STORE_HAS_TERMINAL',
      );
    }
  }

  await query(
    `UPDATE users
        SET deleted_at = NULL,
            deleted_by = NULL,
            email = $2,
            status = 'inactive',
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [terminalId, restoredEmail, req.user!.userId],
  );

  await recordTerminalAudit({
    companyId: terminal.company_id,
    actorId: req.user!.userId,
    action: 'TERMINAL_RESTORE',
    terminalId,
    details: { email: restoredEmail, address_recovered: !taken },
  });

  ok(
    res,
    { id: terminalId, email: restoredEmail, addressRecovered: !taken },
    taken
      ? 'Terminal restored. Its old address was taken, so set a new one before activating it.'
      : 'Terminal restored. It is inactive until you activate it.',
  );
});

/**
 * DELETE /api/terminals/:id/permanent — Super Admin only, and only from the bin.
 *
 * Refuses while anything irreplaceable still points at the row. The audit trail
 * survives regardless: audit_logs.user_id is ON DELETE SET NULL since migration
 * 148, so the record of what happened outlives the account it happened to.
 */
export const permanentlyDeleteTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId, true);
  if (!terminal || !terminal.deleted_at) {
    return notFound(res, 'Deleted terminal not found or access denied');
  }

  // Attendance rows are attributed to the employee who scanned, so a terminal
  // normally owns none. If it somehow does, that is history — refuse rather
  // than delete it, and say so.
  const attendance = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM attendance_events WHERE user_id = $1`,
    [terminalId],
  );
  if ((attendance?.count ?? 0) > 0) {
    return conflict(
      res,
      `This terminal has ${attendance!.count} attendance records attached and cannot be deleted permanently. It stays in the deleted list.`,
      'TERMINAL_HAS_ATTENDANCE',
    );
  }

  await recordTerminalAudit({
    companyId: terminal.company_id,
    actorId: req.user!.userId,
    action: 'TERMINAL_DELETE_PERMANENT',
    terminalId,
    details: { email: originalEmail(terminal.email), store_id: terminal.store_id },
  });

  await query(`DELETE FROM users WHERE id = $1`, [terminalId]);

  ok(res, null, 'Terminal permanently deleted');
});

/** PATCH /api/terminals/:id/deactivate — stops the account without archiving it. */
export const deactivateTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId);
  if (!terminal) return notFound(res, 'Terminal not found or access denied');
  if (terminal.status !== 'active') return badRequest(res, 'Terminal is already inactive');

  await query(
    `UPDATE users SET status = 'inactive', updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [terminalId, req.user!.userId],
  );

  await revokeAllRefreshTokensForUser(terminalId).catch(() => undefined);

  await recordTerminalAudit({
    companyId: terminal.company_id,
    actorId: req.user!.userId,
    action: 'TERMINAL_DEACTIVATE',
    terminalId,
    details: { email: terminal.email },
  });

  void recordHeadcountEvent({
    companyId: terminal.company_id,
    resourceType: 'terminal',
    changeType: 'removed',
    userId: terminalId,
    userLabel: terminal.name ?? terminal.email,
  });

  ok(res, { id: terminalId, status: 'inactive' }, 'Terminal deactivated');
});

/**
 * PATCH /api/terminals/:id/activate — puts it back to work.
 *
 * An active terminal is billable, so this goes through the same licence gate as
 * creating one.
 */
export const activateTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  const terminal = await resolveTerminal(req, terminalId);
  if (!terminal) return notFound(res, 'Terminal not found or access denied');
  if (terminal.status === 'active') return badRequest(res, 'Terminal is already active');

  await assertLicenseCapacity(terminal.company_id, 'terminal', 1);

  await query(
    `UPDATE users SET status = 'active', updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [terminalId, req.user!.userId],
  );

  await recordTerminalAudit({
    companyId: terminal.company_id,
    actorId: req.user!.userId,
    action: 'TERMINAL_ACTIVATE',
    terminalId,
    details: { email: terminal.email },
  });

  void recordHeadcountEvent({
    companyId: terminal.company_id,
    resourceType: 'terminal',
    changeType: 'added',
    userId: terminalId,
    userLabel: terminal.name ?? terminal.email,
  });

  ok(res, { id: terminalId, status: 'active' }, 'Terminal activated');
});
