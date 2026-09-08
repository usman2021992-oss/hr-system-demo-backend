import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query, queryOne } from '../../config/database';
import { ok, badRequest, notFound, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

const UPLOAD_DIR =
  process.env.STORE_LOGOS_DIR || path.join(process.cwd(), 'uploads', 'store-logos');

function cleanupUploadedFile(req: Request): void {
  if (req.file?.path) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      // ignore cleanup errors
    }
  }
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const storeId = req.params.id;
    const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
    cb(null, `store-${storeId}${ext}`);
  },
});

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

export const storeLogoUploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  multerInstance(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 8MB', 'STORE_LOGO_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa JPG, PNG o WebP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

async function resolveScopedStore(req: Request, storeId: number): Promise<{ id: number; company_id: number; logo_filename: string | null } | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const store = await queryOne<{ id: number; company_id: number; logo_filename: string | null }>(
    `SELECT id, company_id, logo_filename
     FROM stores
     WHERE id = $1 AND company_id = ANY($2)`,
    [storeId, allowedCompanyIds],
  );

  if (!store) return null;

  if (req.user?.role === 'store_manager' && req.user.storeId !== storeId) {
    return null;
  }

  return store;
}

export const uploadStoreLogo = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.id, 10);
  if (isNaN(storeId)) {
    cleanupUploadedFile(req);
    notFound(res, 'Negozio non trovato');
    return;
  }

  const store = await resolveScopedStore(req, storeId);
  if (!store) {
    cleanupUploadedFile(req);
    forbidden(res, 'Accesso negato a questo negozio');
    return;
  }

  if (!req.file) {
    badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
    return;
  }

  const filename = req.file.filename;
  if (store.logo_filename && store.logo_filename !== filename) {
    const oldPath = path.join(UPLOAD_DIR, store.logo_filename);
    try {
      fs.unlinkSync(oldPath);
    } catch {
      // ignore cleanup errors
    }
  }

  await query(
    `UPDATE stores
     SET logo_filename = $1
     WHERE id = $2`,
    [filename, storeId],
  );

  ok(res, { logoUrl: `/uploads/store-logos/${filename}` }, 'Logo negozio aggiornato');
});

export const deleteStoreLogo = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.id, 10);
  if (isNaN(storeId)) {
    notFound(res, 'Negozio non trovato');
    return;
  }

  const store = await resolveScopedStore(req, storeId);
  if (!store) {
    forbidden(res, 'Accesso negato a questo negozio');
    return;
  }

  if (store.logo_filename) {
    const filePath = path.join(UPLOAD_DIR, store.logo_filename);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }

  await query(
    `UPDATE stores
     SET logo_filename = NULL
     WHERE id = $1`,
    [storeId],
  );

  ok(res, null, 'Logo negozio rimosso');
});
