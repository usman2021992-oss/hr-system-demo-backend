-- =============================================================================
-- Migration 059: Seed default notification settings with roles
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- Creates default notification settings for all companies with proper roles.
-- =============================================================================

-- Insert default notification settings for each company and event type
-- Only insert if the setting doesn't already exist

-- Employee notifications (admin, hr)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'employee.created', true, ARRAY['admin', 'hr']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'employee.created'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'employee.updated', true, ARRAY['admin', 'hr']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'employee.updated'
);

-- Shift notifications (employee)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'shift.assigned', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'shift.assigned'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'shift.changed', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'shift.changed'
);

-- Attendance notifications (employee, store_manager, hr)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'attendance.anomaly', true, ARRAY['employee', 'store_manager', 'hr']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'attendance.anomaly'
);

-- Leave notifications
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'leave.submitted', true, ARRAY['store_manager', 'area_manager', 'hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'leave.submitted'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'leave.approved', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'leave.approved'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'leave.rejected', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'leave.rejected'
);

-- Document notifications
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'document.uploaded', true, ARRAY['employee', 'hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'document.uploaded'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'document.signature_required', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'document.signature_required'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'document.signed', true, ARRAY['hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'document.signed'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'document.expiring', true, ARRAY['employee', 'hr', 'admin']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'document.expiring'
);

-- ATS notifications (hr, admin)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'ats.candidate_received', true, ARRAY['hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'ats.candidate_received'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'ats.interview_invite', true, ARRAY['hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'ats.interview_invite'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'ats.outcome', true, ARRAY['hr', 'admin']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'ats.outcome'
);

-- Onboarding notifications (employee)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'onboarding.welcome', true, ARRAY['employee']::text[], 'high'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'onboarding.welcome'
);

INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'onboarding.task_reminder', true, ARRAY['employee']::text[], 'medium'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'onboarding.task_reminder'
);

-- Manager alerts (store_manager, area_manager, hr, admin)
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority)
SELECT c.id, 'manager.alert', true, ARRAY['store_manager', 'area_manager', 'hr', 'admin']::text[], 'urgent'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'manager.alert'
);
