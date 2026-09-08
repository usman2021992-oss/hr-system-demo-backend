import fs from 'fs/promises';
import path from 'path';

function getUploadsRoot(): string {
  return process.env.UPLOADS_DIR
    ? path.dirname(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads');
}

function buildGeneratedReportFilename(companyId: number, reportId: string, targetDate: Date): string {
  const isoStamp = targetDate.toISOString().replace(/[:.]/g, '-');
  return `company-${companyId}-${reportId}-${isoStamp}.pdf`;
}

export async function saveGeneratedReportPdf(
  companyId: number,
  reportId: string,
  targetDate: Date,
  pdfBuffer: Buffer,
): Promise<string> {
  const reportsDir = path.join(getUploadsRoot(), 'generated-reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const filename = buildGeneratedReportFilename(companyId, reportId, targetDate);
  const absolutePath = path.join(reportsDir, filename);
  await fs.writeFile(absolutePath, pdfBuffer);

  return absolutePath;
}

export async function readGeneratedReportPdf(storagePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(storagePath);
  } catch {
    return null;
  }
}

/**
 * Removes an archived PDF from disk.
 *
 * Returns true when the file is gone afterwards — including when it was
 * already missing. storage_path holds an absolute path recorded at write
 * time, so a moved UPLOADS_DIR leaves rows pointing nowhere; that must not
 * block deleting the row itself.
 */
export async function deleteGeneratedReportPdf(storagePath: string | null): Promise<boolean> {
  if (!storagePath) return true;
  try {
    await fs.unlink(storagePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    console.error(`[REPORTS-STORAGE] Failed to unlink ${storagePath}:`, err);
    return false;
  }
}
