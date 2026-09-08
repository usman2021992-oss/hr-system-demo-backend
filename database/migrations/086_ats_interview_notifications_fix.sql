-- =============================================================================
-- Migration 086: Fix ATS Interview Notifications and Email Templates
-- =============================================================================
-- IDEMPOTENT: safe to run multiple times.
-- =============================================================================

-- 1. Ensure ats.interview_invite notification setting includes all relevant roles
UPDATE notification_settings
SET roles = ARRAY['admin', 'hr', 'area_manager', 'store_manager', 'employee']::text[]
WHERE event_key = 'ats.interview_invite'
  AND NOT (roles @> ARRAY['admin', 'hr', 'area_manager', 'store_manager', 'employee']::text[]);

-- 2. Create notification template for interview scheduled email (for candidates)
INSERT INTO notification_templates (event_key, channel, body_it, subject_it)
VALUES (
  'ats.interview_scheduled',
  'email',
  '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #0d2137; margin-bottom: 20px;">Colloquio di lavoro programmato</h2>
    <p style="color: #374151; font-size: 14px; line-height: 1.6;">Gentile {{candidateName}},</p>
    <p style="color: #374151; font-size: 14px; line-height: 1.6;">
      È stato programmato un colloquio {{interviewType}} per il giorno <strong>{{interviewDate}}</strong> alle ore <strong>{{interviewTime}}</strong>.
    </p>
    <div style="background: #f3f4f6; border-left: 4px solid #0d2137; padding: 15px; margin: 20px 0;">
      <p style="margin: 0 0 10px 0; color: #374151; font-size: 14px;"><strong>Tipo:</strong> {{interviewType}}</p>
      <p style="margin: 0 0 10px 0; color: #374151; font-size: 14px;"><strong>Data:</strong> {{interviewDate}}</p>
      <p style="margin: 0 0 10px 0; color: #374151; font-size: 14px;"><strong>Ora:</strong> {{interviewTime}}</p>
      <p style="margin: 0 0 10px 0; color: #374151; font-size: 14px;"><strong>Luogo:</strong> {{location}}</p>
      <p style="margin: 0; color: #374151; font-size: 14px;"><strong>Dettagli:</strong> {{description}}</p>
    </div>
    <p style="color: #374151; font-size: 14px; line-height: 1.6;">
      Ti preghiamo di confermare la tua presenza e di presentarti puntuale.
    </p>
    <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-top: 30px;">
      Cordiali saluti,<br>
      <strong>Il team HR</strong>
    </p>
  </div>',
  'Colloquio di lavoro programmato - {{interviewDate}}'
)
ON CONFLICT (event_key) DO UPDATE SET
  channel = EXCLUDED.channel,
  body_it = EXCLUDED.body_it,
  subject_it = EXCLUDED.subject_it;

-- 3. Ensure all companies have the ats.interview_invite setting with all roles
INSERT INTO notification_settings (company_id, event_key, enabled, roles, priority, category)
SELECT 
  c.id, 
  'ats.interview_invite', 
  true, 
  ARRAY['admin', 'hr', 'area_manager', 'store_manager', 'employee']::text[], 
  'high',
  'ats'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM notification_settings 
  WHERE company_id = c.id AND event_key = 'ats.interview_invite'
);

-- 4. Create index for faster notification log queries
CREATE INDEX IF NOT EXISTS idx_interview_notification_logs_interview_id
  ON interview_notification_logs (interview_id);

CREATE INDEX IF NOT EXISTS idx_interview_notification_logs_status
  ON interview_notification_logs (status);

-- 5. Add comment for documentation
COMMENT ON TABLE interview_notification_logs IS 'Tracks email and in-app notification delivery for interview invitations';
COMMENT ON COLUMN interview_notification_logs.channel IS 'Delivery channel: email, in_app, or push';
COMMENT ON COLUMN interview_notification_logs.recipient_type IS 'Who receives the notification: candidate or interviewer';
COMMENT ON COLUMN interview_notification_logs.status IS 'Delivery status: pending, sending, done, or error';
