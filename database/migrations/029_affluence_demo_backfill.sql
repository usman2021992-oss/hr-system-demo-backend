-- Migration 029: Backfill demo affluence data without full reseed

-- Ensure baseline weekly affluence exists for all active stores (iso_week IS NULL)
WITH days(dow) AS (
  VALUES (1), (2), (3), (4), (5), (6), (7)
),
slots(slot) AS (
  VALUES ('09:00-12:00'), ('12:00-15:00'), ('15:00-18:00'), ('18:00-21:00')
)
INSERT INTO store_affluence (company_id, store_id, iso_week, day_of_week, time_slot, level, required_staff)
SELECT
  s.company_id,
  s.id,
  NULL,
  d.dow,
  sl.slot,
  CASE
    WHEN d.dow IN (6, 7) THEN 'high'
    WHEN sl.slot IN ('12:00-15:00', '15:00-18:00') THEN 'medium'
    ELSE 'low'
  END,
  CASE
    WHEN d.dow IN (6, 7) THEN 3
    WHEN sl.slot IN ('12:00-15:00', '15:00-18:00') THEN 2
    ELSE 1
  END
FROM stores s
CROSS JOIN days d
CROSS JOIN slots sl
WHERE s.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM store_affluence sa
    WHERE sa.store_id = s.id
      AND sa.iso_week IS NULL
      AND sa.day_of_week = d.dow
      AND sa.time_slot = sl.slot
  );

-- Refresh week 14 overrides for Paradise Limited flagship stores
WITH target_stores AS (
  SELECT s.id, s.company_id, s.name
  FROM stores s
  JOIN companies c ON c.id = s.company_id
  WHERE c.slug = 'paradise-limited'
    AND s.name IN ('Downtown London Store', 'Manchester Central Store')
)
DELETE FROM store_affluence sa
USING target_stores ts
WHERE sa.store_id = ts.id
  AND sa.iso_week = 14;

WITH target_stores AS (
  SELECT s.id, s.company_id, s.name
  FROM stores s
  JOIN companies c ON c.id = s.company_id
  WHERE c.slug = 'paradise-limited'
    AND s.name IN ('Downtown London Store', 'Manchester Central Store')
),
week14(day_of_week, time_slot, level, london_staff, manchester_staff) AS (
  VALUES
    (1, '09:00-12:00', 'medium', 4, 3),
    (1, '12:00-15:00', 'high', 6, 5),
    (1, '15:00-18:00', 'high', 7, 6),
    (1, '18:00-21:00', 'medium', 5, 4),
    (5, '09:00-12:00', 'medium', 5, 4),
    (5, '12:00-15:00', 'high', 8, 7),
    (5, '15:00-18:00', 'high', 9, 8),
    (5, '18:00-21:00', 'high', 7, 6),
    (6, '09:00-12:00', 'high', 8, 7),
    (6, '12:00-15:00', 'high', 10, 9),
    (6, '15:00-18:00', 'high', 11, 10),
    (6, '18:00-21:00', 'high', 9, 8),
    (7, '09:00-12:00', 'medium', 6, 5),
    (7, '12:00-15:00', 'high', 8, 7),
    (7, '15:00-18:00', 'high', 9, 8),
    (7, '18:00-21:00', 'medium', 6, 5)
)
INSERT INTO store_affluence (company_id, store_id, iso_week, day_of_week, time_slot, level, required_staff)
SELECT
  ts.company_id,
  ts.id,
  14,
  w.day_of_week,
  w.time_slot,
  w.level,
  CASE
    WHEN ts.name = 'Downtown London Store' THEN w.london_staff
    ELSE w.manchester_staff
  END
FROM target_stores ts
CROSS JOIN week14 w;
