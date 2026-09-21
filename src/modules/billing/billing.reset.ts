import { pool } from '../../config/database';

/**
 * Removing a company's billing history.
 *
 * This exists because provider credentials get swapped - test keys for the
 * client's, later the client's test keys for live ones - and every
 * subscription and payment recorded under the old account becomes a row that
 * refers to something the provider no longer admits exists. It cannot be
 * repaired, only removed, and leaving it in place means a renewal date nobody
 * can trust, a revenue figure counting test money, and a nightly job failing
 * on rows that will never resolve.
 *
 * It is deliberately narrow. It deletes the *records* of billing for one
 * company: its subscriptions, its transactions, and the headcount events that
 * justified them. It does not touch the company, its people, or its billing
 * *settings* - price per licence, grace period, whether billing is enforced -
 * because those are configuration somebody entered, not history, and losing
 * them turns a cleanup into a re-setup.
 *
 * What it cannot do is cancel anything at the provider. By the time this is
 * needed the keys usually no longer reach those objects; and even when they
 * do, deleting our record of a live subscription while it keeps billing is a
 * worse outcome than leaving both. So the caller is told what is still active
 * and has to decide.
 */

export interface BillingResetPreview {
  companyId: number;
  companyName: string;
  subscriptions: number;
  transactions: number;
  headcountEvents: number;
  /**
   * Subscriptions that are still live as far as this database knows. If they
   * are also live at the provider, deleting these rows stops us tracking a
   * subscription that carries on charging.
   */
  activeSubscriptions: Array<{
    id: number;
    provider: string;
    status: string;
    providerSubscriptionId: string | null;
    /** True when it was opened under credentials that are no longer in use. */
    foreignAccount: boolean;
  }>;
}

/** Counts what a reset would remove, changing nothing. */
export async function previewBillingReset(
  companyId: number,
  currentAccountFor: (provider: string) => Promise<string | null>
): Promise<BillingResetPreview> {
  const company = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
  if (!company.rowCount) {
    throw new Error(`Company not found: ${companyId}`);
  }

  const [subs, tx, headcount] = await Promise.all([
    pool.query(
      `SELECT id, provider, status, provider_subscription_id, provider_account_id
         FROM subscriptions WHERE company_id = $1 ORDER BY id`,
      [companyId]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM billing_transactions WHERE company_id = $1`, [
      companyId,
    ]),
    pool
      .query(`SELECT COUNT(*)::int AS n FROM billing_headcount_events WHERE company_id = $1`, [
        companyId,
      ])
      // The table arrived in migration 131; a database that predates it should
      // still be able to preview a reset rather than fail on a missing table.
      .catch(() => ({ rows: [{ n: 0 }] })),
  ]);

  const activeSubscriptions = [];
  for (const s of subs.rows) {
    if (!['active', 'past_due', 'pending'].includes(s.status)) continue;
    let foreignAccount = false;
    try {
      const current = await currentAccountFor(s.provider);
      foreignAccount = !!(s.provider_account_id && current && s.provider_account_id !== current);
    } catch {
      // Unknown means "cannot claim it is foreign", which is the safe answer:
      // it keeps the warning about a possibly-live subscription visible.
    }
    activeSubscriptions.push({
      id: s.id,
      provider: s.provider,
      status: s.status,
      providerSubscriptionId: s.provider_subscription_id ?? null,
      foreignAccount,
    });
  }

  return {
    companyId,
    companyName: company.rows[0].name,
    subscriptions: subs.rowCount ?? 0,
    transactions: tx.rows[0]?.n ?? 0,
    headcountEvents: headcount.rows[0]?.n ?? 0,
    activeSubscriptions,
  };
}

export interface BillingResetResult {
  companyId: number;
  companyName: string;
  deletedSubscriptions: number;
  deletedTransactions: number;
  deletedHeadcountEvents: number;
}

/**
 * Deletes one company's billing history.
 *
 * All of it in a single transaction: a half-removed history - payments without
 * the subscription that produced them - is harder to reason about than either
 * end state.
 */
export async function resetCompanyBilling(companyId: number): Promise<BillingResetResult> {
  const company = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
  if (!company.rowCount) {
    throw new Error(`Company not found: ${companyId}`);
  }
  const companyName = company.rows[0].name;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Transactions first: they reference the subscriptions.
    const tx = await client.query(
      `DELETE FROM billing_transactions WHERE company_id = $1`,
      [companyId]
    );

    let headcountDeleted = 0;
    try {
      const hc = await client.query(
        `DELETE FROM billing_headcount_events WHERE company_id = $1`,
        [companyId]
      );
      headcountDeleted = hc.rowCount ?? 0;
    } catch (err: any) {
      // Same reasoning as the preview: a database without the table is not a
      // reason to abandon the reset.
      console.warn('[BillingReset] Headcount events not cleared:', err?.message || err);
    }

    const subs = await client.query(`DELETE FROM subscriptions WHERE company_id = $1`, [
      companyId,
    ]);

    await client.query('COMMIT');

    // Loud on purpose. This is irreversible and somebody will want to know
    // exactly what went, and when, without reconstructing it from a UI action.
    console.warn(
      `[BillingReset] Cleared billing for company ${companyId} (${companyName}): ` +
        `${subs.rowCount} subscriptions, ${tx.rowCount} transactions, ` +
        `${headcountDeleted} headcount events.`
    );

    return {
      companyId,
      companyName,
      deletedSubscriptions: subs.rowCount ?? 0,
      deletedTransactions: tx.rowCount ?? 0,
      deletedHeadcountEvents: headcountDeleted,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
