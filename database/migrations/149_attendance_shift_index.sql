-- ---------------------------------------------------------------------------
-- 149. Find a shift's clock-ins quickly.
--
--      The shift calendar now shows, per shift, whether the employee clocked in
--      and out. That asks attendance_events "which events belong to this
--      shift?" once per shift on screen — a week view is a few hundred of them.
--
--      attendance_events had indexes on (company_id, event_time) and
--      (company_id, user_id, event_time), but none on shift_id, so each lookup
--      fell back to scanning. This index is partial: events that carry no
--      shift_id (manual entries) are matched by user and time window instead,
--      which the existing user/time index already serves.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_attendance_events_shift
  ON attendance_events (shift_id)
  WHERE shift_id IS NOT NULL;
