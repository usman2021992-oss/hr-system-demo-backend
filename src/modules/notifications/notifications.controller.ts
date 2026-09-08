import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, badRequest, forbidden, notFound } from '../../utils/response';
import { query, queryOne } from '../../config/database';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount as getUnreadCountService,
  getRecentNotificationRecipients,
} from './notifications.service';
import {
  getNotificationSettings,
  upsertNotificationSetting,
} from './notifications.settings.service';

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of notifications for the authenticated user.
 *
 * Query params:
 *   - unread_only  boolean  (default: false)
 *   - limit        number   (default: 50, max: 100)
 *   - offset       number   (default: 0)
 */
export const listNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, companyId, role, is_super_admin } = req.user!;

    if (!companyId && is_super_admin !== true) {
      forbidden(res, 'Nessuna azienda associata a questo account');
      return;
    }

    const unreadOnly =
      req.query.unread_only === 'true' || req.query.unread_only === '1';

    const rawLimit  = parseInt(String(req.query.limit  ?? '50'), 10);
    const rawOffset = parseInt(String(req.query.offset ?? '0'),  10);
    const scopeParam = String(req.query.scope ?? 'mine').toLowerCase();

    if (scopeParam !== 'mine' && scopeParam !== 'company') {
      badRequest(res, 'Invalid scope (allowed: mine, company)', 'VALIDATION_ERROR');
      return;
    }

    if (scopeParam === 'company') {
      const canViewCompanyFeed = role === 'admin' || role === 'hr' || role === 'area_manager' || role === 'store_manager' || is_super_admin === true;
      if (!canViewCompanyFeed) {
        forbidden(res, 'You are not authorised to view company notifications', 'FORBIDDEN');
        return;
      }
    }

    const limit  = Number.isNaN(rawLimit)  ? 50 : Math.min(Math.max(rawLimit,  1), 100);
    const offset = Number.isNaN(rawOffset) ? 0  : Math.max(rawOffset, 0);

    const result = await getNotifications({
      userId,
      companyId: companyId ?? 0,
      unreadOnly,
      limit,
      offset,
      scope: scopeParam === 'company' ? 'company' : 'mine',
      isSuperAdmin: is_super_admin === true,
      recipientRole: role,
    });

    ok(res, {
      notifications: result.notifications,
      total:         result.total,
      unreadCount:   result.unreadCount,
      limit,
      offset,
      scope: scopeParam,
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/notifications/:id/read
// ---------------------------------------------------------------------------

/**
 * Marks a single notification as read.
 * Security: the notification must belong to the authenticated user.
 */
export const markNotificationRead = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, companyId } = req.user!;

    if (!companyId) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      badRequest(res, 'Invalid notification ID', 'INVALID_NOTIFICATION_ID');
      return;
    }

    // Verify the notification belongs to this user (ownership check)
    const existing = await queryOne<{ user_id: number }>(
      `SELECT user_id FROM notifications WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [id, companyId],
    );

    if (!existing) {
      notFound(res, 'Notification not found');
      return;
    }

    if (existing.user_id !== userId) {
      forbidden(res, 'You are not authorised to modify this notification', 'FORBIDDEN');
      return;
    }

    const updated = await markAsRead(id, userId);

    if (!updated) {
      // Notification exists but was already read — return it as-is (idempotent)
      ok(res, { id, alreadyRead: true }, 'Notification already marked as read');
      return;
    }

    ok(res, { id, isRead: true }, 'Notification marked as read');
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/notifications/read-all
// ---------------------------------------------------------------------------

/**
 * Marks all unread notifications as read for the authenticated user.
 * Returns the count of notifications that were updated.
 */
export const markAllNotificationsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, companyId } = req.user!;

    if (!companyId) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    const count = await markAllAsRead(userId, companyId);

    ok(res, { count }, `${count} notifications marked as read`);
  },
);

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------

/**
 * Returns the count of unread notifications for the authenticated user.
 * Used by the frontend bell-badge polling mechanism.
 */
export const getUnreadCount = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, companyId, role, is_super_admin } = req.user!;
    const count = await getUnreadCountService(
      userId,
      is_super_admin === true ? undefined : companyId ?? undefined,
      is_super_admin === true ? undefined : role,
    );
    ok(res, { count });
  },
);

// ---------------------------------------------------------------------------
// GET /api/notifications/settings (Admin/HR only)
// ---------------------------------------------------------------------------

/**
 * Returns all notification settings configured for the user's company.
 * Only admin and hr roles can access this endpoint.
 */
export const listSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId, is_super_admin, role } = req.user!;

    if (!companyId && is_super_admin !== true) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    // Check permissions for notifications module - only admin, hr, and store_manager can access
    if (is_super_admin !== true) {
      const hasPermission = role === 'admin' || role === 'hr' || role === 'store_manager';
      if (!hasPermission) {
        forbidden(res, 'You do not have permission to access notification settings', 'FORBIDDEN');
        return;
      }
    }

    // Allow super admin to specify target company via query parameter
    let effectiveCompanyId = companyId ?? 0;
    
    if (is_super_admin === true && req.query.company_id) {
      const targetCompanyId = parseInt(String(req.query.company_id), 10);
      if (!Number.isNaN(targetCompanyId) && targetCompanyId > 0) {
        effectiveCompanyId = targetCompanyId;
      }
    }
    
    if (effectiveCompanyId === 0) {
      ok(res, { settings: [] });
      return;
    }

    const settings = await getNotificationSettings(effectiveCompanyId);
    ok(res, { settings });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/notifications/settings/:eventKey (Admin only)
// ---------------------------------------------------------------------------

/**
 * Creates or updates a notification setting for an event key.
 * Only admin role (or super admin) is permitted to call this endpoint.
 *
 * Body: { enabled?: boolean, roles?: string[] }
 */
export const updateSetting = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId, role, is_super_admin } = req.user!;

    // Check permissions for notifications module - only admin can modify settings
    if (is_super_admin !== true) {
      const hasPermission = role === 'admin';
      if (!hasPermission) {
        forbidden(res, 'Only administrators can change notification settings', 'FORBIDDEN');
        return;
      }
    }

    if (!companyId && is_super_admin !== true) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    const { eventKey } = req.params;
    if (!eventKey || typeof eventKey !== 'string' || eventKey.trim() === '') {
      badRequest(res, 'Invalid event key', 'INVALID_EVENT_KEY');
      return;
    }

    const { enabled, roles, priority, locale } = req.body as {
      enabled?: unknown;
      roles?: unknown;
      priority?: unknown;
      locale?: unknown;
    };

    // At least one field must be provided
    if (enabled === undefined && roles === undefined && priority === undefined && locale === undefined) {
      badRequest(
        res,
        'At least one of "enabled", "roles", "priority", or "locale" must be provided',
        'VALIDATION_ERROR',
      );
      return;
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      badRequest(
        res,
        'The "enabled" field must be a boolean',
        'VALIDATION_ERROR',
      );
      return;
    }

    if (roles !== undefined) {
      if (
        !Array.isArray(roles) ||
        !roles.every((r) => typeof r === 'string')
      ) {
        badRequest(
          res,
          'The "roles" field must be an array of strings',
          'VALIDATION_ERROR',
        );
      return;
      }
    }

    if (priority !== undefined && typeof priority !== 'string') {
      badRequest(
        res,
        'The "priority" field must be a string',
        'VALIDATION_ERROR',
      );
      return;
    }

    if (locale !== undefined && typeof locale !== 'string') {
      badRequest(
        res,
        'The "locale" field must be a string',
        'VALIDATION_ERROR',
      );
      return;
    }

    // Allow super admin to specify target company via query parameter
    let effectiveCompanyId = companyId ?? 0;
    
    if (is_super_admin === true && req.query.company_id) {
      const targetCompanyId = parseInt(String(req.query.company_id), 10);
      if (!Number.isNaN(targetCompanyId) && targetCompanyId > 0) {
        effectiveCompanyId = targetCompanyId;
      }
    }

    // Get current setting or use defaults
    const current = await queryOne<{ enabled: boolean; roles: string[]; priority?: string; locale?: string }>(
      `SELECT enabled, roles, priority, locale FROM notification_settings 
       WHERE company_id = $1 AND event_key = $2 LIMIT 1`,
      [effectiveCompanyId, eventKey.trim()],
    );

    const finalEnabled = enabled !== undefined ? enabled : (current?.enabled ?? true);
    const finalRoles = roles !== undefined ? (roles as string[]) : (current?.roles ?? ['admin', 'hr']);
    const finalPriority = priority !== undefined ? (priority as string) : current?.priority;
    const finalLocale = locale !== undefined ? (locale as string) : current?.locale;

    const setting = await upsertNotificationSetting(
      effectiveCompanyId,
      eventKey.trim(),
      finalEnabled,
      finalRoles,
      finalPriority,
      finalLocale,
    );

    ok(res, { setting }, 'Notification setting updated');
  },
);

// ---------------------------------------------------------------------------
// GET /api/notifications/settings/:eventKey/recipients (Admin/HR only)
// ---------------------------------------------------------------------------

/**
 * Returns recent users (last 24 hours) who received notifications for a specific event type.
 * Used to display avatars in the settings modal.
 */
export const getRecentRecipients = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId, is_super_admin, role } = req.user!;

    if (!companyId && is_super_admin !== true) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    // Check permissions for notifications module - only admin, hr, and store_manager can access
    if (is_super_admin !== true) {
      const hasPermission = role === 'admin' || role === 'hr' || role === 'store_manager';
      if (!hasPermission) {
        forbidden(res, 'You do not have permission to access notification recipients', 'FORBIDDEN');
        return;
      }
    }

    const { eventKey } = req.params;
    if (!eventKey || typeof eventKey !== 'string' || eventKey.trim() === '') {
      badRequest(res, 'Invalid event key', 'INVALID_EVENT_KEY');
      return;
    }

    // Allow super admin to specify target company via query parameter
    let effectiveCompanyId = companyId ?? 0;
    
    if (is_super_admin === true && req.query.company_id) {
      const targetCompanyId = parseInt(String(req.query.company_id), 10);
      if (!Number.isNaN(targetCompanyId) && targetCompanyId > 0) {
        effectiveCompanyId = targetCompanyId;
      }
    }

    const recipients = await getRecentNotificationRecipients(
      effectiveCompanyId, 
      eventKey.trim(),
      is_super_admin === true
    );

    ok(res, { recipients });
  },
);

// ---------------------------------------------------------------------------
// GET /api/notifications/automation-settings (Admin only)
// ---------------------------------------------------------------------------

const JOB_KEYS = [
  'welcome_email',
  'onboarding_reminder',
  'document_expiry',
  'signature_reminder',
  'ats_bottleneck',
  'manager_alert',
] as const;

export const listAutomationSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId } = req.user!;
    if (!companyId) { forbidden(res, 'No company'); return; }

    const rows = await query<{ job_key: string; enabled: boolean }>(
      `SELECT job_key, enabled FROM automation_settings WHERE company_id = $1`,
      [companyId],
    );

    const settingsMap = new Map(rows.map((r) => [r.job_key, r.enabled]));
    const settings = JOB_KEYS.map((key) => ({
      jobKey: key,
      enabled: settingsMap.has(key) ? settingsMap.get(key)! : true,
    }));

    ok(res, { settings });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/notifications/automation-settings/:jobKey (Admin only)
// ---------------------------------------------------------------------------

export const updateAutomationSetting = asyncHandler(
  async (req: Request, res: Response) => {
    const { companyId } = req.user!;
    if (!companyId) { forbidden(res, 'No company'); return; }

    const { jobKey } = req.params;
    if (!JOB_KEYS.includes(jobKey as typeof JOB_KEYS[number])) {
      badRequest(res, 'Invalid job key', 'INVALID_JOB_KEY');
      return;
    }

    const { enabled } = req.body as { enabled: unknown };
    if (typeof enabled !== 'boolean') {
      badRequest(res, 'The "enabled" field is required and must be a boolean', 'VALIDATION_ERROR');
      return;
    }

    await queryOne(
      `INSERT INTO automation_settings (company_id, job_key, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, job_key)
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [companyId, jobKey, enabled],
    );

    ok(res, { jobKey, enabled }, 'Automation setting updated');
  },
);


// ---------------------------------------------------------------------------
// DELETE /api/notifications/bulk-delete
// ---------------------------------------------------------------------------

/**
 * Deletes multiple notifications by IDs.
 * Security: only deletes notifications that belong to the authenticated user.
 */
export const bulkDeleteNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, companyId } = req.user!;

    if (!companyId) {
      forbidden(res, 'No company associated with this account');
      return;
    }

    const { ids } = req.body as { ids?: number[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      badRequest(res, 'No notification IDs provided', 'VALIDATION_ERROR');
      return;
    }

    // Validate all IDs are numbers
    const validIds = ids.filter((id) => typeof id === 'number' && id > 0);
    if (validIds.length === 0) {
      badRequest(res, 'No valid notification IDs provided', 'VALIDATION_ERROR');
      return;
    }

    // Delete only notifications that belong to this user
    const result = await query(
      `DELETE FROM notifications
       WHERE id = ANY($1::int[])
         AND user_id = $2
         AND company_id = $3
       RETURNING id`,
      [validIds, userId, companyId],
    );

    const deletedCount = result.length;

    ok(res, { deletedCount }, `${deletedCount} notification(s) deleted`);
  },
);
