import { query, queryOne } from '../../config/database';
import { emailService } from '../../services/email.service';
import { AutomationRecipientRole } from './automationDefaults';
import { getAutomationSettings } from './automationSettings';

interface RoleRecipientRow {
  personal_email: string | null;
  role: AutomationRecipientRole;
}

function uniqueEmails(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value && value.includes('@'))),
    ),
  );
}

async function listManagementRecipients(
  companyId: number,
  roles: AutomationRecipientRole[],
): Promise<string[]> {
  const managementRoles = roles.filter((role) => role !== 'employee');
  if (managementRoles.length === 0) {
    return [];
  }

  const recipients = await query<RoleRecipientRow>(
    `SELECT DISTINCT personal_email, role
     FROM users
     WHERE company_id = $1
       AND status = 'active'
       AND personal_email IS NOT NULL
       AND role = ANY($2)`,
    [companyId, managementRoles],
  );

  return uniqueEmails(recipients.map((recipient) => recipient.personal_email));
}

/**
 * Welcome automation:
 * - employee role receives the welcome email with credentials
 * - admin/hr/area/store roles receive a "new employee created" notification
 */
export async function sendWelcomeEmailAutomation(
  companyId: number,
  employeeId: number,
  personalEmail: string,
  employee: { name: string; surname: string; email: string },
  tempPassword: string,
) {
  const automation = await getAutomationSettings(companyId, 'benvenuto_email', true);
  if (!automation.isEnabled) {
    console.log(`[AUTOMATION] Welcome email is disabled for company ${companyId}. Skipping email.`);
    return;
  }

  const companyInfo = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId],
  );
  const companyName = companyInfo?.name || 'Azienda';

  const employeeRow = await queryOne<{ personal_email: string | null; store_id: number | null }>(
    `SELECT personal_email, store_id
     FROM users
     WHERE id = $1 AND company_id = $2`,
    [employeeId, companyId],
  );
  const store = employeeRow?.store_id
    ? await queryOne<{ name: string }>(
        `SELECT name
         FROM stores
         WHERE id = $1 AND company_id = $2`,
        [employeeRow.store_id, companyId],
      )
    : null;

  const employeeRecipientEmails = automation.recipientRoles.includes('employee')
    ? uniqueEmails([personalEmail, employeeRow?.personal_email ?? null])
    : [];

  const managementRecipientEmails = await listManagementRecipients(companyId, automation.recipientRoles);

  const employeeFullName = `${employee.name} ${employee.surname}`.trim();
  const employeeStoreLabel = store?.name || 'Not assigned';

  const employeeHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Benvenuto in ${companyName}!</h1>
      </div>
      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #333333; margin-top: 0;">Ciao <strong>${employeeFullName}</strong>,</p>
        <p style="font-size: 16px; color: #333333;">Siamo felici di darti il benvenuto nel nostro team. Il tuo account aziendale e stato creato con successo.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; margin-bottom: 15px;">Le tue credenziali di accesso:</h3>
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #333;"><strong>Email aziendale:</strong> ${employee.email}</p>
          <p style="margin: 0; font-size: 15px; color: #333;"><strong>Password temporanea:</strong> <span style="font-family: monospace; background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</span></p>
        </div>
        <p style="font-size: 14px; color: #64748b; margin-top: 25px;">Ti consigliamo di accedere al portale e modificare la tua password il prima possibile.</p>
      </div>
      <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa e un'email generata automaticamente. Si prega di non rispondere.</p>
      </div>
    </div>
  `;

  const managementHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Nuovo dipendente creato</h1>
      </div>
      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #333333; margin-top: 0;">E stato creato un nuovo account dipendente in <strong>${companyName}</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; margin-bottom: 15px;">Dettagli dipendente</h3>
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #333;"><strong>Nome:</strong> ${employeeFullName}</p>
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #333;"><strong>Email aziendale:</strong> ${employee.email}</p>
          <p style="margin: 0; font-size: 15px; color: #333;"><strong>Negozio:</strong> ${employeeStoreLabel}</p>
        </div>
        <p style="font-size: 14px; color: #64748b; margin-top: 25px;">Questo messaggio e solo per notifica interna.</p>
      </div>
      <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa e un'email generata automaticamente. Si prega di non rispondere.</p>
      </div>
    </div>
  `;

  for (const recipientEmail of employeeRecipientEmails) {
    try {
      await emailService.send({
        companyId,
        to: recipientEmail,
        subject: `Benvenuto in ${companyName} - Credenziali di accesso`,
        html: employeeHtml,
        text: `Benvenuto in ${companyName}! Ciao ${employeeFullName}, il tuo account aziendale e stato creato. Email: ${employee.email} | Password: ${tempPassword}`,
      });
      console.log(`[AUTOMATION] Welcome email sent successfully to employee recipient ${recipientEmail}`);
    } catch (err) {
      console.error('[AUTOMATION] Failed to send employee welcome email:', err);
    }
  }

  for (const recipientEmail of managementRecipientEmails) {
    try {
      await emailService.send({
        companyId,
        to: recipientEmail,
        subject: `Nuovo dipendente creato - ${employeeFullName}`,
        html: managementHtml,
        text: `E stato creato un nuovo account dipendente in ${companyName}. Nome: ${employeeFullName}. Email aziendale: ${employee.email}. Negozio: ${employeeStoreLabel}.`,
      });
      console.log(`[AUTOMATION] Welcome automation notification sent successfully to management recipient ${recipientEmail}`);
    } catch (err) {
      console.error('[AUTOMATION] Failed to send management welcome notification:', err);
    }
  }
}
