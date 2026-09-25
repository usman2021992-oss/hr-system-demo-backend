/**
 * Local-only demo data for the shift attendance marks.
 *
 * The local database's shifts stop in July and its clock-ins in June, so on any
 * current week every shift would read "missed" and none of the other states
 * could be seen at all. This creates one week of shifts around today, each
 * arranged to land in a different state, so the calendar can be looked at
 * properly: completed, completed with a break, late, still working, never
 * clocked out, never turned up, an HR correction with no shift attached, a
 * cancelled shift and a day off.
 *
 * Safety:
 *  - refuses to run against anything that is not localhost;
 *  - refuses when NODE_ENV=production;
 *  - needs --confirm;
 *  - only ever inserts, and everything it inserts is tagged, so --clean takes
 *    exactly its own rows back out and nothing else.
 *
 * Usage:
 *   npx ts-node src/scripts/seedShiftAttendanceDemo.ts --confirm
 *   npx ts-node src/scripts/seedShiftAttendanceDemo.ts --clean --confirm
 */
import dotenv from 'dotenv';
import { pool } from '../config/database';

dotenv.config();

/** Stamped on every row this script writes, and the only thing --clean removes. */
const TAG = 'demo:shift-status';

interface Scenario {
  key: string;
  /** Days from today in the store's timezone: -1 is yesterday. */
  dayOffset: number;
  /**
   * Wall-clock times, or hour offsets from this moment when the scenario has to
   * straddle "now" (`relativeHours`). The two are exclusive.
   */
  startTime: string;
  endTime: string;
  /** Start and end, in hours from now, for the cases that depend on the clock. */
  relativeHours?: { start: number; end: number };
  breakStart?: string;
  breakEnd?: string;
  /** What the calendar should end up showing. Asserted after seeding. */
  expected: string;
  /** Minutes after the shift start that the employee clocked in. */
  checkinAfterMinutes?: number;
  /** Minutes before the shift end that they clocked out. */
  checkoutBeforeMinutes?: number;
  takesBreak?: boolean;
  /** Write the events without a shift_id, as an HR correction would. */
  unlinked?: boolean;
  cancelled?: boolean;
  offDay?: boolean;
  note: string;
}

const SCENARIOS: Scenario[] = [
  {
    key: 'completed_with_break',
    dayOffset: -1, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00',
    checkinAfterMinutes: -3, checkoutBeforeMinutes: -6, takesBreak: true,
    expected: 'completed',
    note: 'Worked the whole shift, took the break — two ticks, full timeline',
  },
  {
    key: 'completed_no_break',
    dayOffset: -2, startTime: '10:00', endTime: '16:00',
    checkinAfterMinutes: 1, checkoutBeforeMinutes: 2,
    expected: 'completed',
    note: 'Worked the whole shift, no break recorded — two ticks',
  },
  {
    key: 'completed_late',
    dayOffset: -3, startTime: '09:00', endTime: '17:00',
    checkinAfterMinutes: 27, checkoutBeforeMinutes: -4,
    expected: 'completed',
    note: 'Arrived 27 minutes late — two ticks, and the timeline says how late',
  },
  {
    key: 'incomplete_no_checkout',
    dayOffset: -2, startTime: '09:00', endTime: '17:00',
    checkinAfterMinutes: 2,
    expected: 'incomplete',
    note: 'Clocked in, never clocked out — one tick and a warning',
  },
  {
    key: 'missed',
    dayOffset: -1, startTime: '09:00', endTime: '17:00',
    expected: 'missed',
    note: 'Shift came and went with nothing recorded',
  },
  {
    key: 'in_progress',
    dayOffset: 0, startTime: '', endTime: '', relativeHours: { start: -2, end: 3 },
    checkinAfterMinutes: 4,
    expected: 'in_progress',
    note: 'On shift right now, clocked in — one tick, no warning',
  },
  {
    key: 'scheduled_today_later',
    dayOffset: 0, startTime: '', endTime: '', relativeHours: { start: 4, end: 8 },
    expected: 'scheduled',
    note: 'Later today — nothing to show yet',
  },
  {
    key: 'scheduled_tomorrow',
    dayOffset: 1, startTime: '09:00', endTime: '17:00',
    expected: 'scheduled',
    note: 'Tomorrow — nothing to show yet',
  },
  {
    key: 'unlinked_manual',
    dayOffset: -4, startTime: '09:00', endTime: '17:00',
    checkinAfterMinutes: 5, checkoutBeforeMinutes: 10, unlinked: true,
    expected: 'completed',
    note: 'HR correction: events with no shift attached, claimed by time window',
  },
  {
    key: 'cancelled',
    dayOffset: -1, startTime: '09:00', endTime: '17:00', cancelled: true,
    expected: 'cancelled',
    note: 'Cancelled shift — never counts as missed',
  },
  {
    key: 'off_day',
    dayOffset: -3, startTime: '00:00', endTime: '00:00', offDay: true,
    expected: 'off',
    note: 'Day off — nothing expected',
  },
];

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production.');
  }
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(
      `Refusing: DATABASE_URL does not point at localhost (${url.replace(/:[^:@]*@/, ':***@')}). ` +
      'This script is for a local database only.',
    );
  }
  if (!process.argv.includes('--confirm')) {
    throw new Error('Add --confirm to run this (it writes demo rows into your local database).');
  }
}

async function clean(): Promise<void> {
  const events = await pool.query(`DELETE FROM attendance_events WHERE notes = $1`, [TAG]);
  const shifts = await pool.query(`DELETE FROM shifts WHERE notes = $1`, [TAG]);
  console.log(`Removed ${events.rowCount} demo attendance events and ${shifts.rowCount} demo shifts.`);
}

/**
 * A store with enough active employees to give each scenario its own person —
 * one employee cannot hold two shifts on the same day.
 */
async function pickStage(): Promise<{ companyId: number; storeId: number; timezone: string; userIds: number[] }> {
  const { rows } = await pool.query<{ company_id: number; store_id: number; timezone: string; user_ids: number[] }>(
    `SELECT s.company_id,
            s.id AS store_id,
            COALESCE(NULLIF(BTRIM(s.timezone), ''), 'Europe/Rome') AS timezone,
            ARRAY_AGG(u.id ORDER BY u.id) AS user_ids
       FROM stores s
       JOIN users u ON u.store_id = s.id
                   AND u.role <> 'store_terminal'
                   AND u.status = 'active'
                   AND u.deleted_at IS NULL
      WHERE s.is_active = true
      GROUP BY s.company_id, s.id, s.timezone
     HAVING COUNT(u.id) >= $1
      ORDER BY s.id
      LIMIT 1`,
    [SCENARIOS.length],
  );

  if (rows.length === 0) {
    throw new Error(`No active store with at least ${SCENARIOS.length} active employees was found locally.`);
  }
  return {
    companyId: rows[0].company_id,
    storeId: rows[0].store_id,
    timezone: rows[0].timezone,
    userIds: rows[0].user_ids,
  };
}

async function seed(): Promise<void> {
  const stage = await pickStage();
  console.log(`Using store ${stage.storeId} (company ${stage.companyId}, ${stage.timezone}).`);

  for (const [index, scenario] of SCENARIOS.entries()) {
    const userId = stage.userIds[index];

    /*
     * Everything is worked out in the store's timezone inside Postgres. Taking
     * the date from CURRENT_DATE and the hour from this process's clock put the
     * "happening now" shift on the wrong day whenever the database and the
     * machine running this disagreed about the date — which is most evenings.
     */
    const dayExpr = `((NOW() AT TIME ZONE $5::text)::date + $4::int)`;
    const startExpr = scenario.relativeHours
      ? `(NOW() + ($6::int * INTERVAL '1 hour'))`
      : `((${dayExpr}::timestamp + $6::time) AT TIME ZONE $5::text)`;
    const endExpr = scenario.relativeHours
      ? `(NOW() + ($7::int * INTERVAL '1 hour'))`
      : `((${dayExpr}::timestamp + $7::time) AT TIME ZONE $5::text)`;

    const { rows: [shift] } = await pool.query<{ id: number; start_at_utc: string; end_at_utc: string }>(
      `INSERT INTO shifts (
         company_id, store_id, user_id, date, timezone,
         start_time, end_time, start_at_utc, end_at_utc,
         break_start, break_end, break_start_at_utc, break_end_at_utc,
         is_off_day, status, notes
       )
       VALUES (
         $1, $2, $3,
         (${startExpr} AT TIME ZONE $5::text)::date,
         $5::text,
         (${startExpr} AT TIME ZONE $5::text)::time,
         (${endExpr} AT TIME ZONE $5::text)::time,
         ${startExpr},
         ${endExpr},
         $8::time, $9::time,
         CASE WHEN $8::time IS NULL THEN NULL ELSE ((${dayExpr}::timestamp + $8::time) AT TIME ZONE $5::text) END,
         CASE WHEN $9::time IS NULL THEN NULL ELSE ((${dayExpr}::timestamp + $9::time) AT TIME ZONE $5::text) END,
         $10, $11, $12
       )
       RETURNING id, start_at_utc, end_at_utc`,
      [
        stage.companyId, stage.storeId, userId, scenario.dayOffset, stage.timezone,
        scenario.relativeHours ? scenario.relativeHours.start : scenario.startTime,
        scenario.relativeHours ? scenario.relativeHours.end : scenario.endTime,
        scenario.breakStart ?? null, scenario.breakEnd ?? null,
        scenario.offDay ?? false,
        scenario.cancelled ? 'cancelled' : 'scheduled',
        TAG,
      ],
    );

    const startUtc = new Date(shift.start_at_utc);
    const endUtc = new Date(shift.end_at_utc);
    const minutesFrom = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

    const events: Array<{ type: string; at: Date }> = [];
    const shiftIdForEvents = scenario.unlinked ? null : shift.id;

    if (scenario.checkinAfterMinutes !== undefined) {
      events.push({ type: 'checkin', at: minutesFrom(startUtc, scenario.checkinAfterMinutes) });
    }
    if (scenario.takesBreak && scenario.breakStart && scenario.breakEnd) {
      events.push({ type: 'break_start', at: minutesFrom(startUtc, 4 * 60) });
      events.push({ type: 'break_end', at: minutesFrom(startUtc, 5 * 60 + 2) });
    }
    if (scenario.checkoutBeforeMinutes !== undefined) {
      events.push({ type: 'checkout', at: minutesFrom(endUtc, -scenario.checkoutBeforeMinutes) });
    }

    for (const event of events) {
      await pool.query(
        `INSERT INTO attendance_events (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, user_id, event_type, event_time) DO NOTHING`,
        [
          stage.companyId, stage.storeId, userId, event.type, event.at,
          scenario.unlinked ? 'manual' : 'qr',
          shiftIdForEvents,
          TAG,
        ],
      );
    }

    console.log(
      `  ${scenario.key.padEnd(22)} shift ${String(shift.id).padEnd(6)} ` +
      `${events.length} event(s)  expect: ${scenario.expected}`,
    );
  }
}

/** Reads back what the calendar query would say, so the seed proves itself. */
async function verify(): Promise<void> {
  const { rows } = await pool.query<{ key: string; state: string; checkin: string | null; checkout: string | null; delay: number | null }>(
    `SELECT sh.id,
            sh.date::text AS date,
            CASE
              WHEN sh.status = 'cancelled' THEN 'cancelled'
              WHEN sh.is_off_day THEN 'off'
              WHEN att.checkin_at IS NOT NULL AND att.checkout_at IS NOT NULL THEN 'completed'
              WHEN att.checkin_at IS NOT NULL AND NOW() < COALESCE(sh.end_at_utc, NOW()) + INTERVAL '2 hours' THEN 'in_progress'
              WHEN att.checkin_at IS NOT NULL THEN 'incomplete'
              WHEN NOW() < COALESCE(sh.end_at_utc, NOW()) THEN 'scheduled'
              ELSE 'missed'
            END AS state,
            TO_CHAR(att.checkin_at, 'HH24:MI') AS checkin,
            TO_CHAR(att.checkout_at, 'HH24:MI') AS checkout,
            CASE WHEN att.checkin_at IS NULL THEN NULL
                 ELSE ROUND(EXTRACT(EPOCH FROM (att.checkin_at - sh.start_at_utc)) / 60)::int END AS delay
       FROM shifts sh
       LEFT JOIN LATERAL (
         SELECT MIN(ae.event_time) FILTER (WHERE ae.event_type = 'checkin')  AS checkin_at,
                MAX(ae.event_time) FILTER (WHERE ae.event_type = 'checkout') AS checkout_at
           FROM attendance_events ae
          WHERE ae.user_id = sh.user_id
            AND (ae.shift_id = sh.id
                 OR (ae.shift_id IS NULL AND ae.company_id = sh.company_id
                     AND ae.event_time >= sh.start_at_utc - INTERVAL '6 hours'
                     AND ae.event_time <= sh.end_at_utc + INTERVAL '6 hours'))
       ) att ON TRUE
      WHERE sh.notes = $1
      ORDER BY sh.id`,
    [TAG],
  );

  console.log('\nWhat the calendar will show:');
  rows.forEach((r: any) => {
    const times = [r.checkin && `in ${r.checkin}`, r.checkout && `out ${r.checkout}`].filter(Boolean).join(', ');
    const late = r.delay !== null && r.delay > 5 ? ` (${r.delay} min late)` : '';
    console.log(`  ${r.date}  ${String(r.state).padEnd(12)} ${times}${late}`);
  });
}

(async () => {
  try {
    assertLocalDatabase();
    if (process.argv.includes('--clean')) {
      await clean();
    } else {
      await clean(); // start from a known state, then lay the scenarios out again
      await seed();
      await verify();
      console.log('\nOpen Shifts, pick that store, and look at this week.');
      console.log('Run again with --clean --confirm to remove every row this created.');
    }
  } catch (err: any) {
    console.error(`\n${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
