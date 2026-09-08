import { queryOne } from '../../config/database';
import { sendEmailForCompany } from '../../services/email.service';
import { resolveAutomationRecipientEmails } from './automationRecipients';
import { getAutomationSettings } from './automationSettings';

export async function sendLateArrivalAlertAutomation(options: {
  companyId: number;
  employeeId: number;
  employeeName: string;
  employeeSurname: string;
  employeeEmail: string | null;
  storeId: number | null;
  storeName: string | null;
  shiftStartTime: string;
  checkinTime: Date;
  lateMinutes: number;
}): Promise<void> {
  const {
    companyId,
    employeeId,
    employeeName,
    employeeSurname,
    employeeEmail,
    storeId,
    storeName,
    shiftStartTime,
    checkinTime,
    lateMinutes,
  } = options;

  const automation = await getAutomationSettings(companyId, 'anomalia_ritardo', true);
  if (!automation.isEnabled) {
    return;
  }

  const company = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId],
  );

  const recipientEmails = await resolveAutomationRecipientEmails({
    companyId,
    roles: automation.recipientRoles,
    targetEmployeeId: employeeId,
    storeId,
  });
  if (recipientEmails.length === 0) {
    return;
  }

  const employeeFullName = `${employeeName} ${employeeSurname}`.trim();
  const checkinTimeLabel = checkinTime.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const storeLabel = storeName || 'Store not assigned';
  const companyLabel = company?.name || 'Azienda';
  const scheduledStartLabel = shiftStartTime.slice(0, 5);
  const subject = `Avviso ritardo - ${employeeFullName}`;
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
                <td style="background-color: #0f172a; padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Avviso di ritardo</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">Ritardo di presenza rilevato</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">
                    Un dipendente di <strong>${companyLabel}</strong> ha effettuato il check-in con oltre 10 minuti di ritardo rispetto all'orario di inizio turno previsto.
                  </p>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
                    <tr>
                      <td align="center">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #9a3412; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Ritardo</span>
                        <span style="display: block; font-size: 28px; font-weight: 800; color: #c2410c;">${lateMinutes} minut${lateMinutes === 1 ? 'o' : 'i'} di ritardo</span>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px; width: 150px;">Dipendente:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${employeeFullName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Negozio:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${storeLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Orario previsto:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${scheduledStartLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Orario check-in:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${checkinTimeLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Minuti di ritardo:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${lateMinutes}</td>
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
      text: `Ritardo di presenza rilevato per ${employeeFullName}. Azienda: ${companyLabel}. Negozio: ${storeLabel}. Orario previsto: ${scheduledStartLabel}. Orario check-in: ${checkinTimeLabel}. Minuti di ritardo: ${lateMinutes}.`,
    });
  }
}
