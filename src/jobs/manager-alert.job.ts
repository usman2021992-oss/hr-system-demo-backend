import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Sends daily manager summaries for actionable HR events (e.g. pending leave requests).
 * Runs daily at 07:00 UTC.
 */
export async function runManagerAlertJob(companyId: number): Promise<void> {
  // Leave requests pending for more than 2 days, grouped by the employee's supervisor
  const pendingLeaves = await query<{ count: string; manager_id: number; locale?: string }>(
    `SELECT COUNT(*) AS count, u.supervisor_id AS manager_id, mgr.locale
       FROM leave_requests lr
       JOIN users u   ON u.id  = lr.user_id
       JOIN users mgr ON mgr.id = u.supervisor_id
      WHERE lr.company_id = $1
        AND lr.status = 'pending'
        AND lr.created_at < NOW() - INTERVAL '2 days'
        AND u.supervisor_id IS NOT NULL
      GROUP BY u.supervisor_id, mgr.locale`,
    [companyId],
  );

  for (const row of pendingLeaves) {
    if (!row.manager_id) continue;
    const count  = parseInt(row.count, 10);
    const locale = row.locale ?? 'it';

    await sendNotification({
      companyId,
      userId: row.manager_id,
      type: 'manager.alert',
      title:   t(locale, 'notifications.manager_alert_leave.title'),
      message: t(locale, 'notifications.manager_alert_leave.message', { count }),
      priority: 'high',
      channels: ['in_app'],
      locale,
    });
  }
}
