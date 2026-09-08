import { queryOne } from '../../config/database';
import { AutomationRecipientRole, getDefaultAutomationRoles, sanitizeAutomationRoles } from './automationDefaults';

interface AutomationSettingsRow {
  is_enabled: boolean;
  recipient_roles: string[] | null;
}

export interface AutomationSettings {
  isEnabled: boolean;
  recipientRoles: AutomationRecipientRole[];
}

export async function getAutomationSettings(
  companyId: number,
  automationId: string,
  fallbackEnabled: boolean,
): Promise<AutomationSettings> {
  const row = await queryOne<AutomationSettingsRow>(
    `SELECT is_enabled, recipient_roles
     FROM company_automations
     WHERE company_id = $1 AND automation_id = $2`,
    [companyId, automationId],
  );

  return {
    isEnabled: row ? row.is_enabled : fallbackEnabled,
    recipientRoles: row ? sanitizeAutomationRoles(row.recipient_roles, automationId) : getDefaultAutomationRoles(automationId),
  };
}
