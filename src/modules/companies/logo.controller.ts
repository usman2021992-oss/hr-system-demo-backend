import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query, queryOne } from '../../config/database';
import { ok, badRequest, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

const UPLOAD_DIR =
  process.env.COMPANY_LOGOS_DIR || path.join(process.cwd(), 'uploads', 'company-logos');
const BANNER_UPLOAD_DIR =
  process.env.COMPANY_BANNERS_DIR || path.join(process.cwd(), 'uploads', 'company-banners');

function cleanupUploadedFile(req: Request): void {
  if (req.file?.path) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const companyId = req.params.id;
    const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
    cb(null, `company-${companyId}${ext}`);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const multerInstance = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
}).single('logo');

const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BANNER_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const companyId = req.params.id;
    const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
    cb(null, `company-banner-${companyId}${ext}`);
  },
});

const bannerMulterInstance = multer({
  storage: bannerStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
}).single('banner');

export const companyLogoUploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  multerInstance(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 8MB', 'COMPANY_LOGO_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa JPG, PNG o WebP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

export const companyBannerUploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  bannerMulterInstance(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 12MB', 'COMPANY_BANNER_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa JPG, PNG o WebP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

export const uploadCompanyLogo = asyncHandler(async (req: Request, res: Response) => {
  const companyId = parseInt(req.params.id, 10);
  if (isNaN(companyId)) { cleanupUploadedFile(req); notFound(res, 'Azienda non trovata'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(companyId)) {
    cleanupUploadedFile(req);
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await queryOne<{ id: number; logo_filename: string | null }>(
    `SELECT id, logo_filename FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!company) { cleanupUploadedFile(req); notFound(res, 'Azienda non trovata'); return; }

  if (!req.file) {
    badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
    return;
  }

  const filename = req.file.filename;

  if (company.logo_filename && company.logo_filename !== filename) {
    const oldPath = path.join(UPLOAD_DIR, company.logo_filename);
    try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
  }

  await query(
    `UPDATE companies SET logo_filename = $1 WHERE id = $2`,
    [filename, companyId],
  );

  ok(res, { logoUrl: `/uploads/company-logos/${filename}` }, 'Logo aziendale aggiornato');
});

export const deleteCompanyLogo = asyncHandler(async (req: Request, res: Response) => {
  const companyId = parseInt(req.params.id, 10);
  if (isNaN(companyId)) { notFound(res, 'Azienda non trovata'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(companyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await queryOne<{ id: number; logo_filename: string | null }>(
    `SELECT id, logo_filename FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!company) { notFound(res, 'Azienda non trovata'); return; }

  if (company.logo_filename) {
    const filePath = path.join(UPLOAD_DIR, company.logo_filename);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  await query(
    `UPDATE companies SET logo_filename = NULL WHERE id = $1`,
    [companyId],
  );

  ok(res, null, 'Logo aziendale rimosso');
});

export const uploadCompanyBanner = asyncHandler(async (req: Request, res: Response) => {
  const companyId = parseInt(req.params.id, 10);
  if (isNaN(companyId)) { cleanupUploadedFile(req); notFound(res, 'Azienda non trovata'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(companyId)) {
    cleanupUploadedFile(req);
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await queryOne<{ id: number; banner_filename: string | null }>(
    `SELECT id, banner_filename FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!company) { cleanupUploadedFile(req); notFound(res, 'Azienda non trovata'); return; }

  if (!req.file) {
    badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
    return;
  }

  const filename = req.file.filename;

  if (company.banner_filename && company.banner_filename !== filename) {
    const oldPath = path.join(BANNER_UPLOAD_DIR, company.banner_filename);
    try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
  }

  await query(
    `UPDATE companies SET banner_filename = $1 WHERE id = $2`,
    [filename, companyId],
  );

  ok(res, { bannerUrl: `/uploads/company-banners/${filename}` }, 'Banner aziendale aggiornato');
});

export const deleteCompanyBanner = asyncHandler(async (req: Request, res: Response) => {
  const companyId = parseInt(req.params.id, 10);
  if (isNaN(companyId)) { notFound(res, 'Azienda non trovata'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(companyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await queryOne<{ id: number; banner_filename: string | null }>(
    `SELECT id, banner_filename FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!company) { notFound(res, 'Azienda non trovata'); return; }

  if (company.banner_filename) {
    const filePath = path.join(BANNER_UPLOAD_DIR, company.banner_filename);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  await query(
    `UPDATE companies SET banner_filename = NULL WHERE id = $1`,
    [companyId],
  );

  ok(res, null, 'Banner aziendale rimosso');
});
