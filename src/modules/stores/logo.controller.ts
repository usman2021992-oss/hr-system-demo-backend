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

/**
 * Where banners are written must be where they are served from. index.ts serves
 * them from the parent of UPLOADS_DIR, so this default follows the same root
 * instead of assuming the working directory — otherwise a deployment that sets
 * UPLOADS_DIR would upload banners into a folder nothing ever reads.
 */
const UPLOADS_ROOT = process.env.UPLOADS_DIR
  ? path.dirname(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), 'uploads');
const BANNER_UPLOAD_DIR =
  process.env.STORE_BANNERS_DIR || path.join(UPLOADS_ROOT, 'store-banners');

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
fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * A new name for every upload, so a replaced image is never served from cache.
 * The serving routes read the store id from the leading "store-<id>" and accept
 * both this and the older fixed names, so images uploaded before this keep
 * working untouched.
 */
function versionedName(prefix: string, id: string, mimetype: string): string {
  const ext = MIME_TO_EXT[mimetype] ?? '.jpg';
  const numericId = parseInt(id, 10);
  return `${prefix}-${Number.isFinite(numericId) ? numericId : 'x'}-${Date.now()}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, versionedName('store', req.params.id, file.mimetype)),
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

const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BANNER_UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, versionedName('store-banner', req.params.id, file.mimetype)),
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

export const storeBannerUploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  bannerMulterInstance(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 12MB', 'STORE_BANNER_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa JPG, PNG o WebP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

interface ScopedStore {
  id: number;
  company_id: number;
  logo_filename: string | null;
  banner_filename: string | null;
}

async function resolveScopedStore(req: Request, storeId: number): Promise<ScopedStore | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const store = await queryOne<ScopedStore>(
    `SELECT id, company_id, logo_filename, banner_filename
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

/** Removes a file that is no longer referenced, best effort. */
function removeFile(dir: string, filename: string | null): void {
  if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) return;
  try {
    fs.unlinkSync(path.join(dir, filename));
  } catch {
    // already gone
  }
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

  await query(
    `UPDATE stores
     SET logo_filename = $1
     WHERE id = $2`,
    [filename, storeId],
  );

  if (store.logo_filename !== filename) removeFile(UPLOAD_DIR, store.logo_filename);

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

  removeFile(UPLOAD_DIR, store.logo_filename);

  await query(
    `UPDATE stores
     SET logo_filename = NULL
     WHERE id = $1`,
    [storeId],
  );

  ok(res, null, 'Logo negozio rimosso');
});

export const uploadStoreBanner = asyncHandler(async (req: Request, res: Response) => {
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

  await query(
    `UPDATE stores
     SET banner_filename = $1
     WHERE id = $2`,
    [filename, storeId],
  );

  if (store.banner_filename !== filename) removeFile(BANNER_UPLOAD_DIR, store.banner_filename);

  ok(res, { bannerUrl: `/uploads/store-banners/${filename}` }, 'Banner negozio aggiornato');
});

export const deleteStoreBanner = asyncHandler(async (req: Request, res: Response) => {
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

  removeFile(BANNER_UPLOAD_DIR, store.banner_filename);

  await query(
    `UPDATE stores
     SET banner_filename = NULL
     WHERE id = $1`,
    [storeId],
  );

  ok(res, null, 'Banner negozio rimosso');
});
