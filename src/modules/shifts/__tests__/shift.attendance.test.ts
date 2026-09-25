import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import shiftsRoutes from '../shifts.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

/**
 * What the calendar says happened on each shift.
 *
 * The rules are only interesting at the edges — a missing clock-out inside the
 * grace period is someone still working, the same thing tomorrow is a problem;
 * an event recorded by hand carries no shift id and still has to find its shift.
 */

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err?.statusCode ?? 500).json({ success: false, error: err.message });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;
let token: string;

const TAG = 'test:attendance-state';

async function makeShift(opts: {
  startOffsetHours: number;
  endOffsetHours: number;
  cancelled?: boolean;
  offDay?: boolean;
}): Promise<number> {
  const { rows: [row] } = await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, timezone,
                         start_time, end_time, start_at_utc, end_at_utc,
                         is_off_day, status, notes)
     VALUES ($1, $2, $3,
             ((NOW() + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Rome')::date,
             'Europe/Rome',
             ((NOW() + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Rome')::time,
             ((NOW() + ($5 || ' hours')::interval) AT TIME ZONE 'Europe/Rome')::time,
             NOW() + ($4 || ' hours')::interval,
             NOW() + ($5 || ' hours')::interval,
             $6, $7, $8)
     RETURNING id`,
    [
      seeds.acmeId, seeds.romaStoreId, seeds.employee1Id,
      String(opts.startOffsetHours), String(opts.endOffsetHours),
      opts.offDay ?? false,
      opts.cancelled ? 'cancelled' : 'scheduled',
      TAG,
    ],
  );
  return row.id as number;
}

async function addEvent(shiftId: number | null, type: string, hoursFromNow: number) {
  await testPool.query(
    `INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::interval, $6, $7, $8)
     ON CONFLICT (company_id, user_id, event_type, event_time) DO NOTHING`,
    [
      seeds.acmeId, seeds.romaStoreId, seeds.employee1Id, type, String(hoursFromNow),
      shiftId === null ? 'manual' : 'qr', shiftId, TAG,
    ],
  );
}

/** Reads one shift back through the API the calendar uses. */
async function stateOf(shiftId: number): Promise<any> {
  const res = await request
    .get('/api/shifts?start_date=' + isoDay(-3) + '&end_date=' + isoDay(3))
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.shifts;
  return list.find((s: any) => s.id === shiftId);
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  seeds = await seedTestData();
  await testPool.query('DELETE FROM login_attempts');
  const login = await request.post('/api/auth/login').send({ email: 'admin@acme-test.com', password: 'password123' });
  token = login.body.data.token;
});

afterEach(async () => {
  await testPool.query(`DELETE FROM attendance_events WHERE notes = $1`, [TAG]);
  await testPool.query(`DELETE FROM shifts WHERE notes = $1`, [TAG]);
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('attendance state per shift', () => {
  it('two clock-ins and a clock-out make a completed shift', async () => {
    const id = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(id, 'checkin', -8.9);
    await addEvent(id, 'checkout', -1.1);

    const shift = await stateOf(id);
    expect(shift.attendance_state).toBe('completed');
    expect(shift.attendance_checkin_at).toBeTruthy();
    expect(shift.attendance_checkout_at).toBeTruthy();
  });

  it('counts someone still inside their shift as in progress, not incomplete', async () => {
    const id = await makeShift({ startOffsetHours: -2, endOffsetHours: 3 });
    await addEvent(id, 'checkin', -1.9);

    expect((await stateOf(id)).attendance_state).toBe('in_progress');
  });

  it('still says in progress inside the clock-out grace period', async () => {
    // Ended an hour ago; people clock out late, and an instant warning cries wolf.
    const id = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(id, 'checkin', -8.9);

    expect((await stateOf(id)).attendance_state).toBe('in_progress');
  });

  it('calls it incomplete once the grace has passed', async () => {
    const id = await makeShift({ startOffsetHours: -12, endOffsetHours: -4 });
    await addEvent(id, 'checkin', -11.9);

    expect((await stateOf(id)).attendance_state).toBe('incomplete');
  });

  it('marks a past shift with nothing recorded as missed', async () => {
    const id = await makeShift({ startOffsetHours: -12, endOffsetHours: -4 });

    const shift = await stateOf(id);
    expect(shift.attendance_state).toBe('missed');
    expect(shift.attendance_event_count).toBe(0);
  });

  it('says nothing about a shift that has not happened yet', async () => {
    const id = await makeShift({ startOffsetHours: 4, endOffsetHours: 12 });

    expect((await stateOf(id)).attendance_state).toBe('scheduled');
  });

  it('never marks a cancelled shift or a day off as missed', async () => {
    const cancelled = await makeShift({ startOffsetHours: -12, endOffsetHours: -4, cancelled: true });
    const off = await makeShift({ startOffsetHours: -12, endOffsetHours: -4, offDay: true });

    expect((await stateOf(cancelled)).attendance_state).toBe('cancelled');
    expect((await stateOf(off)).attendance_state).toBe('off');
  });

  it('claims events entered by hand, which carry no shift id', async () => {
    const id = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(null, 'checkin', -8.8);
    await addEvent(null, 'checkout', -1.2);

    const shift = await stateOf(id);
    expect(shift.attendance_state).toBe('completed');
    expect(shift.attendance_has_manual_event).toBe(true);
  });

  it('reports how late the clock-in was, and reads negative when early', async () => {
    const late = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(late, 'checkin', -8.5); // half an hour after the start
    expect((await stateOf(late)).attendance_checkin_delay_minutes).toBeGreaterThanOrEqual(29);

    await testPool.query(`DELETE FROM attendance_events WHERE notes = $1`, [TAG]);

    const early = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(early, 'checkin', -9.2);
    expect((await stateOf(early)).attendance_checkin_delay_minutes).toBeLessThan(0);
  });

  it('carries the break times through for the timeline', async () => {
    const id = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await addEvent(id, 'checkin', -8.9);
    await addEvent(id, 'break_start', -5);
    await addEvent(id, 'break_end', -4);
    await addEvent(id, 'checkout', -1.1);

    const shift = await stateOf(id);
    expect(shift.attendance_break_start_at).toBeTruthy();
    expect(shift.attendance_break_end_at).toBeTruthy();
    expect(shift.attendance_event_count).toBe(4);
  });

  it("does not borrow another employee's clock-in", async () => {
    const id = await makeShift({ startOffsetHours: -9, endOffsetHours: -1 });
    await testPool.query(
      `INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes)
       VALUES ($1, $2, $3, 'checkin', NOW() - INTERVAL '8 hours', 'qr', NULL, $4)`,
      [seeds.acmeId, seeds.romaStoreId, seeds.hrId, TAG],
    );

    expect((await stateOf(id)).attendance_state).toBe('missed');
  });
});
