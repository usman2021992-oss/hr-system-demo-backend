import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Sends a welcome notification to employees created in the last hour.
 * Runs every hour via the scheduler.
 */
export async function runWelcomeEmailJob(companyId: number): Promise<void> {
  const newEmployees = await query<{ id: number; name: string; surname: string; locale?: string }>(
    `SELECT id, name, surname, locale FROM users
     WHERE company_id = $1
       AND role = 'employee'
       AND status = 'active'
       AND created_at >= NOW() - INTERVAL '1 hour'
       AND created_at < NOW()`,
    [companyId],
  );

  for (const emp of newEmployees) {
    const locale = emp.locale ?? 'it';
    await sendNotification({
      companyId,
      userId: emp.id,
      type: 'onboarding.welcome',
      title:   t(locale, 'notifications.onboarding_welcome.title'),
      message: t(locale, 'notifications.onboarding_welcome.message', { name: emp.name }),
      priority: 'high',
      channels: ['in_app', 'email'],
      locale,
    });
  }
}
