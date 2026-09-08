import { query } from '../config/database';
import { evaluateAllJobRisks } from '../modules/ats/ats.risk.service';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Evaluates job risk for all published positions and notifies HR about at-risk jobs.
 * Runs every 6 hours.
 */
export async function runAtsBottleneckJob(companyId: number): Promise<void> {
  const risks = await evaluateAllJobRisks(companyId);
  const atRisk = risks.filter((r) => r.riskLevel !== 'ok');

  if (atRisk.length === 0) return;

  const hrUsers = await query<{ id: number; locale?: string }>(
    `SELECT id, locale FROM users
     WHERE company_id = $1 AND role IN ('admin', 'hr') AND status = 'active'
     ORDER BY role ASC LIMIT 1`,
    [companyId],
  );
  const hrUser = hrUsers[0];
  if (!hrUser) return;

  const locale = hrUser.locale ?? 'it';

  for (const risk of atRisk) {
    const flagParts: string[] = [];
    if (risk.flags.lowCandidates) flagParts.push(t(locale, 'notifications.ats_flag_lowCandidates'));
    if (risk.flags.noInterviews)  flagParts.push(t(locale, 'notifications.ats_flag_noInterviews'));
    if (risk.flags.noHires)       flagParts.push(t(locale, 'notifications.ats_flag_noHires'));

    const levelKey = risk.riskLevel === 'high'
      ? 'notifications.ats_risk_high'
      : 'notifications.ats_risk_medium';

    await sendNotification({
      companyId,
      userId: hrUser.id,
      type: 'manager.alert',
      title:   t(locale, 'notifications.ats_bottleneck.title', { jobTitle: risk.jobTitle }),
      message: t(locale, 'notifications.ats_bottleneck.message', {
        jobTitle: risk.jobTitle,
        flags:    flagParts.join(', '),
        level:    t(locale, levelKey),
      }),
      priority: risk.riskLevel === 'high' ? 'urgent' : 'high',
      channels: ['in_app'],
      locale,
    });
  }
}
