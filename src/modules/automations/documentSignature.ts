import path from 'path';
import fs from 'fs';
import { queryOne } from '../../config/database';
import { emailService } from '../../services/email.service';
import { resolveAutomationRecipientEmails } from './automationRecipients';
import { getAutomationSettings } from './automationSettings';

function findEmailLogoPath(): string | null {
  const candidates = [
    process.env.EMAIL_LOGO_PATH,
    path.resolve(process.cwd(), '../hr-system-demo-frontend/public/IMG_5144.png'),
    path.resolve(process.cwd(), 'public/IMG_5144.png'),
    path.resolve(process.cwd(), '../frontend/public/IMG_5144.png'),
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function capitalizeWords(text: string): string {
  return text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Checks if the document signature email automation is enabled for the company.
 * If ON, verifies company SMTP settings and sends an email notification to the
 * selected automation recipient roles.
 */
export async function sendDocumentSignatureEmailAutomation(
  companyId: number,
  userId: number,
  documentTitle: string,
  callerCompanyId?: number | null,
) {
  let effectiveCompanyId = companyId;

  let automation = await getAutomationSettings(effectiveCompanyId, 'document_signature', true);
  let smtpCfg = await queryOne<{ smtp_host: string; smtp_user: string; smtp_pass: string }>(
    `SELECT smtp_host, smtp_user, smtp_pass FROM company_smtp_configs WHERE company_id = $1 LIMIT 1`,
    [effectiveCompanyId],
  );

  const hasValidSmtp = (cfg: any) => Boolean(cfg && cfg.smtp_host && cfg.smtp_user && cfg.smtp_pass);

  if ((!automation.isEnabled || !hasValidSmtp(smtpCfg)) && callerCompanyId && callerCompanyId !== companyId) {
    const callerAutomation = await getAutomationSettings(callerCompanyId, 'document_signature', true);
    const callerSmtpCfg = await queryOne<{ smtp_host: string; smtp_user: string; smtp_pass: string }>(
      `SELECT smtp_host, smtp_user, smtp_pass FROM company_smtp_configs WHERE company_id = $1 LIMIT 1`,
      [callerCompanyId],
    );
    if (callerAutomation.isEnabled && hasValidSmtp(callerSmtpCfg)) {
      effectiveCompanyId = callerCompanyId;
      automation = callerAutomation;
      smtpCfg = callerSmtpCfg;
    }
  }

  if (!automation.isEnabled) {
    console.log(`[AUTOMATION] Document signature email is OFF for effective company ${effectiveCompanyId}. Skipping email.`);
    return;
  }

  if (!hasValidSmtp(smtpCfg)) {
    console.log(`[AUTOMATION] SMTP settings not configured for effective company ${effectiveCompanyId}. Skipping document signature email.`);
    return;
  }

  const user = await queryOne<{ name: string; surname: string }>(
    `SELECT name, surname FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) {
    return;
  }

  const recipientEmails = await resolveAutomationRecipientEmails({
    companyId,
    roles: automation.recipientRoles,
    targetEmployeeId: userId,
  });
  if (recipientEmails.length === 0) {
    return;
  }

  const companyInfo = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [effectiveCompanyId],
  );
  const companyName = companyInfo?.name || 'Azienda';
  const userName = capitalizeWords(user.name);
  const userSurname = capitalizeWords(user.surname);
  const formattedCompanyName = capitalizeWords(companyName);
  const logoPath = findEmailLogoPath();
  const logoCid = logoPath ? 'veylo-hr-logo' : null;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 30px; text-align: center;">
        ${logoCid ? `<img src="cid:${logoCid}" alt="Veylo HR" style="max-height: 60px; margin-bottom: 15px;" />` : ''}
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Richiesta firma documento</h1>
      </div>
      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #333333; margin-top: 0;">Gentile <strong>${userName} ${userSurname}</strong>,</p>
        <p style="font-size: 16px; color: #333333;">E stato caricato un nuovo documento che richiede la tua firma nel portale dipendenti di <strong>${formattedCompanyName}</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; margin-bottom: 15px;">Dettagli documento:</h3>
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #333;"><strong>Nome file:</strong> ${documentTitle}</p>
          <p style="margin: 0; font-size: 15px; color: #333;"><strong>Azione richiesta:</strong> Firma digitale</p>
        </div>
        <p style="font-size: 14px; color: #64748b; margin-top: 25px;">Ti invitiamo ad accedere al portale dipendenti per visualizzare e firmare il documento.</p>
      </div>
      <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa e un'email generata automaticamente. Si prega di non rispondere.</p>
      </div>
    </div>
  `;

  for (const recipientEmail of recipientEmails) {
    try {
      await emailService.send({
        companyId: effectiveCompanyId,
        to: recipientEmail,
        subject: `Richiesta firma - ${documentTitle}`,
        html: emailHtml,
        text: `Gentile ${userName} ${userSurname}, e stato caricato un nuovo documento (${documentTitle}) che richiede la tua firma digitale nel portale dipendenti di ${formattedCompanyName}.`,
        attachments: logoPath && logoCid ? [{
          filename: 'IMG_5144.png',
          content: fs.readFileSync(logoPath),
          contentType: 'image/png',
          cid: logoCid,
        }] : [],
      });
      console.log(`[AUTOMATION] Document signature email sent successfully to ${recipientEmail}`);
    } catch (err) {
      console.error('[AUTOMATION] Failed to send document signature email:', err);
    }
  }
}
