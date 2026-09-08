import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Sends a reminder to employees with onboarding tasks pending for more than 3 days.
 * Runs daily at 09:00 UTC.
 */
export async function runOnboardingReminderJob(companyId: number): Promise<void> {
  // Fetch pending employees along with their locale
  const rows = await query<{ employee_id: number; pending_count: number; locale?: string }>(
    `SELECT eot.employee_id,
            COUNT(*)::int AS pending_count,
            u.locale
       FROM employee_onboarding_tasks eot
       JOIN users u ON u.id = eot.employee_id
       JOIN onboarding_templates otpl ON otpl.id = eot.template_id
      WHERE otpl.company_id = $1
        AND eot.completed = FALSE
        AND eot.created_at < NOW() - INTERVAL '3 days'
      GROUP BY eot.employee_id, u.locale
      HAVING COUNT(*) > 0`,
    [companyId],
  );

  for (const row of rows) {
    const locale = row.locale ?? 'it';
    await sendNotification({
      companyId,
      userId: row.employee_id,
      type: 'onboarding.task_reminder',
      title:   t(locale, 'notifications.onboarding_task_reminder.title'),
      message: t(locale, 'notifications.onboarding_task_reminder.message', { count: row.pending_count }),
      priority: 'medium',
      channels: ['in_app'],
      locale,
    });
  }
}
