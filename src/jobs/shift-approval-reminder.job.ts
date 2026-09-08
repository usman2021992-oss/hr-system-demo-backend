import { query, queryOne } from '../config/database';
import { sendEmailForCompany } from '../services/email.service';
import { resolveAutomationRecipientEmails } from '../modules/automations/automationRecipients';
import { getAutomationSettings } from '../modules/automations/automationSettings';

interface ShiftApprovalReminderRow {
  shift_date: string;
  start_time: string;
  end_time: string;
  employee_name: string;
  employee_surname: string;
  store_name: string | null;
}

export async function runShiftApprovalReminderJob(companyId: number): Promise<void> {
  const automation = await getAutomationSettings(companyId, 'approvazione_turni', false);
  if (!automation.isEnabled) {
    return;
  }

  const company = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId],
  );

  const scheduledShifts = await query<ShiftApprovalReminderRow>(
    `SELECT
       TO_CHAR(s.date, 'YYYY-MM-DD') AS shift_date,
       s.start_time,
       s.end_time,
       u.name AS employee_name,
       u.surname AS employee_surname,
       st.name AS store_name
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1
       AND s.status = 'scheduled'
       AND s.date > CURRENT_DATE
       AND s.date <= CURRENT_DATE + INTERVAL '7 days'
     ORDER BY s.date, st.name NULLS LAST, u.surname, u.name, s.start_time`,
    [companyId],
  );

  if (scheduledShifts.length === 0) {
    return;
  }

  const recipientEmails = await resolveAutomationRecipientEmails({
    companyId,
    roles: automation.recipientRoles,
  });
  if (recipientEmails.length === 0) {
    return;
  }

  const companyLabel = company?.name || 'Azienda';
  const subject = `Promemoria approvazione turni - ${companyLabel}`;
  const rowsHtml = scheduledShifts.map((shift) => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px;">${shift.shift_date}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px;">${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px;">${shift.employee_name} ${shift.employee_surname}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px;">${shift.store_name || 'Negozio non assegnato'}</td>
    </tr>
  `).join('');

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
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 760px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="background-color: #b45309; padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Promemoria approvazione turni</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">Turni programmati da confermare</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">
                    Sono presenti <strong>${scheduledShifts.length}</strong> turni con stato <strong>Scheduled</strong> nei prossimi 7 giorni per <strong>${companyLabel}</strong>. Verifica e conferma i turni elencati qui sotto.
                  </p>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                    <thead>
                      <tr style="background-color: #f8fafc;">
                        <th align="left" style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Data</th>
                        <th align="left" style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Orario</th>
                        <th align="left" style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Dipendente</th>
                        <th align="left" style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Negozio</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsHtml}
                    </tbody>
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

  const textLines = scheduledShifts.map((shift) =>
    `- ${shift.shift_date} | ${shift.start_time.slice(0, 5)}-${shift.end_time.slice(0, 5)} | ${shift.employee_name} ${shift.employee_surname} | ${shift.store_name || 'Negozio non assegnato'}`,
  );

  for (const recipientEmail of recipientEmails) {
    await sendEmailForCompany(companyId, {
      to: recipientEmail,
      subject,
      html,
      text: `Promemoria approvazione turni per ${companyLabel}. Sono presenti ${scheduledShifts.length} turni con stato Scheduled nei prossimi 7 giorni:\n${textLines.join('\n')}`,
    });
  }
}
