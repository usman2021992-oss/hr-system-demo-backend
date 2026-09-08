import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { signQrToken } from '../config/jwt';
import { queryOne } from '../config/database';

// GET /api/qr/generate?shift_id=123
// Generates a fresh, short-lived signed QR token for a specific shift.
// The token embeds shift_id + company_id + expiry — prevents screenshot reuse.
export async function generateQr(req: Request, res: Response) {
  const companyId = req.user!.companyId;
  const shiftId = req.query.shift_id ? parseInt(req.query.shift_id as string, 10) : null;

  if (!shiftId) {
    res.status(400).json({ error: 'shift_id is required. Example: /api/qr/generate?shift_id=1' });
    return;
  }

  const isEmployee = req.user!.role === 'employee';

  // Employees may only generate a token for a shift assigned to them
  const shiftQuery = isEmployee
    ? `SELECT id,
              TO_CHAR(date, 'YYYY-MM-DD')    AS date,
              TO_CHAR(start_time, 'HH24:MI') AS start_time,
              TO_CHAR(end_time,   'HH24:MI') AS end_time
       FROM shifts WHERE id = $1 AND company_id = $2 AND employee_id = $3`
    : `SELECT id,
              TO_CHAR(date, 'YYYY-MM-DD')    AS date,
              TO_CHAR(start_time, 'HH24:MI') AS start_time,
              TO_CHAR(end_time,   'HH24:MI') AS end_time
       FROM shifts WHERE id = $1 AND company_id = $2`;

  const shiftParams = isEmployee
    ? [shiftId, companyId, req.user!.userId]
    : [shiftId, companyId];

  const shift = await queryOne(shiftQuery, shiftParams);
  if (!shift) {
    res.status(isEmployee ? 403 : 404).json({
      error: isEmployee
        ? 'You are not assigned to this shift'
        : 'Shift not found in your company',
    });
    return;
  }

  const ttl = parseInt(process.env.QR_TOKEN_TTL || '60', 10);

  // Sign token: { companyId, shiftId, iat, exp }
  const qrToken = signQrToken(companyId!, shiftId);

  // QR payload — the employee's app will read this JSON when scanning
  const payload = JSON.stringify({ qrToken });

  const qrDataUrl = await QRCode.toDataURL(payload, { width: 300, margin: 2 });

  res.json({
    qrDataUrl,
    qrToken,
    shiftId,
    companyId,
    shift,
    expiresInSeconds: ttl,
    generatedAt: new Date().toISOString(),
  });
}
