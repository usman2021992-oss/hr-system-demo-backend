import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Reminds employees about documents awaiting their signature for more than 1 day.
 * Runs daily at 09:30 UTC.
 */
export async function runSignatureReminderJob(companyId: number): Promise<void> {
  const pendingDocs = await query<{
    id: number;
    employee_id: number;
    file_name: string;
    locale?: string;
  }>(
    `SELECT id, employee_id, file_name, locale
       FROM (
         -- Direct employee documents
         SELECT d.id, d.employee_id, d.file_name, u.locale
           FROM employee_documents d
           JOIN users u ON u.id = d.employee_id
          WHERE d.company_id = $1
            AND d.deleted_at IS NULL
            AND d.requires_signature = TRUE
            AND d.signed_at IS NULL
            AND d.uploaded_at <= NOW() - INTERVAL '1 day'
            
         UNION ALL
         
         -- Generic assigned documents (excluding those already synced to employee_documents)
         SELECT d.id, d.employee_id, d.title AS file_name, u.locale
           FROM documents d
           JOIN users u ON u.id = d.employee_id
          WHERE u.company_id = $1
            AND d.requires_signature = TRUE
            AND d.signed_at IS NULL
            AND d.created_at <= NOW() - INTERVAL '1 day'
            AND NOT EXISTS (
              SELECT 1 FROM employee_documents ed 
               WHERE ed.storage_path = d.file_url 
                 AND ed.employee_id = d.employee_id
                 AND ed.deleted_at IS NULL
            )
       ) combined`,
    [companyId],
  );

  for (const doc of pendingDocs) {
    const locale = doc.locale ?? 'it';
    await sendNotification({
      companyId,
      userId: doc.employee_id,
      type: 'document.signature_required',
      title:   t(locale, 'notifications.document_signature_required.title'),
      message: t(locale, 'notifications.document_signature_required.message', {
        fileName: doc.file_name,
      }),
      priority: 'high',
      channels: ['in_app'],
      locale,
    });
  }
}
