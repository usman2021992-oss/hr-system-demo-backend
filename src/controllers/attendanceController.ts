import { Request, Response } from 'express';
import { query, queryOne } from '../config/database';
import { verifyQrToken } from '../config/jwt';

interface CheckinBody {
  qrToken: string;
}

// POST /api/attendance/checkin
// Employee submits the QR token. Server validates it and records check-in or check-out.
export async function checkin(req: Request, res: Response) {
  const { qrToken } = req.body as CheckinBody;
  const employeeId = req.user!.userId;
  const userCompanyId = req.user!.companyId;

  if (!qrToken) {
    res.status(400).json({ error: 'qrToken is required' });
    return;
  }

  // 1. Validate QR token signature + expiry
  let qrPayload: { companyId: number; shiftId: number };
  try {
    qrPayload = verifyQrToken(qrToken);
  } catch {
    res.status(400).json({
      error: 'QR code is invalid or expired. Please scan the current code.',
    });
    return;
  }

  // 2. Company must match the employee's company
  if (qrPayload.companyId !== userCompanyId) {
    res.status(403).json({ error: 'QR code does not belong to your company' });
    return;
  }

  const shiftId = qrPayload.shiftId;

  // 3. Employee must be assigned to this shift
  const shift = await queryOne(
    `SELECT id, date, start_time, end_time FROM shifts
     WHERE id = $1 AND employee_id = $2 AND company_id = $3`,
    [shiftId, employeeId, userCompanyId]
  );
  if (!shift) {
    res.status(403).json({
      error: 'You are not assigned to the shift this QR code represents',
    });
    return;
  }

  // 4. Check for open record today (check-in without check-out)
  const openRecord = await queryOne(
    `SELECT id, check_in_time FROM attendance
     WHERE employee_id = $1 AND shift_id = $2 AND check_out_time IS NULL`,
    [employeeId, shiftId]
  );

  if (openRecord) {
    // Already checked in — this scan is a check-OUT
    const [updated] = await query(
      `UPDATE attendance
       SET check_out_time = NOW(), qr_token_used = $1
       WHERE id = $2
       RETURNING *`,
      [qrToken, openRecord.id]
    );
    res.json({ action: 'check_out', record: updated });
  } else {
    // New check-IN
    const [created] = await query(
      `INSERT INTO attendance (company_id, employee_id, shift_id, check_in_time, qr_token_used)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING *`,
      [userCompanyId, employeeId, shiftId, qrToken]
    );
    res.status(201).json({ action: 'check_in', record: created });
  }
}

// POST /api/attendance/sync  — offline records stored in localStorage
export async function syncOfflineAttendance(req: Request, res: Response) {
  const records: CheckinBody[] = req.body.records;
  const employeeId = req.user!.userId;
  const userCompanyId = req.user!.companyId;

  if (!Array.isArray(records) || !records.length) {
    res.status(400).json({ error: 'records array is required' });
    return;
  }

  const results: any[] = [];

  for (const record of records) {
    try {
      const qrPayload = verifyQrToken(record.qrToken);
      if (qrPayload.companyId !== userCompanyId) {
        results.push({ status: 'failed', reason: 'company mismatch', record });
        continue;
      }
      const [created] = await query(
        `INSERT INTO attendance (company_id, employee_id, shift_id, check_in_time, qr_token_used, synced_at)
         VALUES ($1, $2, $3, NOW(), $4, NOW())
         RETURNING *`,
        [userCompanyId, employeeId, qrPayload.shiftId, record.qrToken]
      );
      results.push({ status: 'synced', record: created });
    } catch {
      results.push({ status: 'failed', reason: 'invalid or expired token', record });
    }
  }

  res.json({ synced: results.filter((r) => r.status === 'synced').length, results });
}

// GET /api/attendance
export async function listAttendance(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { employee_id, date_from, date_to } = req.query;

  let sql = `
    SELECT a.id, a.employee_id, u.name AS employee_name,
           a.shift_id, a.check_in_time, a.check_out_time,
           a.status, a.company_id, a.created_at,
           TO_CHAR(s.date, 'YYYY-MM-DD')      AS shift_date,
           TO_CHAR(s.start_time, 'HH24:MI')   AS shift_start,
           TO_CHAR(s.end_time,   'HH24:MI')   AS shift_end
    FROM attendance a
    JOIN users u ON u.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.company_id = $1
  `;
  const params: any[] = [companyId];

  if (req.user!.role === 'employee') {
    params.push(req.user!.userId);
    sql += ` AND a.employee_id = $${params.length}`;
  } else if (employee_id) {
    params.push(employee_id);
    sql += ` AND a.employee_id = $${params.length}`;
  }

  if (date_from) {
    params.push(date_from);
    sql += ` AND DATE(a.check_in_time) >= $${params.length}`;
  }
  if (date_to) {
    params.push(date_to);
    sql += ` AND DATE(a.check_in_time) <= $${params.length}`;
  }

  sql += ' ORDER BY a.check_in_time DESC';

  const records = await query(sql, params);
  res.json(records);
}
