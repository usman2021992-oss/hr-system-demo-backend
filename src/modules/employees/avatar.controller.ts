import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query, queryOne } from '../../config/database';
import { ok, badRequest, forbidden, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

const UPLOAD_DIR =
  process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'avatars');

function cleanupUploadedFile(req: Request): void {
  if (req.file?.path) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }
}

// Ensure upload directory exists at startup
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const userId = req.params.id;
    const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
    cb(null, `${userId}${ext}`);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const multerInstance = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
}).single('avatar');

// Wraps multer in a regular middleware — handles multer errors inline
// so we can return proper JSON error responses instead of crashing.
export const uploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  multerInstance(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 2MB', 'FILE_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa JPG, PNG o WebP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

// POST /api/employees/:id/avatar
export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }

  // Access control: employee can only update own avatar
  if (role === 'employee' && userId !== empId) {
    cleanupUploadedFile(req);
    forbidden(res, 'Puoi aggiornare solo il tuo avatar');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  // Verify employee exists in one of the caller's allowed companies
  const emp = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = ANY($2)`,
    [empId, allowedCompanyIds],
  );
  if (!emp) { cleanupUploadedFile(req); notFound(res, 'Dipendente non trovato'); return; }

  if (!req.file) {
    badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
    return;
  }

  const filename = req.file.filename;

  await query(
    `UPDATE users SET avatar_filename = $1, updated_at = NOW() WHERE id = $2`,
    [filename, empId],
  );

  ok(res, { avatarUrl: `/uploads/avatars/${filename}` }, 'Avatar aggiornato');
});

// DELETE /api/employees/:id/avatar
export const deleteAvatar = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }

  if (role === 'employee' && userId !== empId) {
    forbidden(res, 'Puoi eliminare solo il tuo avatar');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const emp = await queryOne<{ id: number; avatar_filename: string | null }>(
    `SELECT id, avatar_filename FROM users WHERE id = $1 AND company_id = ANY($2)`,
    [empId, allowedCompanyIds],
  );
  if (!emp) { notFound(res, 'Dipendente non trovato'); return; }

  if (emp.avatar_filename) {
    const filePath = path.join(UPLOAD_DIR, emp.avatar_filename);
    try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }
  }

  await query(
    `UPDATE users SET avatar_filename = NULL, updated_at = NOW() WHERE id = $1`,
    [empId],
  );

  ok(res, null, 'Avatar rimosso');
});
