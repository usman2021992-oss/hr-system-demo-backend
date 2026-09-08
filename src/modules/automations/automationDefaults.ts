export const VALID_AUTOMATION_ROLES = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;

export type AutomationRecipientRole = typeof VALID_AUTOMATION_ROLES[number];

const AUTOMATION_ROLE_DEFAULTS: Record<string, AutomationRecipientRole[]> = {
  benvenuto_email: ['employee'],
  anomalia_ritardo: ['store_manager', 'area_manager'],
  anomalia_noshow: ['store_manager', 'area_manager', 'hr'],
  notifica_turni: ['employee'],
  approvazione_turni: ['hr'],
  ferie_approvazione: ['store_manager', 'area_manager', 'hr'],
  ferie_esito: ['employee'],
  document_signature: ['admin', 'hr', 'employee'],
};

export function getDefaultAutomationRoles(automationId: string): AutomationRecipientRole[] {
  return [...(AUTOMATION_ROLE_DEFAULTS[automationId] ?? ['admin', 'hr'])];
}

export function sanitizeAutomationRoles(input: unknown, automationId: string): AutomationRecipientRole[] {
  if (!Array.isArray(input)) {
    return getDefaultAutomationRoles(automationId);
  }

  const normalized = Array.from(
    new Set(
      input
        .filter((role): role is string => typeof role === 'string')
        .map((role) => role.trim())
        .filter((role): role is AutomationRecipientRole =>
          (VALID_AUTOMATION_ROLES as readonly string[]).includes(role),
        ),
    ),
  );

  return normalized.length > 0 ? normalized : getDefaultAutomationRoles(automationId);
}
