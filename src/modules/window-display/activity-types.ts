export const WINDOW_DISPLAY_ACTIVITY_TYPES = [
  'window_display',
  'campaign_launch',
  'visual_merchandising',
  'promo_setup',
  'event_activation',
  'seasonal_changeover',
  'pop_up_corner',
  'store_cleaning',
  'deep_cleaning',
  'maintenance_repair',
  'decoration_renovation',
  'layout_change',
  'store_reset',
  'product_restock',
  'inventory_count',
  'price_update',
  'audit_inspection',
  'staff_training',
  'custom_activity',
] as const;

export type WindowDisplayActivityType = (typeof WINDOW_DISPLAY_ACTIVITY_TYPES)[number];

export const CUSTOM_ACTIVITY_TYPE: WindowDisplayActivityType = 'custom_activity';
