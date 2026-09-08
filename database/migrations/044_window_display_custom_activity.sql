-- 044_window_display_custom_activity.sql
ALTER TABLE window_display_activities
  ADD COLUMN IF NOT EXISTS custom_activity_name VARCHAR(120);

ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS chk_wda_activity_type;

ALTER TABLE window_display_activities
  ADD CONSTRAINT chk_wda_activity_type
    CHECK (activity_type IN (
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
      'custom_activity'
    ));

ALTER TABLE window_display_activities
  DROP CONSTRAINT IF EXISTS chk_wda_custom_activity_name;

ALTER TABLE window_display_activities
  ADD CONSTRAINT chk_wda_custom_activity_name
    CHECK (
      (activity_type = 'custom_activity' AND custom_activity_name IS NOT NULL AND BTRIM(custom_activity_name) <> '')
      OR (activity_type <> 'custom_activity' AND custom_activity_name IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_wda_activity_type ON window_display_activities(activity_type);
