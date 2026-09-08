import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { badRequest } from '../../utils/response';

const ALLOWED_RESUME_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const INTERNAL_CV_DIR = process.env.PUBLIC_CV_UPLOAD_DIR
  ?? path.join(process.cwd(), 'uploads', 'public-cv');

fs.mkdirSync(INTERNAL_CV_DIR, { recursive: true });

function pickResumeExtension(originalName: string, mimeType: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx') {
    return ext;
  }
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'application/msword') return '.doc';
  return '.docx';
}

const internalResumeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INTERNAL_CV_DIR),
  filename: (req, file, cb) => {
    const userId = (req as Request & { user?: { userId?: number } }).user?.userId ?? 'x';
    const ext = pickResumeExtension(file.originalname, file.mimetype);
    const random = Math.random().toString(36).slice(2, 10);
    cb(null, `ats-internal-${userId}-${Date.now()}-${random}${ext}`);
  },
});

const internalResumeUpload = multer({
  storage: internalResumeStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_RESUME_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_FILE_TYPE'));
  },
}).single('resume');

function cleanupUploadedResume(req: Request): void {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) return;
  try {
    fs.unlinkSync(file.path);
  } catch {
    // ignore
  }
}

function handleMulterError(res: Response, err: unknown, next: NextFunction): void {
  const multerError = err as { code?: string; message?: string };
  if (multerError.code === 'LIMIT_FILE_SIZE') {
    badRequest(res, 'Il file supera il limite di 5MB', 'FILE_TOO_LARGE');
    return;
  }
  if (multerError.message === 'INVALID_FILE_TYPE') {
    badRequest(res, 'Formato CV non supportato. Usa PDF, DOC o DOCX', 'INVALID_FILE_TYPE');
    return;
  }
  next(err as Error);
}

/** Use before createCandidate when clients may send multipart/form-data with optional `resume` file. */
export function optionalInternalResumeUpload(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }
  internalResumeUpload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    cleanupUploadedResume(req);
    handleMulterError(res, err, next);
  });
}
