import { query, queryOne } from '../../config/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationSetting {
  id: number;
  companyId: number;
  eventKey: string;
  enabled: boolean;
  roles: string[];
  priority?: string;
  locale?: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// Internal DB row shape
// ---------------------------------------------------------------------------

interface NotificationSettingRow {
  id: number;
  company_id: number;
  event_key: string;
  enabled: boolean;
  roles: string[];
  priority?: string | null;
  locale?: string | null;
  category?: string | null;
}

function toNotificationSetting(row: NotificationSettingRow): NotificationSetting {
  return {
    id: row.id,
    companyId: row.company_id,
    eventKey: row.event_key,
    enabled: row.enabled,
    roles: row.roles,
    priority: row.priority ?? undefined,
    locale: row.locale ?? undefined,
    category: row.category ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all notification settings rows configured for a given company.
 * Only returns rows that have been explicitly created (upserted). Events
 * without a row default to enabled=true for roles ['admin','hr'].
 */
export async function getNotificationSettings(
  companyId: number,
): Promise<NotificationSetting[]> {
  const rows = await query<NotificationSettingRow>(
    `SELECT id, company_id, event_key, enabled, roles, priority, locale, category
     FROM notification_settings
     WHERE company_id = $1
     ORDER BY event_key`,
    [companyId],
  );
  return rows.map(toNotificationSetting);
}

/**
 * Insert or update a notification setting for (companyId, eventKey).
 * If the row does not exist it is created; if it exists the enabled flag,
 * roles array, priority, and locale are updated atomically.
 */
export async function upsertNotificationSetting(
  companyId: number,
  eventKey: string,
  enabled: boolean,
  roles: string[] = ['admin', 'hr'],
  priority?: string,
  locale?: string,
): Promise<NotificationSetting> {
  const row = await queryOne<NotificationSettingRow>(
    `INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority, locale)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, event_key)
     DO UPDATE SET
       enabled    = EXCLUDED.enabled,
       roles      = EXCLUDED.roles,
       priority   = EXCLUDED.priority,
       locale     = EXCLUDED.locale
     RETURNING id, company_id, event_key, enabled, roles, priority, locale`,
    [companyId, eventKey, enabled, roles, priority ?? null, locale ?? null],
  );

  if (!row) {
    throw new Error(
      `Impossibile salvare le impostazioni per l'evento "${eventKey}"`,
    );
  }

  return toNotificationSetting(row);
}
