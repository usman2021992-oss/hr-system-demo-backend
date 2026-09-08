-- =============================================================================
-- Migration 023: Composite indexes for leave management performance
--
-- Problems addressed:
--
-- 1. Overlap check in submitLeave / createLeaveAdmin:
--      WHERE user_id = $x
--        AND status IN ('pending','supervisor_approved','area_manager_approved','hr_approved')
--        AND start_date <= $y AND end_date >= $z
--    Only idx_leave_requests_user(user_id) existed.  For users with many
--    historical leave rows the status + date filter had to be applied as a
--    heap scan after the index lookup.  The new partial index covers the four
--    active statuses so rejected rows are excluded from the index entirely,
--    keeping it small and fast.
--
-- 2. List query (listLeaveRequests) ORDER BY created_at DESC + pagination:
--    Added a covering index on (company_id, created_at DESC) so the ORDER BY
--    can be satisfied without a sort step when filtering by company.
--
-- 3. Pending approvals queue (getPendingApprovals) filters by
--    current_approver_role; added to the existing company+status index.
-- =============================================================================

BEGIN;

-- ① Partial index for the overlap-check query.
--   Covers: user_id lookup → status filter → date range filter.
--   Partial (WHERE status IN …) keeps the index small: rejected rows (~50% of
--   all rows in a mature system) are never included.
CREATE INDEX IF NOT EXISTS idx_leave_requests_overlap
  ON leave_requests (user_id, start_date, end_date)
  WHERE status IN ('pending','supervisor_approved','area_manager_approved','hr_approved');

-- ② Composite index for the approval-queue query.
--   Covers: company_id + current_approver_role + status (for the pending filter).
CREATE INDEX IF NOT EXISTS idx_leave_requests_approver
  ON leave_requests (company_id, current_approver_role, status);

-- ③ Composite index to speed up the paginated list query sorted by created_at.
--   company_id = ANY($1) still uses this via index scan on individual IDs.
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_created
  ON leave_requests (company_id, created_at DESC);

COMMIT;
