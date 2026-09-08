import { calculateAnomaliesForRange, sendAnomalyNotifications } from '../modules/attendance/attendance.controller';
import { query } from '../config/database';
import { coalescedShiftPointUtcSql } from '../utils/shiftTimezone';
import { sendNoShowAlertAutomation } from '../modules/automations/noShowAlert';

const SHIFT_START_UTC_SQL = coalescedShiftPointUtcSql('s.start_at_utc', 's.date', 's.start_time', 's.timezone');
const APPROVED_LEAVE_STATUSES = ['approved', 'admin_approved', 'admin approved', 'hr_approved'];

async function runNoShowAlertEmailJob(companyId: number): Promise<void> {
  const rows = await query<{
    shift_id: number;
    employee_name: string;
    employee_surname: string;
    employee_email: string | null;
    company_name: string;
    store_id: number | null;
    store_name: string | null;
    scheduled_checkin_time: string;
  }>(
    `SELECT
       s.id AS shift_id,
       u.name AS employee_name,
       u.surname AS employee_surname,
       u.email AS employee_email,
       c.name AS company_name,
       s.store_id,
       st.name AS store_name,
       s.start_time AS scheduled_checkin_time
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.id = s.company_id
     LEFT JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1
       AND u.status = 'active'
       AND u.role = 'employee'
       AND s.status != 'cancelled'
       AND NOW() >= ${SHIFT_START_UTC_SQL} + INTERVAL '30 minutes'
       AND NOW() < ${SHIFT_START_UTC_SQL} + INTERVAL '45 minutes'
       AND NOT EXISTS (
         SELECT 1
         FROM attendance_events ae
         WHERE ae.shift_id = s.id
           AND ae.company_id = s.company_id
           AND ae.user_id = s.user_id
           AND ae.event_type = 'checkin'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM leave_requests lr
         WHERE lr.company_id = s.company_id
           AND lr.user_id = s.user_id
           AND lr.status = ANY($2::text[])
           AND lr.start_date <= s.date
           AND lr.end_date >= s.date
       )`,
    [companyId, APPROVED_LEAVE_STATUSES],
  );

  for (const row of rows) {
    await sendNoShowAlertAutomation({
      companyId,
      shiftId: row.shift_id,
      employeeName: row.employee_name,
      employeeSurname: row.employee_surname,
      employeeEmail: row.employee_email,
      storeId: row.store_id,
      storeName: row.store_name,
      scheduledCheckinTime: row.scheduled_checkin_time,
    });
  }
}

export { runNoShowAlertEmailJob };

/**
 * Periodically scans today's shifts, calculates active anomalies, 
 * and triggers immediate manager/employee in-app alerts.
 * Runs every 5 minutes.
 */
export async function runAttendanceAnomalyCheckJob(companyId: number): Promise<void> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  try {
    // Calculate anomalies for this company for today
    const anomalies = await calculateAnomaliesForRange([companyId], todayStr, todayStr, {});

    if (anomalies.length > 0) {
      console.log(`[ATTENDANCE-ANOMALY-JOB] Detected ${anomalies.length} anomaly/anomalies for company ${companyId}`);
      await sendAnomalyNotifications(anomalies);
    }
  } catch (error) {
    console.error(`[ATTENDANCE-ANOMALY-JOB] Failed calculating/sending anomalies for company ${companyId}:`, error);
  }
}
