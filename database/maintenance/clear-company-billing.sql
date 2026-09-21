-- ---------------------------------------------------------------------------
-- Clear one or more companies' billing history.
--
-- NOT a migration. This folder is never run automatically - `migrate()` only
-- reads database/migrations - so this file does nothing until somebody
-- deliberately runs it.
--
-- WHY THIS EXISTS
--
--   A Stripe or PayPal subscription id means nothing outside the account that
--   created it. Swap the API keys and every subscription and payment recorded
--   under the old account becomes a row pointing at something the provider no
--   longer admits exists. It cannot be repaired, only removed.
--
-- WHAT IT DOES NOT DO
--
--   It cannot cancel anything at the provider. If a subscription is still live
--   in the PayPal or Stripe account that created it, deleting the row here
--   stops us tracking it - it does NOT stop it charging. Cancel it in that
--   provider's own dashboard FIRST, logging in with the credentials that
--   created it, which may not be the ones the server is using now.
--
-- WHAT IT KEEPS
--
--   The company, its users, and its billing *settings* - price per licence,
--   discount, grace period, whether billing is enforced. Those are
--   configuration somebody typed, not history. Only records go.
--
-- HOW TO RUN
--
--   1. Edit the company ids on the line marked TARGETS below.
--   2. Run the preview block and read it.
--   3. If it looks right, run the delete block.
--
--   psql "$DATABASE_URL" -f database/maintenance/clear-company-billing.sql
--
--   Take a database backup first. This is irreversible.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- TARGETS: the companies to clear. Edit this line and nothing else.
\set target_companies '4,5,6'

-- ---------------------------------------------------------------------------
-- 1. PREVIEW - reads only. Check these numbers before going further.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== Companies about to be cleared ==='
SELECT c.id,
       c.name,
       (SELECT COUNT(*) FROM subscriptions s         WHERE s.company_id = c.id) AS subscriptions,
       (SELECT COUNT(*) FROM billing_transactions t  WHERE t.company_id = c.id) AS transactions,
       (SELECT COUNT(*) FROM billing_headcount_events h WHERE h.company_id = c.id) AS headcount_events
  FROM companies c
 WHERE c.id IN (:target_companies)
 ORDER BY c.id;

\echo ''
\echo '=== Subscriptions still ACTIVE - cancel these at the provider first ==='
\echo '    (provider_account_id tells you WHICH account created them)'
SELECT s.id,
       s.company_id,
       s.provider,
       s.status,
       s.provider_subscription_id,
       COALESCE(s.provider_account_id, '(unknown - created before this was recorded)') AS created_under
  FROM subscriptions s
 WHERE s.company_id IN (:target_companies)
   AND s.status IN ('active', 'past_due', 'pending')
 ORDER BY s.company_id, s.id;

-- ---------------------------------------------------------------------------
-- 2. DELETE - everything in one transaction, so a half-cleared history that
--    has payments without the subscription that produced them cannot happen.
--
--    Comment out the ROLLBACK and uncomment the COMMIT when you are ready.
--    It is left on ROLLBACK on purpose: running this file by accident should
--    change nothing.
-- ---------------------------------------------------------------------------

BEGIN;

DELETE FROM billing_transactions     WHERE company_id IN (:target_companies);
DELETE FROM billing_headcount_events WHERE company_id IN (:target_companies);
DELETE FROM subscriptions            WHERE company_id IN (:target_companies);

\echo ''
\echo '=== After deletion (inside the transaction) ==='
SELECT c.id,
       c.name,
       (SELECT COUNT(*) FROM subscriptions s        WHERE s.company_id = c.id) AS subscriptions,
       (SELECT COUNT(*) FROM billing_transactions t WHERE t.company_id = c.id) AS transactions
  FROM companies c
 WHERE c.id IN (:target_companies)
 ORDER BY c.id;

-- Safe by default. Swap these two lines to actually apply the change.
ROLLBACK;
-- COMMIT;

\echo ''
\echo 'Finished. If the numbers above read 0 and you meant it, swap ROLLBACK for'
\echo 'COMMIT at the bottom of this file and run it again.'
