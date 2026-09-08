import { UserRole } from '../../config/jwt';

export const ALL_MODULES = [
  'dipendenti',
  'turni',
  'trasferimenti',
  'presenze',
  'anomalie',
  'permessi',
  'saldi',
  'negozi',
  'messaggi',
  'documenti',
  'ats',
  'onboarding',
  'notifiche',
  'report',
  'impostazioni',
  'gestione_accessi',
  'terminali',
  'automazioni',
  'team_documents',
] as const;

export type ModuleName = typeof ALL_MODULES[number];

export const ACTIVE_MODULES = [
  'dipendenti',
  'turni',
  'trasferimenti',
  'presenze',
  'anomalie',
  'permessi',
  'saldi',
  'negozi',
  'messaggi',
  'documenti',
  'ats',
  'onboarding',
  'notifiche',
  'impostazioni',
  'gestione_accessi',
  'terminali',
  'automazioni',
  'report',
  'team_documents',
] as const;

export const ACTIVE_MODULE_SET: ReadonlySet<ModuleName> = new Set(ACTIVE_MODULES);

export const SYSTEM_MODULES = [
  'turni',
  'trasferimenti',
  'permessi',
  'saldi',
  'presenze',
  'anomalie',
  'negozi',
  'dipendenti',
  'messaggi',
  'documenti',
  'team_documents',
  'impostazioni',
  'gestione_accessi',
  'terminali',
  'ats',
  'onboarding',
  'notifiche',
  'automazioni',
  'report',
 ] as const;

export type SystemModuleName = typeof SYSTEM_MODULES[number];

export const MANAGED_ROLES = [
  'admin',
  'hr',
  'area_manager',
  'store_manager',
  'employee',
  'store_terminal',
] as const;

export type ManagedRole = typeof MANAGED_ROLES[number];

export const ROLE_HIERARCHY: Record<ManagedRole, number> = {
  admin: 50,
  hr: 40,
  area_manager: 30,
  store_manager: 20,
  employee: 10,
  store_terminal: 0,
};

export function canManageRole(currentUserRole: string, isSuperAdmin: boolean, targetRole: ManagedRole): boolean {
  if (isSuperAdmin) return true;

  const currentLevel = ROLE_HIERARCHY[currentUserRole as ManagedRole] ?? -1;
  const targetLevel = ROLE_HIERARCHY[targetRole] ?? -1;

  // Lower roles can ONLY manage roles STRICTLY below them
  return currentLevel > targetLevel;
}

export const VALID_ROLES: UserRole[] = [...MANAGED_ROLES];

export const MODULE_ROLE_ELIGIBILITY: Record<ModuleName, readonly ManagedRole[]> = {
  dipendenti: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  turni: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  trasferimenti: ['admin', 'hr', 'area_manager', 'store_manager'],
  presenze: ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'],
  anomalie: ['admin', 'hr', 'area_manager', 'store_manager'],
  permessi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  saldi: ['admin', 'hr'],
  negozi: ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'],
  messaggi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  impostazioni: ['admin', 'hr', 'area_manager'],
  documenti: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  ats: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  onboarding: ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'],
  notifiche: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  report: ['admin', 'hr'],
  gestione_accessi: ['admin', 'hr', 'area_manager'],
  terminali: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  automazioni: ['admin', 'hr'],
  team_documents: ['admin', 'hr', 'area_manager', 'store_manager'],
};

export function isRoleEligibleForModule(role: UserRole, moduleName: ModuleName): boolean {
  return (MODULE_ROLE_ELIGIBILITY[moduleName] as readonly string[]).includes(role);
}

export function isDefaultEnabledForModule(role: UserRole, moduleName: ModuleName): boolean {
  if (!isRoleEligibleForModule(role, moduleName)) return false;
  // Admin should always default to enabled for every eligible module.
  // Only an explicit super-admin toggle should disable a module for the admin role.
  if (role === 'admin') return true;
  if (moduleName === 'messaggi') return true;
  if (moduleName === 'presenze' && role === 'store_terminal') return true;
  if (moduleName === 'trasferimenti' && (role === 'hr' || role === 'area_manager' || role === 'store_manager')) return true;
  if (moduleName === 'negozi' && (role === 'hr' || role === 'area_manager' || role === 'store_terminal')) return true;
  if (moduleName === 'terminali' && (role === 'hr' || role === 'area_manager')) return true;
  if (moduleName === 'dipendenti' && role === 'employee') return true;
  if (moduleName === 'documenti' && (role === 'employee' || role === 'store_manager' || role === 'area_manager' || role === 'hr')) return true;
  if (moduleName === 'ats' && role === 'hr') return true;
  if (moduleName === 'onboarding') return true;
  if (moduleName === 'notifiche') return true;
  if (moduleName === 'automazioni' && role === 'hr') return true;
  if (moduleName === 'report' && role === 'hr') return true;
  if (moduleName === 'team_documents' && (role === 'hr' || role === 'area_manager' || role === 'store_manager')) return true;
  return false;
}
