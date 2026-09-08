import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Notifies employees and HR about documents expiring within the next 30 days.
 * Runs daily at 08:00 UTC.
 */
export async function runDocumentExpiryJob(companyId: number): Promise<void> {
  const expiringDocs = await query<{
    id: number;
    employee_id: number;
    file_name: string;
    expires_at: string;
    employee_locale?: string;
  }>(
    `SELECT id, employee_id, file_name, expires_at, employee_locale
       FROM (
         SELECT d.id, d.employee_id, d.file_name, d.expires_at, u.locale AS employee_locale
           FROM employee_documents d
           JOIN users u ON u.id = d.employee_id
          WHERE d.company_id = $1
            AND d.deleted_at IS NULL
            AND d.expires_at IS NOT NULL
            AND d.expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'
            
         UNION ALL
         
         SELECT d.id, d.employee_id, d.title AS file_name, d.expires_at, u.locale AS employee_locale
           FROM documents d
           JOIN users u ON u.id = d.employee_id
          WHERE u.company_id = $1
            AND d.expires_at IS NOT NULL
            AND d.expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'
       ) combined
      ORDER BY expires_at ASC`,
    [companyId],
  );

  // Find all active HR/Admin users for this specific company
  const hrUsers = await query<{ id: number; locale?: string }>(
    `SELECT id, locale FROM users
     WHERE company_id = $1 AND role IN ('admin', 'hr') AND status = 'active'`,
    [companyId],
  );

  for (const doc of expiringDocs) {
    const expiryDate  = new Date(doc.expires_at);
    const empLocale   = doc.employee_locale ?? 'it';
    const empDateFmt  = expiryDate.toLocaleDateString(empLocale === 'it' ? 'it-IT' : 'en-GB');

    // Notify the assigned employee
    await sendNotification({
      companyId,
      userId: doc.employee_id,
      type: 'document.expiring',
      title:   t(empLocale, 'notifications.document_expiring_employee.title'),
      message: t(empLocale, 'notifications.document_expiring_employee.message', {
        fileName: doc.file_name,
        date:     empDateFmt,
      }),
      priority: 'high',
      channels: ['in_app'],
      locale: empLocale,
    });

    // Notify ALL HR/Admin users of the company
    for (const hr of hrUsers) {
      if (hr.id === doc.employee_id) continue; // Don't notify twice if HR is also the employee

      const hrLocale  = hr.locale ?? 'it';
      const hrDateFmt = expiryDate.toLocaleDateString(hrLocale === 'it' ? 'it-IT' : 'en-GB');

      await sendNotification({
        companyId,
        userId: hr.id,
        type: 'document.expiring',
        title:   t(hrLocale, 'notifications.document_expiring_hr.title'),
        message: t(hrLocale, 'notifications.document_expiring_hr.message', {
          fileName: doc.file_name,
          date:     hrDateFmt,
        }),
        priority: 'medium',
        channels: ['in_app'],
        locale: hrLocale,
      });
    }
  }
}
