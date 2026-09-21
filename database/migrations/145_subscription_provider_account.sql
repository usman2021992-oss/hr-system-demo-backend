-- ---------------------------------------------------------------------------
-- 145. Which provider account a subscription belongs to.
--
--      A Stripe subscription id means nothing outside the account that created
--      it, and the same is true of a PayPal subscription. So the day the API
--      keys are swapped - test to live, or one merchant to another - every
--      subscription already in this database becomes unreachable, and the
--      nightly job that reconciles billing periods starts failing on each of
--      them, every night, with a 404 that looks like a bug.
--
--      Recording the account the subscription was opened under turns that from
--      a recurring mystery into a fact the system can act on: the job skips
--      them instead of erroring, and the UI can say why a renewal date is
--      missing rather than showing a stale one.
--
--      Nullable, because rows created before this cannot know. They are
--      treated as "belongs to whichever account is configured", which is the
--      old behaviour and the right assumption for a deployment that never
--      changed keys.
-- ---------------------------------------------------------------------------

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_account_id VARCHAR(120);

COMMENT ON COLUMN subscriptions.provider_account_id IS
  'Stripe account id (acct_...) or PayPal client id under which this subscription was created. Null for rows that predate the column.';
