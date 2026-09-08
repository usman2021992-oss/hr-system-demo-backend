import { query } from '../config/database';
import { generateReport } from '../modules/reports/reports-generation.service';
import { getCurrentReportClock, getLastScheduledRunDate, shouldRunReportAtCurrentTime } from '../modules/reports/reports-schedule';
import { saveGeneratedReportPdf, deleteGeneratedReportPdf } from '../modules/reports/reports-storage.service';
import { getReportDefinition } from '../modules/reports/reports-registry';

interface ActiveReportConfig {
  company_id: number;
  report_id: string;
  day: number;
  time: string;
  recipients: string[] | string;
  sections: string[] | string;
  thresholds: Record<string, number> | string;
  max_pages: number;
  max_rows_per_section: number;
  owner_user_id: number | null;
  store_id: number | null;
}

/**
 * Trims the archive for one (company, report) pair down to its retention_count,
 * oldest first. Runs after each successful archive write so the PDF directory
 * cannot grow without bound. Deleted PDFs remain regenerable from target_date.
 */
async function enforceRetention(companyId: number, reportId: string, ownerUserId: number | null): Promise<void> {
  try {
    const config = await query<{ retention_count: number }>(
      `SELECT retention_count FROM report_configurations
        WHERE company_id = $1 AND report_id = $2
          AND COALESCE(owner_user_id, 0) = COALESCE($3::int, 0)`,
      [companyId, reportId, ownerUserId],
    );
    const keep = config[0]?.retention_count ?? 24;
    if (keep < 1) return;

    const surplus = await query<{ id: number; storage_path: string | null }>(
      `SELECT id, storage_path FROM generated_reports
        WHERE company_id = $1 AND report_id = $2
          AND COALESCE(owner_user_id, 0) = COALESCE($3::int, 0)
        ORDER BY generated_at DESC
        OFFSET $4`,
      [companyId, reportId, ownerUserId, keep],
    );

    for (const row of surplus) {
      if (!(await deleteGeneratedReportPdf(row.storage_path))) continue;
      await query(`DELETE FROM generated_reports WHERE id = $1`, [row.id]);
    }

    if (surplus.length > 0) {
      console.log(`[REPORTS-JOB] Retention purged ${surplus.length} archived report(s) for company ${companyId}/${reportId}.`);
    }
  } catch (err) {
    // Retention is housekeeping; never let it fail the generation that just succeeded.
    console.error(`[REPORTS-JOB] Retention purge failed for company ${companyId}/${reportId}:`, err);
  }
}

/**
 * Periodically called (every minute) to check and run report configs matching current schedule.
 */
export async function runReportConfigurationsJob(): Promise<void> {
  try {
    const now = new Date();
    const currentClock = getCurrentReportClock(now);
    const currentHHMM = currentClock.time;

    console.log(`[REPORTS-JOB] Tick - Time: ${currentHHMM}`);

    // Query active reports matching this exact minute, then apply per-report schedule rules in code.
    const pendingConfigs = await query<ActiveReportConfig>(
      `SELECT company_id, report_id, day, time, recipients, sections,
              thresholds, max_pages, max_rows_per_section, owner_user_id, store_id
       FROM report_configurations
       WHERE status = 'attivo'
         AND time = $1`,
      [currentHHMM]
    );

    const configs = pendingConfigs.filter((conf) => {
      // Legacy rows can reference report ids that no longer exist in the registry
      // (e.g. 'monthly-attendance'). Generating those would produce an untitled,
      // unscoped PDF, so skip them rather than guess.
      if (!getReportDefinition(conf.report_id)) {
        console.warn(`[REPORTS-JOB] Skipping unknown report id "${conf.report_id}" (company ${conf.company_id}).`);
        return false;
      }
      return shouldRunReportAtCurrentTime(conf.report_id, conf.day, now);
    });

    if (configs.length === 0) return;

    console.log(`[REPORTS-JOB] Found ${configs.length} scheduled report(s) matching current time.`);

    for (const conf of configs) {
      const scheduledRunDate = getLastScheduledRunDate(conf.report_id, conf.day, conf.time, now);
      let parsedRecipients: string[] = [];
      let parsedSections: string[] = [];

      try {
        parsedRecipients = typeof conf.recipients === 'string' ? JSON.parse(conf.recipients) : conf.recipients;
      } catch {
        parsedRecipients = [];
      }

      try {
        parsedSections = typeof conf.sections === 'string' ? JSON.parse(conf.sections) : conf.sections;
      } catch {
        parsedSections = [];
      }

      generateReport(conf.company_id, {
        recipients: parsedRecipients,
        sections: parsedSections,
        reportId: conf.report_id,
        storeId: conf.store_id,
        thresholds: typeof conf.thresholds === 'string' ? JSON.parse(conf.thresholds) : conf.thresholds,
        maxPages: conf.max_pages,
        maxRowsPerSection: conf.max_rows_per_section,
      }, scheduledRunDate)
        .then(async (pdfBuffer: Buffer | null) => {
          if (pdfBuffer) {
            const storagePath = await saveGeneratedReportPdf(
              conf.company_id,
              conf.report_id,
              scheduledRunDate,
              pdfBuffer,
            );

            // Keyed on the owner, not just the company: two HR users can each own a
            // hr_weekly row, and only the one that just ran should have its count bumped.
            await query(
              `UPDATE report_configurations
                  SET run_count = run_count + 1,
                      last_generated = CURRENT_TIMESTAMP
                WHERE company_id = $1 AND report_id = $2
                  AND COALESCE(owner_user_id, 0) = COALESCE($3::int, 0)`,
              [conf.company_id, conf.report_id, conf.owner_user_id]
            );

            await query(
              `INSERT INTO generated_reports
                 (company_id, report_id, size_bytes, sections, target_date, storage_path, owner_user_id, store_id)
               VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
              [conf.company_id, conf.report_id, pdfBuffer.length, JSON.stringify(parsedSections),
               scheduledRunDate, storagePath, conf.owner_user_id, conf.store_id]
            );

            await enforceRetention(conf.company_id, conf.report_id, conf.owner_user_id);

            console.log(`[REPORTS-JOB] Archived ${conf.report_id} for company ${conf.company_id} owner ${conf.owner_user_id ?? 'company-wide'}`);
          } else {
            console.log(`[REPORTS-JOB] Generation returned null buffer for company: ${conf.company_id}`);
          }
        })
        .catch((err: unknown) => {
          console.error(`[REPORTS-JOB] Failed processing report for company ${conf.company_id}:`, err);
        });
    }
  } catch (error) {
    console.error('[REPORTS-JOB] Unexpected scheduler error:', error);
  }
}
