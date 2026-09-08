import { queryOne } from '../../config/database';
import { sendEmailForCompany } from '../../services/email.service';
import { resolveAutomationRecipientEmails } from './automationRecipients';
import { getAutomationSettings } from './automationSettings';

function formatLeaveTypeLabel(leaveType: string): string {
  return leaveType === 'vacation' ? 'Ferie' : 'Malattia';
}

function formatLeaveDurationLabel(options: {
  leaveDurationType: string | null;
  shortStartTime: string | null;
  shortEndTime: string | null;
  startDate: string;
  endDate: string;
}): string {
  const { leaveDurationType, shortStartTime, shortEndTime, startDate, endDate } = options;

  if (leaveDurationType === 'short_leave' && shortStartTime && shortEndTime) {
    return `Permesso breve: ${startDate} ${shortStartTime.slice(0, 5)} - ${shortEndTime.slice(0, 5)}`;
  }

  return `${startDate} - ${endDate}`;
}

export async function sendLeaveSubmittedAutomation(options: {
  companyId: number;
  employeeId: number;
  employeeName: string;
  employeeSurname: string;
  employeeEmail: string | null;
  storeId: number | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  leaveDurationType: string | null;
  shortStartTime: string | null;
  shortEndTime: string | null;
  requestedDays: number;
}): Promise<void> {
  const {
    companyId,
    employeeId,
    employeeName,
    employeeSurname,
    employeeEmail,
    storeId,
    leaveType,
    startDate,
    endDate,
    leaveDurationType,
    shortStartTime,
    shortEndTime,
    requestedDays,
  } = options;

  const automation = await getAutomationSettings(companyId, 'ferie_approvazione', true);
  if (!automation.isEnabled) {
    return;
  }

  const employee = await queryOne<{ store_id: number | null }>(
    `SELECT store_id FROM users WHERE id = $1 AND company_id = $2`,
    [employeeId, companyId],
  );
  const effectiveStoreId = storeId ?? employee?.store_id ?? null;

  const company = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId],
  );
  const store = effectiveStoreId
    ? await queryOne<{ name: string }>(
        `SELECT name FROM stores WHERE id = $1 AND company_id = $2`,
        [effectiveStoreId, companyId],
      )
    : null;

  const recipientEmails = await resolveAutomationRecipientEmails({
    companyId,
    roles: automation.recipientRoles,
    targetEmployeeId: employeeId,
    storeId: effectiveStoreId,
  });
  if (recipientEmails.length === 0) {
    return;
  }

  const employeeFullName = `${employeeName} ${employeeSurname}`.trim();
  const companyLabel = company?.name || 'Azienda';
  const storeLabel = store?.name || 'Negozio non assegnato';
  const leaveTypeLabel = formatLeaveTypeLabel(leaveType);
  const durationLabel = formatLeaveDurationLabel({
    leaveDurationType,
    shortStartTime,
    shortEndTime,
    startDate,
    endDate,
  });
  const subject = `Nuova richiesta di ${leaveTypeLabel.toLowerCase()} - ${employeeFullName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="background-color: #5b21b6; padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Nuova richiesta di permesso</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">Richiesta inviata da un dipendente</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">
                    Il dipendente <strong>${employeeFullName}</strong> ha inviato una nuova richiesta di <strong>${leaveTypeLabel.toLowerCase()}</strong> per <strong>${companyLabel}</strong>.
                  </p>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
                    <tr>
                      <td align="center">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Dettagli richiesta</span>
                        <span style="display: block; font-size: 24px; font-weight: 800; color: #5b21b6;">${leaveTypeLabel}</span>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px; width: 170px;">Dipendente:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${employeeFullName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Azienda:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${companyLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Negozio:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${storeLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Tipo richiesta:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${leaveTypeLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Periodo:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${durationLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Giorni richiesti:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${requestedDays}</td>
                    </tr>
                    ${employeeEmail ? `
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Email dipendente:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${employeeEmail}</td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa e una notifica automatica di ${companyLabel}.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  for (const recipientEmail of recipientEmails) {
    await sendEmailForCompany(companyId, {
      to: recipientEmail,
      subject,
      html,
      text: `Nuova richiesta di permesso. Dipendente: ${employeeFullName}. Azienda: ${companyLabel}. Negozio: ${storeLabel}. Tipo richiesta: ${leaveTypeLabel}. Periodo: ${durationLabel}. Giorni richiesti: ${requestedDays}.`,
    });
  }
}
