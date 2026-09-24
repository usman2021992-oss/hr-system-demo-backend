import cron from 'node-cron';
import { pool } from '../config/database';
import { getPaymentGateway } from '../modules/billing/gateway.factory';
import { sendPlatformEmail } from '../services/platformEmail.service';
import { getEmailBrand, renderBillingEmail } from '../services/emailTemplate';
import {
  recordNoticeDelivery,
  resolveFailureRecipients,
  sendPaymentFailedNotices,
} from '../modules/billing/billing.notifications';

/** Italian money formatting, matching the failed-payment emails. */
function formatMoneyIt(cents: number, currency: string): string {
  const formatted = (cents / 100).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'EUR' ? `€ ${formatted}` : `${formatted} ${currency}`;
}

/** Where the customer manages their subscription. */
function appBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ??
    process.env.FRONTEND_URL ??
    process.env.PUBLIC_APP_URL ??
    process.env.CORS_ORIGIN?.split(',')[0];
  return (raw && raw.trim() !== '' ? raw : 'http://localhost:5173').replace(/\/+$/, '');
}
import { getTaxConfig, taxCentsOnLines } from '../modules/billing/tax';
import { realignSubscriptionTaxRates, syncBillingTaxRate } from '../modules/billing/tax.sync';
import {
  subscriptionService,
  announceBillingChange,
  syncSubscriptionPricing,
  notifyReductionCappedOnce,
} from '../modules/billing/subscription.service';
import { countBillableResources } from '../modules/billing/headcount.service';
import { applyReductionFloor } from '../modules/billing/license.service';

/**
 * Applies license reductions the admin scheduled during the period.
 *
 * Licenses are what the company bought, not how many users happen to exist,
 * so nothing is recounted here. Only an explicit reduction parked in
 * pending_* is pushed to the gateway, and only as the new period begins.
 */
export async function processBillingRenewalReconciliations() {
  try {
    const subRes = await pool.query(
      `SELECT s.*, c.name AS company_name
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.status = 'active'
         AND s.current_period_end IS NOT NULL
         AND s.current_period_end <= NOW() + INTERVAL '24 hours'
         AND (s.pending_seat_quantity IS NOT NULL OR s.pending_device_quantity IS NOT NULL)`
    );

    for (const sub of subRes.rows) {
      try {
        // The reduction was checked against usage when it was requested, and
        // usage has had a whole period to move since. Live counts are the floor
        // here, so a company can never end a renewal with more active people
        // than licences; whatever cannot be applied stays pending for next time.
        const liveCounts = await countBillableResources(sub.company_id);
        const reduction = applyReductionFloor({
          currentSeats: sub.seat_quantity,
          currentDevices: sub.device_quantity,
          requestedSeats: sub.pending_seat_quantity,
          requestedDevices: sub.pending_device_quantity,
          inUseEmployees: liveCounts.employeeCount,
          inUseTerminals: liveCounts.deviceCount,
        });
        const targetSeats = reduction.seats;
        const targetDevices = reduction.devices;

        console.log(
          `[BillingJob] Applying scheduled license reduction for ${sub.company_name} (seats ${sub.seat_quantity} -> ${targetSeats}, terminals ${sub.device_quantity} -> ${targetDevices})`
        );

        if (reduction.seatsCapped || reduction.devicesCapped) {
          console.warn(
            `[BillingJob] Reduction capped by usage for ${sub.company_name}: ` +
              `asked for seats ${sub.pending_seat_quantity ?? '-'} / terminals ${sub.pending_device_quantity ?? '-'}, ` +
              `applied ${targetSeats} / ${targetDevices} against ${liveCounts.employeeCount} active employees and ` +
              `${liveCounts.deviceCount} active terminals. The request stays pending.`
          );
        }

        if (sub.provider_subscription_id) {
          const gateway = getPaymentGateway(sub.provider);
          await gateway.updateSubscriptionQuantities({
            providerSubscriptionId: sub.provider_subscription_id,
            newSeatQuantity: targetSeats,
            newDeviceQuantity: targetDevices,
            unitPriceEmployee: parseFloat(sub.unit_price_employee),
            unitPriceDevice: parseFloat(sub.unit_price_device),
            currency: sub.currency,
            immediate: false, // takes effect at renewal, never refunded
          });
        }

        await pool.query(
          `UPDATE subscriptions
           SET seat_quantity = $1,
               device_quantity = $2,
               pending_seat_quantity = $4,
               pending_device_quantity = $5,
               reduction_capped_notified_at = CASE
                 WHEN $4::int IS NULL AND $5::int IS NULL THEN NULL
                 ELSE reduction_capped_notified_at
               END,
               updated_at = NOW()
           WHERE id = $3`,
          [
            targetSeats,
            targetDevices,
            sub.id,
            reduction.keepPendingSeats,
            reduction.keepPendingDevices,
          ]
        );

        if (reduction.seatsCapped || reduction.devicesCapped) {
          await notifyReductionCappedOnce({
            subscriptionId: sub.id,
            companyId: sub.company_id,
            requestedSeats: sub.pending_seat_quantity,
            requestedDevices: sub.pending_device_quantity,
            appliedSeats: targetSeats,
            appliedDevices: targetDevices,
            inUseEmployees: liveCounts.employeeCount,
            inUseTerminals: liveCounts.deviceCount,
          });
        }
      } catch (err: any) {
        console.error(
          `[BillingJob] Error applying reduction for subscription ${sub.id}:`,
          err.message
        );
      }
    }
  } catch (err: any) {
    console.error('[BillingJob] Error in renewal reconciliation:', err);
  }
}

/**
 * Settles license upgrades still waiting on a payment confirmation.
 *
 * The billing page reconciles on load, but a company that never opens it would
 * otherwise keep a hold forever. This closes the loop nightly.
 */
export async function processStuckLicenseUpgrades() {
  try {
    const res = await pool.query(
      `SELECT DISTINCT company_id FROM subscriptions
       WHERE status IN ('active', 'past_due')
         AND (requested_seat_quantity IS NOT NULL OR requested_device_quantity IS NOT NULL)`
    );

    for (const row of res.rows) {
      try {
        const outcome = await subscriptionService.reconcilePendingUpgrade(row.company_id);
        if (outcome.changed) {
          console.log(
            `[BillingJob] Settled pending upgrade for company ${row.company_id}: ${outcome.outcome}`
          );
        }
      } catch (err: any) {
        console.error(
          `[BillingJob] Could not settle upgrade for company ${row.company_id}:`,
          err?.message || err
        );
      }
    }
  } catch (err: any) {
    console.error('[BillingJob] Error sweeping stuck upgrades:', err);
  }
}

export async function processBillingReminders() {
  try {
    // Find active subscriptions renewing within the company's reminder window
    // that have not been reminded for this billing period yet.
    const subRes = await pool.query(
      `SELECT s.*, c.name AS company_name, c.company_email,
              c.price_per_employee, c.price_per_device,
              c.bill_reminder_days_before
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.status = 'active'
         AND s.current_period_end IS NOT NULL
         AND s.current_period_end <= NOW() + (COALESCE(c.bill_reminder_days_before, 3) * INTERVAL '1 day')
         AND s.current_period_end > NOW()
         AND (
           s.reminder_sent_at IS NULL
           OR (s.current_period_start IS NOT NULL AND s.reminder_sent_at < s.current_period_start)
         )`
    );

    const brand = await getEmailBrand();
    const billingUrl = `${appBaseUrl()}/impostazioni/fatturazione`;

    for (const sub of subRes.rows) {
      try {
        // Addressed like the failed-payment warning: to the person who owns
        // the account, from the platform's own mailbox. It used to go to the
        // generic company address through that company's SMTP, which meant a
        // customer without their own mail server was never reminded at all.
        const recipients = await resolveFailureRecipients(sub.company_id);
        const owner = recipients.owner;
        const to = owner
          ? recipients.companyEmail &&
            recipients.companyEmail.toLowerCase() !== owner.email.toLowerCase()
            ? `${owner.email}, ${recipients.companyEmail}`
            : owner.email
          : recipients.companyEmail;

        if (!to) {
          console.warn(
            `[BillingJob] No reminder recipient for company ${sub.company_id}; skipping.`
          );
          continue;
        }

        // The reminder has to quote what will actually be taken, so it states
        // the same subtotal / tax / total the provider will charge rather than
        // the net figure alone.
        const seatCents = Math.round(sub.seat_quantity * parseFloat(sub.unit_price_employee) * 100);
        const deviceCents = Math.round(sub.device_quantity * parseFloat(sub.unit_price_device) * 100);
        const taxCents = taxCentsOnLines([seatCents, deviceCents]);
        const taxPercent = getTaxConfig().percent;
        const currency = sub.currency || 'EUR';
        const renewalDate = new Date(sub.current_period_end).toLocaleDateString('it-IT');

        const facts = [
          { label: 'Azienda', value: sub.company_name },
          { label: 'Data di rinnovo', value: renewalDate },
          { label: 'Dipendenti', value: String(sub.seat_quantity) },
          { label: 'Terminali', value: String(sub.device_quantity) },
          { label: 'Imponibile', value: formatMoneyIt(seatCents + deviceCents, currency) },
          ...(taxCents > 0
            ? [{ label: `IVA ${taxPercent}%`, value: formatMoneyIt(taxCents, currency) }]
            : []),
          {
            label: 'Totale previsto',
            value: formatMoneyIt(seatCents + deviceCents + taxCents, currency),
          },
        ];

        const { html, text } = renderBillingEmail(
          {
            banner: { tone: 'info', text: 'Promemoria di rinnovo' },
            greeting: owner ? `Gentile ${owner.name},` : 'Gentile Cliente,',
            title: `L’abbonamento si rinnova il ${renewalDate}`,
            paragraphs: [
              `Ti informiamo che l’abbonamento mensile per ${sub.company_name} si rinnoverà automaticamente il ${renewalDate}.`,
              'Non devi fare nulla: l’addebito avverrà sul metodo di pagamento registrato.',
            ],
            facts,
            action: { label: 'Vedi la fatturazione', url: billingUrl },
            note: 'Se vuoi modificare le licenze o il metodo di pagamento, puoi farlo prima della data di rinnovo.',
          },
          brand
        );

        const result = await sendPlatformEmail(
          {
            to,
            subject: `Promemoria rinnovo abbonamento ${brand.brandName} - ${sub.company_name}`,
            html,
            text,
          },
          sub.company_id
        );

        // Stamp only on a real send. sendPlatformEmail reports a skipped or
        // refused delivery by returning ok:false rather than by throwing, so
        // the old .then() marked the reminder as sent whenever the call
        // completed - including every time it sent nothing - and it was then
        // never retried for that period.
        if (result.ok) {
          await pool.query(`UPDATE subscriptions SET reminder_sent_at = NOW() WHERE id = $1`, [
            sub.id,
          ]);
        } else {
          console.warn(
            `[BillingJob] Renewal reminder for company ${sub.company_id} not sent ` +
              `(${result.status} via ${result.transport}): ${result.message ?? 'no detail'}. ` +
              'It will be retried on the next run.'
          );
        }
      } catch (err: any) {
        console.error(
          `[BillingJob] Renewal reminder failed for company ${sub.company_id}:`,
          err?.message || err
        );
      }
    }
  } catch (err: any) {
    console.error('[BillingJob] Error in billing reminders:', err);
  }
}

export async function processBillingGracePeriodExpirations() {
  try {
    // Find past_due subscriptions where grace period has ended
    const expiredRes = await pool.query(
      `UPDATE subscriptions 
       SET status = 'unpaid', updated_at = NOW()
       WHERE status = 'past_due'
         AND grace_period_ends_at IS NOT NULL
         AND grace_period_ends_at < NOW()
       RETURNING id, company_id`
    );

    if (expiredRes.rowCount && expiredRes.rowCount > 0) {
      console.log(
        `[BillingJob] Marked ${expiredRes.rowCount} subscriptions as unpaid due to expired grace periods.`
      );
    }
  } catch (err: any) {
    console.error('[BillingJob] Error checking grace period expirations:', err);
  }
}

/**
 * Registers the cron schedule (Runs daily at 02:00 AM)
 */
/**
 * Realigns each stored billing period with the provider's.
 *
 * The provider owns the period; our copy is a cache that exists so the app can
 * render a renewal date without a network call. Any cache can go stale — a
 * webhook that is missed, retried out of order, or arrives without period data
 * all leave ours wrong, and a wrong renewal date is visible to the customer on
 * every billing screen.
 *
 * Rather than trusting that every write path is correct forever, this asks the
 * provider what the period actually is and corrects ours when they disagree.
 * It is read-only at the provider and safe to run repeatedly.
 */
export async function processSubscriptionPeriodDrift() {
  try {
    const subRes = await pool.query(
      `SELECT id, company_id, provider, provider_subscription_id,
              provider_account_id, current_period_start, current_period_end
       FROM subscriptions
       WHERE status IN ('active', 'past_due')
         AND provider_subscription_id IS NOT NULL`
    );

    let corrected = 0;
    let skippedForeign = 0;

    // Which account the current keys act as, asked once for the whole sweep.
    const currentAccounts = new Map<string, string | null>();
    const accountFor = async (provider: string): Promise<string | null> => {
      if (!currentAccounts.has(provider)) {
        try {
          const gw = getPaymentGateway(provider as any) as any;
          currentAccounts.set(provider, (await gw.getAccountId?.()) ?? null);
        } catch {
          currentAccounts.set(provider, null);
        }
      }
      return currentAccounts.get(provider) ?? null;
    };

    for (const sub of subRes.rows) {
      try {
        // A subscription created under different keys cannot be read back:
        // the provider answers 404, which used to be logged as an error every
        // single night for every such row. It is not an error - it is a
        // subscription that belongs to another account - so it is skipped and
        // counted. Rows with no recorded account predate the column and are
        // still checked, which is the old behaviour.
        const currentAccount = await accountFor(sub.provider);
        if (sub.provider_account_id && currentAccount && sub.provider_account_id !== currentAccount) {
          skippedForeign++;
          continue;
        }

        const gateway = getPaymentGateway(sub.provider);
        if (!gateway.getSubscriptionPeriod) continue;

        const period = await gateway.getSubscriptionPeriod(sub.provider_subscription_id);
        if (!period.start || !period.end) continue;

        const storedEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
        const storedStart = sub.current_period_start ? new Date(sub.current_period_start) : null;

        // A minute of slack: providers report whole seconds, and a rounding
        // difference is not drift worth rewriting a row for.
        const drifted =
          !storedEnd ||
          !storedStart ||
          Math.abs(storedEnd.getTime() - period.end.getTime()) > 60_000 ||
          Math.abs(storedStart.getTime() - period.start.getTime()) > 60_000;

        if (!drifted) continue;

        await pool.query(
          `UPDATE subscriptions
           SET current_period_start = $1, current_period_end = $2, updated_at = NOW()
           WHERE id = $3`,
          [period.start, period.end, sub.id]
        );
        corrected++;

        console.warn(
          `[BillingJob] Corrected billing period for company ${sub.company_id} ` +
            `(subscription ${sub.id}): stored ${storedStart?.toISOString() ?? 'none'} -> ` +
            `${storedEnd?.toISOString() ?? 'none'}, provider ` +
            `${period.start.toISOString()} -> ${period.end.toISOString()}`
        );

        // The renewal date is on screen, so push the correction out.
        announceBillingChange(sub.company_id, 'period_corrected');
      } catch (err) {
        console.error(
          `[BillingJob] Period check failed for subscription ${sub.id}:`,
          (err as Error)?.message || err
        );
      }
    }

    if (corrected > 0) {
      console.log(`[BillingJob] Billing periods corrected: ${corrected}`);
    }
    if (skippedForeign > 0) {
      console.log(
        `[BillingJob] Skipped ${skippedForeign} subscriptions created under different provider credentials.`
      );
    }
  } catch (err) {
    console.error('[BillingJob] processSubscriptionPeriodDrift failed:', err);
  }
}


/**
 * Reprices subscriptions whose company price or discount has since changed.
 *
 * Price edits normally reach the subscription the moment they are made, but a
 * gateway call can fail, and a discount can start or expire on a date with
 * nobody watching. This closes both gaps: it compares every live subscription
 * against its company's current pricing and corrects what has drifted.
 */
export async function processSubscriptionPricingDrift() {
  try {
    const subRes = await pool.query(
      `SELECT id, company_id, provider, provider_subscription_id, seat_quantity,
              device_quantity, unit_price_employee, unit_price_device, currency, status
       FROM subscriptions
       WHERE status IN ('active', 'past_due')`
    );

    for (const sub of subRes.rows) {
      try {
        await syncSubscriptionPricing(sub);
      } catch (err) {
        console.error(
          `[BillingJob] Repricing failed for subscription ${sub.id}:`,
          (err as Error)?.message || err
        );
      }
    }
  } catch (err) {
    console.error('[BillingJob] processSubscriptionPricingDrift failed:', err);
  }
}


export function startBillingCron() {
  cron.schedule('0 2 * * *', async () => {
    console.log('[BillingJob] Running daily billing jobs...');
    await processStuckLicenseUpgrades();
    await processSubscriptionPeriodDrift();
    await processSubscriptionPricingDrift();
    await processBillingRenewalReconciliations();
    await processBillingReminders();
    // Before the expiry sweep, so a customer whose warning never arrived gets
    // one more chance while the grace period is still running.
    await processUndeliveredPaymentNotices();
    await processBillingGracePeriodExpirations();
    await syncBillingTaxRate();
    // After the rate is refreshed, not before: realignment attaches whatever
    // the mirror now says, so it has to read the corrected value.
    await realignSubscriptionTaxRates();
  });

  // A deployment is exactly when a period may already be wrong from an
  // earlier build, so check once on boot instead of waiting until 02:00.
  // Delayed a little to stay clear of startup.
  // The rate is needed before the first price is rendered, so this one is not
  // delayed: every total shown until it lands comes from configuration alone.
  syncBillingTaxRate().catch((err) =>
    console.error('[BillingJob] Startup tax sync failed:', err)
  );

  setTimeout(() => {
    processSubscriptionPeriodDrift().catch((err) =>
      console.error('[BillingJob] Startup period check failed:', err)
    );
  }, 30_000).unref();

  console.log('✓ Billing scheduled jobs initialized (daily at 02:00)');
}

/**
 * Tries again for warnings that never actually reached the customer.
 *
 * The notification stamp is claimed before the send, deliberately: two webhook
 * retries arriving together must not both decide they are the first. The cost
 * of that is that a send which fails is never retried - the stamp says it was
 * handled - so a customer whose mailbox was briefly unreachable is left
 * believing nothing was wrong until their access stops.
 *
 * The outcome of every attempt is already recorded on the failed transaction,
 * which makes the undelivered ones findable. This re-sends them once a night
 * for as long as the grace period lasts, and stops the moment one is accepted.
 * A few attempts over three days, bounded by the deadline itself.
 */
export async function processUndeliveredPaymentNotices() {
  try {
    const res = await pool.query(
      `SELECT t.id            AS transaction_id,
              t.amount_cents,
              t.currency,
              t.failure_code,
              t.failure_message,
              t.invoice_url,
              s.id            AS subscription_id,
              s.company_id,
              s.provider,
              s.grace_period_ends_at,
              COALESCE(s.grace_period_days, 3) AS grace_period_days,
              c.name          AS company_name
         FROM billing_transactions t
         JOIN subscriptions s ON s.id = t.subscription_id
         JOIN companies c     ON c.id = s.company_id
        WHERE t.status = 'failed'
          AND s.status = 'past_due'
          AND s.grace_period_ends_at IS NOT NULL
          AND s.grace_period_ends_at > NOW()
          -- Only the ones that genuinely did not arrive. 'sent' is done, and a
          -- null status belongs to a row written before delivery was recorded.
          AND t.notice_email_status IN ('failed', 'skipped', 'no_recipient')
          -- The newest failure per subscription; an older one is superseded.
          AND t.id = (
            SELECT t2.id FROM billing_transactions t2
             WHERE t2.subscription_id = s.id AND t2.status = 'failed'
             ORDER BY t2.id DESC LIMIT 1
          )`
    );

    if (res.rowCount === 0) return;

    console.log(`[BillingJob] Retrying ${res.rowCount} undelivered payment warnings.`);

    for (const row of res.rows) {
      try {
        const delivery = await sendPaymentFailedNotices({
          companyId: row.company_id,
          companyName: row.company_name,
          provider: row.provider,
          amountCents: row.amount_cents ?? null,
          currency: row.currency || 'EUR',
          gracePeriodEndsAt: new Date(row.grace_period_ends_at),
          graceDays: row.grace_period_days,
          failureMessage: row.failure_message ?? null,
          // Rebuilt from what was stored rather than from the webhook, which
          // is long gone: a 3D Secure hold must still send the link that
          // completes it, not a generic "update your card".
          requiresAction: row.failure_code === 'authentication_required',
          actionUrl: row.invoice_url ?? null,
        });

        await recordNoticeDelivery(row.transaction_id, delivery);

        if (delivery.ownerStatus === 'sent') {
          console.log(
            `[BillingJob] Payment warning for company ${row.company_id} delivered on retry.`
          );
          announceBillingChange(row.company_id, 'payment_failed_notified');
        }
      } catch (err: any) {
        console.error(
          `[BillingJob] Retry of the payment warning for company ${row.company_id} failed:`,
          err?.message || err
        );
      }
    }
  } catch (err: any) {
    console.error('[BillingJob] Error retrying undelivered payment warnings:', err);
  }
}
