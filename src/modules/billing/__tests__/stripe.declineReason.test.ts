import { StripeGateway } from '../stripe.service';

/**
 * Why a renewal was refused, whichever API version rendered the webhook.
 *
 * A webhook payload is rendered in the API version configured on the Stripe
 * *account*, not the one this client is pinned to. On newer versions the
 * invoice carries no `payment_intent`, which meant the decline reason was never
 * read and the customer got a generic "payment failed" instead of "your card
 * has expired".
 */
describe('decline reason across Stripe API versions', () => {
  const declined = {
    last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
  };

  function gatewayWith(stripeMock: any): any {
    const gateway: any = new StripeGateway();
    gateway.stripe = stripeMock;
    return gateway;
  }

  it('reads the old shape: payment_intent as a string on the invoice', async () => {
    const retrieve = jest.fn().mockResolvedValue(declined);
    const invoiceRetrieve = jest.fn();
    const gateway = gatewayWith({
      paymentIntents: { retrieve },
      invoices: { retrieve: invoiceRetrieve },
    });

    const code = await gateway.resolveInvoiceDeclineCode({ id: 'in_1', payment_intent: 'pi_1' });

    expect(code).toBe('insufficient_funds');
    expect(retrieve).toHaveBeenCalledWith('pi_1');
    // Nothing to re-fetch: the payload already had it.
    expect(invoiceRetrieve).not.toHaveBeenCalled();
  });

  it('reads the newer shape: payments[].payment.payment_intent', async () => {
    const retrieve = jest.fn().mockResolvedValue(declined);
    const invoiceRetrieve = jest.fn();
    const gateway = gatewayWith({
      paymentIntents: { retrieve },
      invoices: { retrieve: invoiceRetrieve },
    });

    const code = await gateway.resolveInvoiceDeclineCode({
      id: 'in_2',
      payments: { data: [{ payment: { payment_intent: 'pi_2' } }] },
    });

    expect(code).toBe('insufficient_funds');
    expect(retrieve).toHaveBeenCalledWith('pi_2');
    expect(invoiceRetrieve).not.toHaveBeenCalled();
  });

  it('re-reads the invoice when the payload carries no payment at all', async () => {
    const retrieve = jest.fn().mockResolvedValue(declined);
    // The pinned API version still renders payment_intent on a fresh read.
    const invoiceRetrieve = jest.fn().mockResolvedValue({ id: 'in_3', payment_intent: 'pi_3' });
    const gateway = gatewayWith({
      paymentIntents: { retrieve },
      invoices: { retrieve: invoiceRetrieve },
    });

    const code = await gateway.resolveInvoiceDeclineCode({ id: 'in_3' });

    expect(invoiceRetrieve).toHaveBeenCalledWith('in_3');
    expect(code).toBe('insufficient_funds');
  });

  it('prefers the bank decline code, falling back to Stripe\'s own', async () => {
    const gateway = gatewayWith({
      paymentIntents: { retrieve: jest.fn().mockResolvedValue({ last_payment_error: { code: 'expired_card' } }) },
      invoices: { retrieve: jest.fn() },
    });

    expect(await gateway.resolveInvoiceDeclineCode({ id: 'in_4', payment_intent: 'pi_4' })).toBe('expired_card');
  });

  it('gives up quietly when the payment cannot be found anywhere', async () => {
    const gateway = gatewayWith({
      paymentIntents: { retrieve: jest.fn() },
      invoices: { retrieve: jest.fn().mockResolvedValue({ id: 'in_5' }) },
    });

    expect(await gateway.resolveInvoiceDeclineCode({ id: 'in_5' })).toBeNull();
  });

  it('never throws when Stripe itself errors', async () => {
    const gateway = gatewayWith({
      paymentIntents: { retrieve: jest.fn() },
      invoices: { retrieve: jest.fn().mockRejectedValue(new Error('network')) },
    });

    await expect(gateway.resolveInvoiceDeclineCode({ id: 'in_6' })).resolves.toBeNull();
  });
});
