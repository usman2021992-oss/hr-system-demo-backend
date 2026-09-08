-- Migration 022: Enable presenze, turni, and permessi for employee role by default
-- Employees need attendance check-in (presenze), shift viewing (turni),
-- and leave requests (permessi) enabled out-of-the-box.
-- Uses ON CONFLICT DO UPDATE so it is safe to re-run.

INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
SELECT c.id, 'employee', m.module_name, true
FROM companies c
CROSS JOIN (
  VALUES ('presenze'), ('turni'), ('permessi')
) AS m(module_name)
ON CONFLICT (company_id, role, module_name)
DO UPDATE SET is_enabled = true;
