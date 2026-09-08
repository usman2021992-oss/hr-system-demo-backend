import nodemailer from 'nodemailer';
import { queryOne } from '../config/database';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: {
    filename: string;
    content: Buffer | string;
    contentType?: string;
    cid?: string;
  }[];
}

export interface EmailSendResult {
  ok: boolean;
  status: 'sent' | 'skipped' | 'failed';
  portTried?: number;
  message?: string;
}

interface CompanySmtpConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}

interface NotificationTemplate {
  id: number;
  event_key: string;
  channel: string;
  subject_it: string | null;
  body_it: string;
}

function buildCandidatePorts(configuredPort: number): number[] {
  const ports = [configuredPort];
  if (configuredPort === 587) {
    ports.push(465);
  } else if (configuredPort === 465) {
    ports.push(587);
  }
  return Array.from(new Set(ports));
}

function isRetryableSmtpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'EHOSTUNREACH';
}

function createSmtpTransport(config: {
  host: string;
  port: number;
  user: string;
  pass: string;
}): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    debug: true,
    logger: true,
    family: 4,
  } as any);
}

export async function sendEmailForCompany(
  companyId: number,
  options: EmailOptions,
): Promise<EmailSendResult> {
  try {
    const cfg = await queryOne<CompanySmtpConfig>(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
       FROM company_smtp_configs
       WHERE company_id = $1
       LIMIT 1`,
      [companyId],
    );

    const smtpHost = cfg?.smtp_host;
    const smtpPort = cfg?.smtp_port || 587;
    const smtpUser = cfg?.smtp_user;
    const smtpPass = cfg?.smtp_pass;
    const smtpFrom = cfg?.smtp_from;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[EMAIL] No DB SMTP config for company ${companyId} - email to ${options.to} skipped.`);
      return {
        ok: false,
        status: 'skipped',
        message: 'SMTP configuration missing or incomplete',
      };
    }

    const candidatePorts = buildCandidatePorts(smtpPort);
    let lastError: unknown = null;

    for (let index = 0; index < candidatePorts.length; index += 1) {
      const port = candidatePorts[index];
      const transporter = createSmtpTransport({
        host: smtpHost,
        port,
        user: smtpUser,
        pass: smtpPass,
      });

      try {
        console.log(`[EMAIL] Attempting to send email to ${options.to} via ${smtpHost}:${port}...`);

        await transporter.sendMail({
          from: smtpFrom || smtpUser,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
          attachments: options.attachments,
        });

        console.log(`[EMAIL] Email sent successfully for company ${companyId} to ${options.to} via port ${port}.`);
        return {
          ok: true,
          status: 'sent',
          portTried: port,
        };
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EMAIL] Failed to send email for company ${companyId} to ${options.to} via ${smtpHost}:${port}: ${msg}`);

        const shouldRetry = index < candidatePorts.length - 1 && isRetryableSmtpError(err);
        if (!shouldRetry) {
          break;
        }

        console.log(`[EMAIL] Retrying email delivery for company ${companyId} to ${options.to} using fallback SMTP port.`);
      }
    }

    const finalMessage = lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown SMTP failure');
    return {
      ok: false,
      status: 'failed',
      portTried: candidatePorts[candidatePorts.length - 1],
      message: finalMessage,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EMAIL] Failed to send email for company ${companyId} to ${options.to}: ${msg}`);
    return {
      ok: false,
      status: 'failed',
      message: msg,
    };
  }
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (process.env.SMTP_HOST) {
      this.transporter = createSmtpTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      });
    }
  }

  async send(options: EmailOptions & { companyId?: number }): Promise<void> {
    if (options.companyId) {
      await sendEmailForCompany(options.companyId, options);
      return;
    }

    if (!this.transporter) {
      console.log('[EMAIL - dev mode (no companyId)]', {
        to: options.to,
        subject: options.subject,
        text: options.text || options.html.replace(/<[^>]+>/g, ''),
      });
      return;
    }

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@hr-system.it',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}

export const emailService = new EmailService();

export async function sendNotificationEmail(options: {
  companyId: number;
  toEmail: string;
  eventKey: string;
  variables: Record<string, string>;
  fallbackSubject: string;
  fallbackBody: string;
  attachments?: EmailOptions['attachments'];
}): Promise<void> {
  const { companyId, toEmail, eventKey, variables, fallbackSubject, fallbackBody, attachments } = options;

  const template = await queryOne<NotificationTemplate>(
    `SELECT id, event_key, channel, subject_it, body_it
     FROM notification_templates
     WHERE event_key = $1
     LIMIT 1`,
    [eventKey],
  );

  let subject = fallbackSubject;
  let htmlBody = fallbackBody;

  if (template) {
    subject = template.subject_it ?? fallbackSubject;
    htmlBody = template.body_it;
  }

  const interpolate = (tpl: string): string =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_match, key) => variables[key] ?? '');

  subject = interpolate(subject);
  htmlBody = interpolate(htmlBody);

  const plainText = htmlBody.replace(/<[^>]+>/g, '');

  await sendEmailForCompany(companyId, {
    to: toEmail,
    subject,
    html: htmlBody,
    text: plainText,
    attachments,
  });
}

export async function verifySmtpConfig(config: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}): Promise<boolean> {
  try {
    const candidatePorts = buildCandidatePorts(config.smtpPort);

    for (let index = 0; index < candidatePorts.length; index += 1) {
      const port = candidatePorts[index];
      const transporter = createSmtpTransport({
        host: config.smtpHost,
        port,
        user: config.smtpUser,
        pass: config.smtpPass,
      });

      try {
        await transporter.verify();
        return true;
      } catch (err: unknown) {
        const shouldRetry = index < candidatePorts.length - 1 && isRetryableSmtpError(err);
        if (!shouldRetry) {
          throw err;
        }

        console.log(`[EMAIL_VERIFY] SMTP verify failed on port ${port}, retrying with fallback port.`);
      }
    }

    return false;
  } catch (err: unknown) {
    console.error('[EMAIL_VERIFY] SMTP verification failed:', err);
    return false;
  }
}
