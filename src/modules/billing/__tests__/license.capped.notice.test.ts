import { pool } from '../../../config/database';
import {
  getPlatformSmtpConfig,
  sendPlatformEmail,
} from '../../../services/platformEmail.service';
import { sendNotification } from '../../notifications/notifications.service';
import { sendLicenseReductionCappedNotice } from '../billing.notifications';

jest.mock('../../../config/database', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
}));
jest.mock('../../../services/platformEmail.service', () => ({
  sendPlatformEmail: jest.fn(),
  getPlatformSmtpConfig: jest.fn(),
}));
jest.mock('../../notifications/notifications.service', () => ({
  sendNotification: jest.fn(),
}));

const mockQuery = pool.query as unknown as jest.Mock;
const mockEmail = sendPlatformEmail as unknown as jest.Mock;
const mockPlatformCfg = getPlatformSmtpConfig as unknown as jest.Mock;
const mockNotify = sendNotification as unknown as jest.Mock;

/** The two queries `resolveFailureRecipients` makes, in order. */
function mockRecipients(owner: { id: number; email: string; name: string } | null, adminIds: number[] = []) {
  mockQuery.mockResolvedValueOnce({
    rowCount: 1,
    rows: [
      {
        company_email: null,
        owner_id: owner?.id ?? null,
        owner_email: owner?.email ?? null,
        owner_name: owner?.name ?? null,
        owner_surname: null,
        admin_id: null,
        admin_email: null,
        admin_name: null,
        admin_surname: null,
      },
    ],
  });
  mockQuery.mockResolvedValueOnce({
    rowCount: adminIds.length,
    rows: adminIds.map((id) => ({ id })),
  });
}

const capped = {
  companyId: 7,
  companyName: 'Fusaro Uomo',
  requestedSeats: 7,
  requestedDevices: null,
  appliedSeats: 10,
  appliedDevices: 4,
  inUseEmployees: 10,
  inUseTerminals: 3,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockEmail.mockReset();
  mockNotify.mockReset();
  mockPlatformCfg.mockReset();
  mockNotify.mockResolvedValue(undefined);
  mockEmail.mockResolvedValue({ ok: true, status: 'sent', transport: 'platform' });
  mockPlatformCfg.mockResolvedValue({
    smtpHost: 'smtp.veylo.it',
    smtpPort: 587,
    smtpUser: 'billing@veylo.it',
    smtpPass: 'secret',
    smtpFrom: 'Veylo HR <billing@veylo.it>',
    billingAlertEmail: 'ops@veylo.it',
    verifiedAt: null,
    lastError: null,
    updatedAt: null,
  });
  delete process.env.BILLING_ALERT_EMAIL;
});

describe('sendLicenseReductionCappedNotice', () => {
  it('warns the owner and copies the operator, naming the numbers', async () => {
    mockRecipients({ id: 3, email: 'owner@fusaro.it', name: 'Francesca' }, [3, 9]);

    await sendLicenseReductionCappedNotice(capped);

    expect(mockEmail).toHaveBeenCalledTimes(2);

    const [ownerMail] = mockEmail.mock.calls[0];
    expect(ownerMail.to).toBe('owner@fusaro.it');
    expect(ownerMail.text).toContain('7');
    expect(ownerMail.text).toContain('10');

    const [operatorMail] = mockEmail.mock.calls[1];
    expect(operatorMail.to).toBe('ops@veylo.it');
    expect(operatorMail.subject).toContain('Fusaro Uomo');

    // In-app for the owner and every admin: it cannot bounce.
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify.mock.calls[0][0].type).toBe('billing.reduction_capped');
  });

  it('says nothing when the reduction was applied in full', async () => {
    await sendLicenseReductionCappedNotice({
      ...capped,
      requestedSeats: 7,
      appliedSeats: 7,
      requestedDevices: null,
    });

    expect(mockEmail).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('still copies the operator when no owner address can be found', async () => {
    mockRecipients(null, []);

    await sendLicenseReductionCappedNotice(capped);

    expect(mockEmail).toHaveBeenCalledTimes(1);
    const [operatorMail] = mockEmail.mock.calls[0];
    expect(operatorMail.to).toBe('ops@veylo.it');
    expect(operatorMail.text).toContain('ATTENZIONE');
  });

  it('never throws when the mail server refuses', async () => {
    mockRecipients({ id: 3, email: 'owner@fusaro.it', name: 'Francesca' }, [3]);
    mockEmail.mockRejectedValue(new Error('SMTP down'));

    await expect(sendLicenseReductionCappedNotice(capped)).resolves.toBeUndefined();
  });
});
