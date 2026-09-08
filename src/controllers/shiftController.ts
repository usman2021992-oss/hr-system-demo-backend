import { Request, Response } from 'express';
import { query, queryOne } from '../config/database';

export async function listShifts(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { week, employee_id } = req.query;

  let sql = `
    SELECT s.id,
           TO_CHAR(s.date, 'YYYY-MM-DD')     AS date,
           TO_CHAR(s.start_time, 'HH24:MI')  AS start_time,
           TO_CHAR(s.end_time,   'HH24:MI')  AS end_time,
           s.notes,
           s.employee_id, u.name AS employee_name,
           s.company_id, s.created_at
    FROM shifts s
    JOIN users u ON u.id = s.employee_id
    WHERE s.company_id = $1
  `;
  const params: any[] = [companyId];

  // If employee role, only see own shifts
  if (req.user!.role === 'employee') {
    params.push(req.user!.userId);
    sql += ` AND s.employee_id = $${params.length}`;
  } else if (employee_id) {
    params.push(employee_id);
    sql += ` AND s.employee_id = $${params.length}`;
  }

  // Filter by ISO week start date (e.g., ?week=2024-01-15)
  if (week) {
    const weekStart = new Date(week as string);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    params.push(weekStart.toISOString().split('T')[0]);
    params.push(weekEnd.toISOString().split('T')[0]);
    sql += ` AND s.date >= $${params.length - 1} AND s.date <= $${params.length}`;
  }

  sql += ' ORDER BY s.date ASC, s.start_time ASC';

  const shifts = await query(sql, params);
  res.json(shifts);
}

export async function createShift(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { employee_id, date, start_time, end_time, notes } = req.body;

  if (!employee_id || !date || !start_time || !end_time) {
    res.status(400).json({ error: 'employee_id, date, start_time, end_time are required' });
    return;
  }

  // Verify employee belongs to same company
  const employee = await queryOne(
    'SELECT id FROM users WHERE id = $1 AND company_id = $2',
    [employee_id, companyId]
  );
  if (!employee) {
    res.status(400).json({ error: 'Employee not found in your company' });
    return;
  }

  // Check for overlapping shifts for this employee
  const overlap = await queryOne(
    `SELECT id FROM shifts
     WHERE employee_id = $1 AND date = $2
     AND NOT (end_time <= $3 OR start_time >= $4)`,
    [employee_id, date, start_time, end_time]
  );
  if (overlap) {
    res.status(409).json({ error: 'Employee already has an overlapping shift on this date' });
    return;
  }

  const [shift] = await query(
    `INSERT INTO shifts (company_id, employee_id, date, start_time, end_time, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [companyId, employee_id, date, start_time, end_time, notes || null, req.user!.userId]
  );

  res.status(201).json(shift);
}

export async function updateShift(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { id } = req.params;
  const { employee_id, date, start_time, end_time, notes } = req.body;

  const existing = await queryOne(
    'SELECT id FROM shifts WHERE id = $1 AND company_id = $2',
    [id, companyId]
  );
  if (!existing) {
    res.status(404).json({ error: 'Shift not found' });
    return;
  }

  const [updated] = await query(
    `UPDATE shifts SET
       employee_id = COALESCE($1, employee_id),
       date = COALESCE($2, date),
       start_time = COALESCE($3, start_time),
       end_time = COALESCE($4, end_time),
       notes = COALESCE($5, notes),
       updated_at = NOW()
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [employee_id, date, start_time, end_time, notes, id, companyId]
  );

  res.json(updated);
}

export async function deleteShift(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const { id } = req.params;

  const result = await query(
    'DELETE FROM shifts WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId]
  );

  if (!result.length) {
    res.status(404).json({ error: 'Shift not found' });
    return;
  }

  res.json({ message: 'Shift deleted' });
}
