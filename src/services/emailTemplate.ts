/**
 * One template for every email the platform sends its own customers.
 *
 * There were three: a renewal reminder, a failed-payment warning, and the test
 * that rehearses it - each a hand-built block of HTML with the brand spelled
 * inline. Three places to change a logo is three chances for them to disagree,
 * and they did.
 *
 * Everything here is inline-styled and built from tables where it matters,
 * because email clients are not browsers: Outlook ignores most of a stylesheet
 * and flexbox altogether. The layout is deliberately plain for the same
 * reason - a single column, a header, an optional banner, body, one button, a
 * footer. It renders the same in Gmail, Outlook and Apple Mail, which is worth
 * more than anything cleverer.
 *
 * Every caller-supplied string is escaped. These emails carry a company name
 * and a decline reason from the payment provider, and neither is ours to
 * trust as markup.
 */

export type BannerTone = 'danger' | 'warning' | 'info';

export interface BillingEmailBrand {
  brandName: string;
  logoUrl: string;
  supplierName: string;
  supplierDetails: string;
}

export interface BillingEmailContent {
  /** Bold line at the top of the body. */
  title: string;
  /** A coloured strip above the title. Red is reserved for a real failure. */
  banner?: { tone: BannerTone; text: string };
  greeting?: string;
  /** One paragraph each. Plain text; escaped on the way in. */
  paragraphs: string[];
  /** Label / value rows, for amounts and dates. */
  facts?: Array<{ label: string; value: string }>;
  action?: { label: string; url: string };
  /** A quieter closing line, e.g. "ignore this if you have already paid". */
  note?: string;
  signature?: string;
}

const FALLBACK_BRAND: BillingEmailBrand = {
  brandName: 'Veylo HR',
  logoUrl: '',
  supplierName: '',
  supplierDetails: '',
};

/** HTML-escapes a value that came from a person, a company record or Stripe. */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A URL safe to put in an href.
 *
 * Only http(s) survives. An email is the one place a `javascript:` or `data:`
 * link is worth being paranoid about, and the cost of the check is nothing.
 */
function safeUrl(url: string): string | null {
  const trimmed = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

const BANNER_COLOURS: Record<BannerTone, { bg: string; border: string; text: string }> = {
  danger: { bg: '#fee2e2', border: '#dc2626', text: '#991b1b' },
  warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  info: { bg: '#e0f2fe', border: '#0284c7', text: '#075985' },
};

/**
 * Renders one billing email.
 *
 * Returns both parts: the HTML and a plain-text alternative carrying the same
 * information. The text version is not a courtesy - a message with no text
 * part scores worse with spam filters, and this is mail that has to arrive.
 */
export function renderBillingEmail(
  content: BillingEmailContent,
  brand: Partial<BillingEmailBrand> = {}
): { html: string; text: string } {
  const b: BillingEmailBrand = { ...FALLBACK_BRAND, ...brand };
  const brandName = b.brandName?.trim() || FALLBACK_BRAND.brandName;
  const logo = safeUrl(b.logoUrl);

  // The name is always present as text next to the logo. Roughly half of
  // business inboxes block remote images by default, and a header that
  // disappears for those readers is a header that does not work.
  const header =
    `<tr><td style="padding:22px 28px;background:#0d2137;border-radius:8px 8px 0 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    (logo
      ? `<td style="padding-right:10px;vertical-align:middle;">` +
        `<img src="${logo}" alt="${escapeHtml(brandName)}" height="28" ` +
        `style="display:block;height:28px;width:auto;border:0;"></td>`
      : '') +
    `<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:0.2px;">` +
    `${escapeHtml(brandName)}</td>` +
    `</tr></table></td></tr>`;

  const banner = content.banner
    ? (() => {
        const c = BANNER_COLOURS[content.banner!.tone];
        return (
          `<tr><td style="padding:0 28px;"><div style="margin:20px 0 0;padding:12px 14px;` +
          `background:${c.bg};border-left:4px solid ${c.border};color:${c.text};` +
          `font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">` +
          `${escapeHtml(content.banner!.text)}</div></td></tr>`
        );
      })()
    : '';

  const bodyParts: string[] = [];

  if (content.greeting) {
    bodyParts.push(`<p style="margin:0 0 14px;">${escapeHtml(content.greeting)}</p>`);
  }

  bodyParts.push(
    `<p style="margin:0 0 14px;font-size:17px;font-weight:bold;color:#0d2137;">` +
      `${escapeHtml(content.title)}</p>`
  );

  for (const p of content.paragraphs) {
    bodyParts.push(`<p style="margin:0 0 14px;">${escapeHtml(p)}</p>`);
  }

  if (content.facts?.length) {
    const rows = content.facts
      .map(
        (f) =>
          `<tr>` +
          `<td style="padding:6px 0;color:#64748b;font-size:14px;">${escapeHtml(f.label)}</td>` +
          `<td style="padding:6px 0;text-align:right;font-size:14px;font-weight:bold;` +
          `color:#0d2137;">${escapeHtml(f.value)}</td>` +
          `</tr>`
      )
      .join('');
    bodyParts.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="margin:0 0 18px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">` +
        rows +
        `</table>`
    );
  }

  const actionUrl = content.action ? safeUrl(content.action.url) : null;
  if (content.action && actionUrl) {
    bodyParts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">` +
        `<tr><td style="background:#c9973a;border-radius:6px;">` +
        `<a href="${actionUrl}" style="display:inline-block;padding:12px 22px;` +
        `font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;` +
        `color:#ffffff;text-decoration:none;">${escapeHtml(content.action.label)}</a>` +
        `</td></tr></table>` +
        // The bare URL as well: a button is not clickable in every client, and
        // this is the link the whole message exists to deliver.
        `<p style="margin:0 0 14px;font-size:12px;color:#64748b;word-break:break-all;">` +
        `${actionUrl}</p>`
    );
  }

  if (content.note) {
    bodyParts.push(
      `<p style="margin:0 0 14px;font-size:13px;color:#64748b;">${escapeHtml(content.note)}</p>`
    );
  }

  bodyParts.push(
    `<p style="margin:18px 0 0;">${escapeHtml(
      content.signature || `Cordiali saluti,\nTeam ${brandName}`
    ).replace(/\n/g, '<br>')}</p>`
  );

  const body =
    `<tr><td style="padding:22px 28px;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#1e293b;">${bodyParts.join('')}</td></tr>`;

  const footerLines = [b.supplierName, b.supplierDetails]
    .filter((s) => s && s.trim())
    .join('\n')
    .split('\n')
    .map((line) => escapeHtml(line.trim()))
    .filter(Boolean)
    .join('<br>');

  const footer =
    `<tr><td style="padding:18px 28px 24px;background:#f8fafc;border-radius:0 0 8px 8px;` +
    `border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:12px;line-height:1.55;color:#64748b;">` +
    (footerLines ? `<div>${footerLines}</div>` : '') +
    `<div style="margin-top:8px;">Questo messaggio &egrave; stato inviato automaticamente da ` +
    `${escapeHtml(brandName)}.</div>` +
    `</td></tr>`;

  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(content.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#eef2f6;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:#eef2f6;padding:24px 12px;"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;` +
    `box-shadow:0 1px 3px rgba(15,23,42,0.08);">` +
    header +
    banner +
    body +
    footer +
    `</table></td></tr></table></body></html>`;

  // The text alternative carries the same facts in the same order. Built from
  // the same content object, so the two cannot drift apart.
  const textParts: string[] = [`${brandName}`, ''];
  if (content.banner) textParts.push(content.banner.text.toUpperCase(), '');
  if (content.greeting) textParts.push(content.greeting, '');
  textParts.push(content.title, '');
  for (const p of content.paragraphs) textParts.push(p, '');
  if (content.facts?.length) {
    for (const f of content.facts) textParts.push(`${f.label}: ${f.value}`);
    textParts.push('');
  }
  if (content.action && actionUrl) {
    textParts.push(`${content.action.label}: ${content.action.url}`, '');
  }
  if (content.note) textParts.push(content.note, '');
  textParts.push(content.signature || `Cordiali saluti,\nTeam ${brandName}`);
  if (b.supplierName || b.supplierDetails) {
    textParts.push('', '---', [b.supplierName, b.supplierDetails].filter(Boolean).join('\n'));
  }

  return { html, text: textParts.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/**
 * The branding the platform emails with, read from settings.
 *
 * Falls back to the built-in defaults rather than throwing: these are decorative
 * fields on a message whose delivery matters far more than its logo, and a
 * database hiccup must not be the reason a customer is never told their
 * subscription is about to stop.
 */
export async function getEmailBrand(): Promise<BillingEmailBrand> {
  try {
    // Imported here rather than at the top: the platform mailer already
    // imports this module, and a static cycle between the two would leave one
    // of them half-initialised at require time.
    const { getPlatformSmtpConfig } = await import('./platformEmail.service');
    const cfg = await getPlatformSmtpConfig();
    return {
      brandName: cfg.brandName || FALLBACK_BRAND.brandName,
      logoUrl: cfg.logoUrl || '',
      supplierName: cfg.supplierName || '',
      supplierDetails: cfg.supplierDetails || '',
    };
  } catch (err: any) {
    console.warn('[EmailTemplate] Could not read the brand settings:', err?.message || err);
    return { ...FALLBACK_BRAND };
  }
}
