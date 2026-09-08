import { Request, Response } from 'express';
import { pool, query, queryOne } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, conflict, created, notFound, ok } from '../../utils/response';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';
import {
  ExternalAffluenceRecommendationRow,
  ExternalDbUnavailableError,
  ExternalIngressiDailyRow,
  buildAffluenceRecommendations,
  buildTrafficSummary,
  checkExternalConnection,
  fetchExternalTableDetails,
  fetchExternalTableSampleData,
  fetchDepositoByCode,
  fetchDepositiByStoreCodes,
  fetchDepositiRows,
  fetchIngressiDetailedRows,
  fetchIngressiAvailabilityByStoreCodes,
  fetchIngressiDaily,
  getExternalDbConfigStatus,
  getExternalTableCatalog,
  getVisitorsPerStaffSetting,
} from './externalAffluence.service';

interface MappingViewRow {
  id: number;
  companyId: number;
  companyName: string;
  externalCompanyName?: string | null;
  localStoreId: number;
  localStoreName: string;
  localStoreCode: string;
  externalStoreCode: string;
  externalStoreName: string | null;
  notes: string | null;
  isActive: boolean;
  sourceTable: string;
  createdBy: number | null;
  createdByName: string | null;
  createdBySurname: string | null;
  createdByAvatarFilename?: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedBySurname: string | null;
  updatedByAvatarFilename?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreScopeRow {
  id: number;
  companyId: number;
}

interface StoreWithCompanyRow {
  id: number;
  companyId: number;
  companyName: string;
  storeName: string;
  storeCode: string;
  storeLogoFilename: string | null;
}

interface StoreMappingRow {
  externalStoreCode: string;
  externalStoreName: string | null;
}

interface CurrentAffluenceRow {
  dayOfWeek: number;
  timeSlot: string;
  level: 'low' | 'medium' | 'high';
  requiredStaff: number;
}

interface OverviewCompanyRow {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  storeCount: number;
  employeeCount: number;
}

interface OverviewStoreRow {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  code: string;
  isActive: boolean;
  employeeCount: number;
}

interface OverviewEmployeeRow {
  id: number;
  companyId: number;
  companyName: string;
  storeId: number | null;
  storeName: string | null;
  name: string;
  surname: string;
  email: string;
  role: string;
  status: string;
}

interface OverviewInternalDbRow {
  databaseName: string;
}

interface OverviewTableDetailRow {
  tableName: string;
  rowEstimate: number | string;
  dataBytes: number | string;
  indexBytes: number | string;
  totalBytes: number | string;
  totalSizePretty: string;
}

interface OverviewTableColumnRow {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  maxLength: number | null;
}

interface ShiftCoverageRow {
  date: string;
  userId: number;
  startTime: string;
  endTime: string;
  splitStart2: string | null;
  splitEnd2: string | null;
  isSplit: boolean;
  isOffDay: boolean;
}

interface ExistsRow {
  exists: boolean;
}

interface CountRow {
  count: number | string;
}

interface CompanyAffluenceSettingsRow {
  companyId: number;
  visitorsPerStaff: number | string;
  slotWeight09001200: number | string;
  slotWeight12001500: number | string;
  slotWeight15001800: number | string;
  slotWeight18002100: number | string;
  lowMaxStaff: number | string;
  mediumMaxStaff: number | string;
  coverageTolerance: number | string;
}

interface LiveAffluenceSlotWeight {
  timeSlot: string;
  weight: number;
}

interface LiveAffluenceSettings {
  visitorsPerStaff: number;
  slotWeights: LiveAffluenceSlotWeight[];
  lowMaxStaff: number;
  mediumMaxStaff: number;
  coverageTolerance: number;
}

interface AffluenceSettingsUpdateInput {
  visitorsPerStaff?: number;
  lowMaxStaff?: number;
  mediumMaxStaff?: number;
  coverageTolerance?: number;
  slotWeights?: Array<{ timeSlot: string; weight: number }>;
}

const STAFFING_SLOTS: Array<{ timeSlot: string; startMinutes: number; endMinutes: number }> = [
  { timeSlot: '00:00-06:00', startMinutes: 0,    endMinutes: 6  * 60 },
  { timeSlot: '06:00-12:00', startMinutes: 6 * 60, endMinutes: 12 * 60 },
  { timeSlot: '12:00-18:00', startMinutes: 12 * 60, endMinutes: 18 * 60 },
  { timeSlot: '18:00-24:00', startMinutes: 18 * 60, endMinutes: 24 * 60 },
];

const DEFAULT_VISITORS_PER_STAFF = 10;
const DEFAULT_LOW_MAX_STAFF = 10;
const DEFAULT_MEDIUM_MAX_STAFF = 20;
const DEFAULT_COVERAGE_TOLERANCE = 0.4;
const DEFAULT_SLOT_WEIGHTS: LiveAffluenceSlotWeight[] = [
  { timeSlot: '00:00-06:00', weight: 0.1 },
  { timeSlot: '06:00-12:00', weight: 0.3 },
  { timeSlot: '12:00-18:00', weight: 0.35 },
  { timeSlot: '18:00-24:00', weight: 0.25 },
];

let shiftsIsOffDayColumnCache: boolean | null = null;

function normalizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function getDefaultLiveAffluenceSettings(): LiveAffluenceSettings {
  return {
    visitorsPerStaff: DEFAULT_VISITORS_PER_STAFF,
    lowMaxStaff: DEFAULT_LOW_MAX_STAFF,
    mediumMaxStaff: DEFAULT_MEDIUM_MAX_STAFF,
    coverageTolerance: DEFAULT_COVERAGE_TOLERANCE,
    slotWeights: DEFAULT_SLOT_WEIGHTS.map((slot) => ({ ...slot })),
  };
}

function normalizeLiveAffluenceSettings(
  row: CompanyAffluenceSettingsRow | null,
): LiveAffluenceSettings {
  const defaults = getDefaultLiveAffluenceSettings();
  if (!row) {
    return defaults;
  }

  const lowMaxStaff = Math.round(normalizeBoundedNumber(row.lowMaxStaff, defaults.lowMaxStaff, 0, 100000));
  const mediumMaxCandidate = Math.round(normalizeBoundedNumber(row.mediumMaxStaff, defaults.mediumMaxStaff, lowMaxStaff, 100000));

  return {
    visitorsPerStaff: normalizeBoundedNumber(row.visitorsPerStaff, defaults.visitorsPerStaff, 0.1, 10000),
    lowMaxStaff,
    mediumMaxStaff: Math.max(lowMaxStaff, mediumMaxCandidate),
    coverageTolerance: normalizeBoundedNumber(row.coverageTolerance, defaults.coverageTolerance, 0, 10),
    slotWeights: [
      {
        timeSlot: '00:00-06:00',
        weight: normalizeBoundedNumber(row.slotWeight09001200, defaults.slotWeights[0].weight, 0, 1),
      },
      {
        timeSlot: '06:00-12:00',
        weight: normalizeBoundedNumber(row.slotWeight12001500, defaults.slotWeights[1].weight, 0, 1),
      },
      {
        timeSlot: '12:00-18:00',
        weight: normalizeBoundedNumber(row.slotWeight15001800, defaults.slotWeights[2].weight, 0, 1),
      },
      {
        timeSlot: '18:00-24:00',
        weight: normalizeBoundedNumber(row.slotWeight18002100, defaults.slotWeights[3].weight, 0, 1),
      },
    ],
  };
}

function normalizeSettingsPatch(
  current: LiveAffluenceSettings,
  patch: AffluenceSettingsUpdateInput,
): LiveAffluenceSettings {
  const next: LiveAffluenceSettings = {
    visitorsPerStaff: patch.visitorsPerStaff != null
      ? normalizeBoundedNumber(patch.visitorsPerStaff, current.visitorsPerStaff, 0.1, 10000)
      : current.visitorsPerStaff,
    lowMaxStaff: patch.lowMaxStaff != null
      ? Math.round(normalizeBoundedNumber(patch.lowMaxStaff, current.lowMaxStaff, 0, 100000))
      : current.lowMaxStaff,
    mediumMaxStaff: patch.mediumMaxStaff != null
      ? Math.round(normalizeBoundedNumber(patch.mediumMaxStaff, current.mediumMaxStaff, 0, 100000))
      : current.mediumMaxStaff,
    coverageTolerance: patch.coverageTolerance != null
      ? normalizeBoundedNumber(patch.coverageTolerance, current.coverageTolerance, 0, 10)
      : current.coverageTolerance,
    slotWeights: current.slotWeights.map((slot) => ({ ...slot })),
  };

  if (patch.slotWeights && patch.slotWeights.length > 0) {
    const bySlot = new Map(patch.slotWeights.map((slot) => [slot.timeSlot, slot.weight]));
    next.slotWeights = next.slotWeights.map((slot) => {
      const updated = bySlot.get(slot.timeSlot);
      return {
        ...slot,
        weight: updated != null
          ? normalizeBoundedNumber(updated, slot.weight, 0, 1)
          : slot.weight,
      };
    });
  }

  if (next.mediumMaxStaff < next.lowMaxStaff) {
    next.mediumMaxStaff = next.lowMaxStaff;
  }

  return next;
}

function detectLevelFromEstimatedVisitors(
  estimatedVisitors: number,
  settings: LiveAffluenceSettings,
): 'low' | 'medium' | 'high' {
  if (estimatedVisitors <= settings.lowMaxStaff) return 'low';
  if (estimatedVisitors <= settings.mediumMaxStaff) return 'medium';
  return 'high';
}

function buildAffluenceRecommendationsWithSettings(
  rows: ExternalIngressiDailyRow[],
  settings: LiveAffluenceSettings,
): ExternalAffluenceRecommendationRow[] {
  if (rows.length === 0) {
    return [];
  }

  const summary = buildTrafficSummary(rows);

  const weekdayAvgMap = new Map<number, number>();
  for (const row of summary.weekdayAverages) {
    weekdayAvgMap.set(row.dayOfWeek, row.days > 0 ? row.avgVisitors : 0);
  }

  const output: ExternalAffluenceRecommendationRow[] = [];

  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
    const dayAvgVisitors = weekdayAvgMap.get(dayOfWeek) ?? 0;
    for (const slot of settings.slotWeights) {
      const estimatedVisitors = Number((dayAvgVisitors * slot.weight).toFixed(2));
      const requiredStaff = estimatedVisitors <= 0
        ? 0
        : Math.max(1, Math.ceil(estimatedVisitors / settings.visitorsPerStaff));

      output.push({
        dayOfWeek,
        timeSlot: slot.timeSlot,
        estimatedVisitors,
        level: detectLevelFromEstimatedVisitors(estimatedVisitors, settings),
        requiredStaff,
      });
    }
  }

  return output;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function toIsoDayOfWeek(dateValue: string): number {
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 1;
  const jsDay = parsed.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.slice(0, 5);
  const [hh, mm] = normalized.split(':').map((part) => parseInt(part, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return (hh * 60) + mm;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function buildWeekdayCounts(fromDate: string, toDate: string): Map<number, number> {
  const output = new Map<number, number>();
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return output;
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    const jsDay = cursor.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    output.set(isoDay, (output.get(isoDay) ?? 0) + 1);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return output;
}

function buildScheduledStaffBaseline(
  rows: ShiftCoverageRow[],
  fromDate: string,
  toDate: string,
): Map<string, number> {
  const uniqueCoverage = new Set<string>();
  const weekdayCounts = buildWeekdayCounts(fromDate, toDate);

  for (const row of rows) {
    if (row.isOffDay) continue;

    const dayOfWeek = toIsoDayOfWeek(row.date);
    const firstStart = parseTimeToMinutes(row.startTime);
    const firstEnd = parseTimeToMinutes(row.endTime);
    if (firstStart == null || firstEnd == null) continue;

    const secondStart = row.isSplit ? parseTimeToMinutes(row.splitStart2) : null;
    const secondEnd = row.isSplit ? parseTimeToMinutes(row.splitEnd2) : null;

    for (const slot of STAFFING_SLOTS) {
      const firstOverlaps = rangesOverlap(firstStart, firstEnd, slot.startMinutes, slot.endMinutes);
      const secondOverlaps =
        secondStart != null
        && secondEnd != null
        && rangesOverlap(secondStart, secondEnd, slot.startMinutes, slot.endMinutes);

      if (!firstOverlaps && !secondOverlaps) {
        continue;
      }

      uniqueCoverage.add(`${row.date}|${dayOfWeek}|${slot.timeSlot}|${row.userId}`);
    }
  }

  const totals = new Map<string, number>();
  for (const key of uniqueCoverage) {
    const [, day, timeSlot] = key.split('|');
    const aggregateKey = `${day}|${timeSlot}`;
    totals.set(aggregateKey, (totals.get(aggregateKey) ?? 0) + 1);
  }

  const averageBySlot = new Map<string, number>();
  for (let day = 1; day <= 7; day += 1) {
    const dayCount = weekdayCounts.get(day) ?? 0;
    for (const slot of STAFFING_SLOTS) {
      const aggregateKey = `${day}|${slot.timeSlot}`;
      const coveredShifts = totals.get(aggregateKey) ?? 0;
      const avg = dayCount > 0 ? coveredShifts / dayCount : 0;
      averageBySlot.set(aggregateKey, Number(avg.toFixed(2)));
    }
  }

  return averageBySlot;
}

function buildActualScheduledStaffForDates(
  rows: ShiftCoverageRow[],
): Map<string, number> {
  const uniqueCoverage = new Set<string>();

  for (const row of rows) {
    if (row.isOffDay) continue;

    const firstStart = parseTimeToMinutes(row.startTime);
    const firstEnd = parseTimeToMinutes(row.endTime);
    if (firstStart == null || firstEnd == null) continue;

    const secondStart = row.isSplit ? parseTimeToMinutes(row.splitStart2) : null;
    const secondEnd = row.isSplit ? parseTimeToMinutes(row.splitEnd2) : null;

    for (const slot of STAFFING_SLOTS) {
      const firstOverlaps = rangesOverlap(firstStart, firstEnd, slot.startMinutes, slot.endMinutes);
      const secondOverlaps =
        secondStart != null
        && secondEnd != null
        && rangesOverlap(secondStart, secondEnd, slot.startMinutes, slot.endMinutes);

      if (!firstOverlaps && !secondOverlaps) {
        continue;
      }

      uniqueCoverage.add(`${row.date}|${slot.timeSlot}|${row.userId}`);
    }
  }

  const totals = new Map<string, number>();
  for (const key of uniqueCoverage) {
    const [date, timeSlot] = key.split('|');
    const aggregateKey = `${date}|${timeSlot}`;
    totals.set(aggregateKey, (totals.get(aggregateKey) ?? 0) + 1);
  }

  return totals;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDateRange(fromRaw: unknown, toRaw: unknown): { fromDate: string; toDate: string } | null {
  const now = new Date();
  const defaultTo = formatDateOnly(now);
  const defaultFromDate = new Date(now);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 56);
  const defaultFrom = formatDateOnly(defaultFromDate);

  const fromDate = typeof fromRaw === 'string' && isDateOnly(fromRaw) ? fromRaw : defaultFrom;
  const toDate = typeof toRaw === 'string' && isDateOnly(toRaw) ? toRaw : defaultTo;

  if (fromDate > toDate) {
    return null;
  }

  return { fromDate, toDate };
}

function normalizeIsoWeekToken(weekRaw: unknown): { year: number; week: number; weekToken: string } | null {
  if (typeof weekRaw !== 'string') return null;
  const trimmed = weekRaw.trim();
  const match = trimmed.match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) {
    return null;
  }

  return {
    year,
    week,
    weekToken: `${year}-W${String(week).padStart(2, '0')}`,
  };
}

function dateRangeFromIsoWeek(weekRaw: unknown): { weekToken: string; fromDate: string; toDate: string } | null {
  const parsed = normalizeIsoWeekToken(weekRaw);
  if (!parsed) return null;

  const jan4 = new Date(Date.UTC(parsed.year, 0, 4));
  const jan4IsoDay = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4IsoDay - 1) + ((parsed.week - 1) * 7));

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekToken: parsed.weekToken,
    fromDate: formatDateOnly(monday),
    toDate: formatDateOnly(sunday),
  };
}

async function resolveTargetCompanyId(req: Request): Promise<number | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const explicit = req.query?.target_company_id
    ?? req.query?.company_id
    ?? req.body?.target_company_id
    ?? req.body?.company_id;

  if (explicit != null) {
    const parsed = parseInt(String(explicit), 10);
    if (!Number.isFinite(parsed) || !allowedCompanyIds.includes(parsed)) {
      return null;
    }
    return parsed;
  }

  const fallback = req.user?.companyId ?? allowedCompanyIds[0];
  if (!Number.isFinite(fallback) || !allowedCompanyIds.includes(fallback as number)) {
    return null;
  }

  return fallback as number;
}

async function resolveScopedStore(storeId: number, req: Request): Promise<StoreScopeRow | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const row = await queryOne<StoreScopeRow>(
    `SELECT id, company_id AS "companyId"
     FROM stores
     WHERE id = $1 AND company_id = ANY($2)`,
    [storeId, allowedCompanyIds],
  );
  return row;
}

async function getScopedStoreWithCompany(
  storeId: number,
  companyId: number,
): Promise<StoreWithCompanyRow | null> {
  return queryOne<StoreWithCompanyRow>(
    `SELECT
       s.id,
       s.company_id AS "companyId",
       c.name AS "companyName",
       s.name AS "storeName",
       s.code AS "storeCode",
       s.logo_filename AS "storeLogoFilename"
     FROM stores s
     JOIN companies c ON c.id = s.company_id
     WHERE s.id = $1
       AND s.company_id = $2`,
    [storeId, companyId],
  );
}

function parseRequestedCompanyId(req: Request): number | null | 'INVALID' {
  const explicit = req.query?.target_company_id
    ?? req.query?.company_id
    ?? req.body?.target_company_id
    ?? req.body?.company_id;

  if (explicit == null) return null;

  const parsed = parseInt(String(explicit), 10);
  if (!Number.isFinite(parsed)) {
    return 'INVALID';
  }

  return parsed;
}

async function resolveScopedStoreWithDetails(
  req: Request,
  storeId: number,
): Promise<StoreWithCompanyRow | null | 'COMPANY_MISMATCH' | 'INVALID_COMPANY_ID'> {
  const requestedCompanyId = parseRequestedCompanyId(req);
  if (requestedCompanyId === 'INVALID') {
    return 'INVALID_COMPANY_ID';
  }

  if (requestedCompanyId != null) {
    const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
    if (!allowedCompanyIds.includes(requestedCompanyId)) {
      return 'COMPANY_MISMATCH';
    }
  }

  const scopedStore = await resolveScopedStore(storeId, req);
  if (!scopedStore) {
    return null;
  }

  return getScopedStoreWithCompany(scopedStore.id, scopedStore.companyId);
}

function sendExternalDbError(res: Response, err: unknown): boolean {
  if (err instanceof ExternalDbUnavailableError) {
    res.status(err.status).json({
      success: false,
      error: err.message,
      code: err.code,
    });
    return true;
  }

  const anyErr = err as { code?: string; message?: string };
  const code = String(anyErr?.code ?? '').toUpperCase();
  const message = String(anyErr?.message ?? '').toLowerCase();
  const isConnectionOrTimeoutError = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'PROTOCOL_ENQUEUE_AFTER_QUIT',
  ].includes(code)
    || message.includes('etimedout')
    || message.includes('read etimedout')
    || message.includes('connect etimedout')
    || message.includes('connection lost')
    || message.includes('mysql server has gone away');

  if (isConnectionOrTimeoutError) {
    res.status(503).json({
      success: false,
      error: 'External database is currently unreachable or timed out. Please try again shortly.',
      code: 'EXTERNAL_DB_TIMEOUT',
    });
    return true;
  }

  return false;
}

function isLocalRequest(req: Request): boolean {
  const host = (req.hostname ?? '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

async function hasShiftsIsOffDayColumn(): Promise<boolean> {
  if (shiftsIsOffDayColumnCache != null) {
    return shiftsIsOffDayColumnCache;
  }

  const exists = await queryOne<ExistsRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'shifts'
         AND column_name = 'is_off_day'
     ) AS exists`,
  );

  shiftsIsOffDayColumnCache = Boolean(exists?.exists);
  return shiftsIsOffDayColumnCache;
}

async function loadCompanyLiveAffluenceSettings(companyId: number): Promise<LiveAffluenceSettings> {
  try {
    const row = await queryOne<CompanyAffluenceSettingsRow>(
      `SELECT
         company_id AS "companyId",
         visitors_per_staff AS "visitorsPerStaff",
         slot_weight_0900_1200 AS "slotWeight09001200",
         slot_weight_1200_1500 AS "slotWeight12001500",
         slot_weight_1500_1800 AS "slotWeight15001800",
         slot_weight_1800_2100 AS "slotWeight18002100",
         low_max_staff AS "lowMaxStaff",
         medium_max_staff AS "mediumMaxStaff",
         coverage_tolerance AS "coverageTolerance"
       FROM company_external_affluence_settings
       WHERE company_id = $1`,
      [companyId],
    );

    return normalizeLiveAffluenceSettings(row ?? null);
  } catch (err) {
    // Keep API usable even when migration has not been applied yet.
    const anyErr = err as { code?: string };
    if (anyErr?.code === '42P01') {
      return getDefaultLiveAffluenceSettings();
    }
    throw err;
  }
}

async function saveCompanyLiveAffluenceSettings(
  companyId: number,
  settings: LiveAffluenceSettings,
  actorUserId: number | null,
): Promise<LiveAffluenceSettings> {
  try {
    await query(
      `INSERT INTO company_external_affluence_settings (
         company_id,
         visitors_per_staff,
         slot_weight_0900_1200,
         slot_weight_1200_1500,
         slot_weight_1500_1800,
         slot_weight_1800_2100,
         low_max_staff,
         medium_max_staff,
         coverage_tolerance,
         updated_by,
         created_at,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       ON CONFLICT (company_id)
       DO UPDATE SET
         visitors_per_staff = EXCLUDED.visitors_per_staff,
         slot_weight_0900_1200 = EXCLUDED.slot_weight_0900_1200,
         slot_weight_1200_1500 = EXCLUDED.slot_weight_1200_1500,
         slot_weight_1500_1800 = EXCLUDED.slot_weight_1500_1800,
         slot_weight_1800_2100 = EXCLUDED.slot_weight_1800_2100,
         low_max_staff = EXCLUDED.low_max_staff,
         medium_max_staff = EXCLUDED.medium_max_staff,
         coverage_tolerance = EXCLUDED.coverage_tolerance,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        companyId,
        settings.visitorsPerStaff,
        settings.slotWeights[0].weight,
        settings.slotWeights[1].weight,
        settings.slotWeights[2].weight,
        settings.slotWeights[3].weight,
        settings.lowMaxStaff,
        settings.mediumMaxStaff,
        settings.coverageTolerance,
        actorUserId,
      ],
    );
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr?.code === '42P01') {
      const missingSchemaError = new Error('Live affluence settings table is missing. Run database migrations.') as Error & { code?: string };
      missingSchemaError.code = 'AFFLUENCE_SETTINGS_SCHEMA_MISSING';
      throw missingSchemaError;
    }
    throw err;
  }

  return loadCompanyLiveAffluenceSettings(companyId);
}

export const getExternalCatalog = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, { tables: getExternalTableCatalog() });
});

export const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    res.status(403).json({ success: false, error: 'Access denied: no companies in scope', code: 'COMPANY_MISMATCH' });
    return;
  }

  const [
    companyCountRow,
    storeCountRow,
    employeeCountRow,
    localTablesRow,
    companies,
    stores,
    employees,
    internalDbRow,
    localTableDetailRows,
    localTableColumnRows,
  ] = await Promise.all([
    queryOne<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM companies
       WHERE id = ANY($1)`,
      [allowedCompanyIds],
    ),
    queryOne<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM stores
       WHERE company_id = ANY($1)`,
      [allowedCompanyIds],
    ),
    queryOne<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE company_id = ANY($1)
         AND role = 'employee'`,
      [allowedCompanyIds],
    ),
    queryOne<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'`,
    ),
    query<OverviewCompanyRow>(
      `SELECT
         c.id,
         c.name,
         c.slug,
         c.is_active AS "isActive",
         COUNT(DISTINCT s.id)::int AS "storeCount",
         COUNT(DISTINCT CASE WHEN u.role = 'employee' THEN u.id END)::int AS "employeeCount"
       FROM companies c
       LEFT JOIN stores s ON s.company_id = c.id
       LEFT JOIN users u ON u.company_id = c.id
       WHERE c.id = ANY($1)
       GROUP BY c.id, c.name, c.slug, c.is_active
       ORDER BY c.name`,
      [allowedCompanyIds],
    ),
    query<OverviewStoreRow>(
      `SELECT
         s.id,
         s.company_id AS "companyId",
         c.name AS "companyName",
         s.name,
         s.code,
         s.is_active AS "isActive",
         COUNT(CASE WHEN u.role = 'employee' THEN u.id END)::int AS "employeeCount"
       FROM stores s
       JOIN companies c ON c.id = s.company_id
       LEFT JOIN users u ON u.store_id = s.id
       WHERE s.company_id = ANY($1)
       GROUP BY s.id, s.company_id, c.name, s.name, s.code, s.is_active
       ORDER BY c.name, s.name`,
      [allowedCompanyIds],
    ),
    query<OverviewEmployeeRow>(
      `SELECT
         u.id,
         u.company_id AS "companyId",
         c.name AS "companyName",
         u.store_id AS "storeId",
         s.name AS "storeName",
         u.name,
         u.surname,
         u.email,
         u.role,
         u.status
       FROM users u
       JOIN companies c ON c.id = u.company_id
       LEFT JOIN stores s ON s.id = u.store_id
       WHERE u.company_id = ANY($1)
         AND u.role = 'employee'
       ORDER BY c.name, s.name NULLS LAST, u.surname, u.name`,
      [allowedCompanyIds],
    ),
    queryOne<OverviewInternalDbRow>(
      `SELECT current_database() AS "databaseName"`,
    ),
    query<OverviewTableDetailRow>(
      `SELECT
         c.relname AS "tableName",
         COALESCE(s.n_live_tup, 0)::bigint AS "rowEstimate",
         pg_relation_size(c.oid)::bigint AS "dataBytes",
         pg_indexes_size(c.oid)::bigint AS "indexBytes",
         pg_total_relation_size(c.oid)::bigint AS "totalBytes",
         pg_size_pretty(pg_total_relation_size(c.oid)) AS "totalSizePretty"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY c.relname`,
    ),
    query<OverviewTableColumnRow>(
      `SELECT
         table_name AS "tableName",
         column_name AS "columnName",
         data_type AS "dataType",
         (is_nullable = 'YES') AS "isNullable",
         character_maximum_length AS "maxLength"
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    ),
  ]);

  const internalCheckedAt = new Date().toISOString();
  let internalStatus = {
    ok: true,
    message: 'Connected',
    checkedAt: internalCheckedAt,
    database: internalDbRow?.databaseName ?? null,
  };

  try {
    await queryOne<{ ok: number }>('SELECT 1 AS ok');
  } catch (err: any) {
    internalStatus = {
      ok: false,
      message: err?.message || 'Unable to query internal database',
      checkedAt: new Date().toISOString(),
      database: internalDbRow?.databaseName ?? null,
    };
  }

  const localColumnsByTable = new Map<string, OverviewTableColumnRow[]>();
  for (const row of localTableColumnRows) {
    const list = localColumnsByTable.get(row.tableName) ?? [];
    list.push(row);
    localColumnsByTable.set(row.tableName, list);
  }

  const localTableDetails = localTableDetailRows.map((row) => ({
    tableName: row.tableName,
    rowEstimate: Number(row.rowEstimate ?? 0),
    dataBytes: Number(row.dataBytes ?? 0),
    indexBytes: Number(row.indexBytes ?? 0),
    totalBytes: Number(row.totalBytes ?? 0),
    totalSizePretty: row.totalSizePretty || formatBytes(Number(row.totalBytes ?? 0)),
    columns: (localColumnsByTable.get(row.tableName) ?? []).map((column) => ({
      columnName: column.columnName,
      dataType: column.dataType,
      isNullable: column.isNullable,
      maxLength: column.maxLength,
    })),
  }));

  const externalConfig = getExternalDbConfigStatus();
  const externalStatus = await checkExternalConnection();

  const allowLocalMetadata = process.env.NODE_ENV !== 'production' || isLocalRequest(req);

  let externalTableDetails: Array<{
    tableName: string;
    engine: string | null;
    rowEstimate: number;
    dataBytes: number;
    indexBytes: number;
    totalBytes: number;
    totalSizePretty: string;
    columns: Array<{
      columnName: string;
      dataType: string;
      isNullable: boolean;
      maxLength: number | null;
    }>;
  }> = [];

  if (allowLocalMetadata && externalStatus.ok) {
    try {
      const details = await fetchExternalTableDetails(500);
      externalTableDetails = details.map((table) => ({
        tableName: table.tableName,
        engine: table.engine,
        rowEstimate: Number(table.rowEstimate ?? 0),
        dataBytes: Number(table.dataBytes ?? 0),
        indexBytes: Number(table.indexBytes ?? 0),
        totalBytes: Number(table.totalBytes ?? 0),
        totalSizePretty: formatBytes(Number(table.totalBytes ?? 0)),
        columns: table.columns.map((column) => ({
          columnName: column.columnName,
          dataType: column.dataType,
          isNullable: column.isNullable,
          maxLength: column.maxLength,
        })),
      }));
    } catch {
      externalTableDetails = [];
    }
  }

  const safeLocalTableDetails = allowLocalMetadata ? localTableDetails : [];
  const safeExternalTableDetails = allowLocalMetadata ? externalTableDetails : [];
  const localTables = safeLocalTableDetails.map((table) => ({ tableName: table.tableName }));
  const externalTables = safeExternalTableDetails.map((table) => ({ tableName: table.tableName }));

  ok(res, {
    connections: {
      internal: internalStatus,
      external: externalStatus,
      externalConfig,
    },
    databases: {
      internal: {
        engine: 'PostgreSQL',
        databaseName: internalStatus.database,
        tableCount: safeLocalTableDetails.length,
        connected: internalStatus.ok,
        checkedAt: internalStatus.checkedAt,
      },
      external: {
        engine: 'MySQL',
        databaseName: externalStatus.database ?? externalConfig.database,
        tableCount: safeExternalTableDetails.length,
        connected: externalStatus.ok,
        configured: externalStatus.configured,
        checkedAt: externalStatus.checkedAt,
      },
    },
    counts: {
      companies: Number(companyCountRow?.count ?? 0),
      stores: Number(storeCountRow?.count ?? 0),
      employees: Number(employeeCountRow?.count ?? 0),
      localTables: safeLocalTableDetails.length,
      externalTables: safeExternalTableDetails.length,
    },
    companies,
    stores,
    employees,
    localTables,
    externalTables,
    localTableDetails: safeLocalTableDetails,
    externalTableDetails: safeExternalTableDetails,
  });
});

export const listDepositi = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveTargetCompanyId(req);
  if (companyId == null) {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }

  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 300;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 300;

  try {
    const externalStores = await fetchDepositiRows(search, limit);
    const externalStoreCodes = externalStores.map((item) => item.externalStoreCode);

    const [mappingRows, availabilityByCode] = await Promise.all([
      query<{
        externalStoreCode: string;
        localStoreId: number;
        localStoreName: string;
        localStoreCode: string;
      }>(
        `SELECT
           m.external_store_code AS "externalStoreCode",
           m.local_store_id AS "localStoreId",
           s.name AS "localStoreName",
           s.code AS "localStoreCode"
         FROM external_store_mappings m
         JOIN stores s ON s.id = m.local_store_id
         WHERE m.company_id = $1 AND m.is_active = true`,
        [companyId],
      ),
      fetchIngressiAvailabilityByStoreCodes(externalStoreCodes),
    ]);

    const mappingByCode = new Map<string, {
      localStoreId: number;
      localStoreName: string;
      localStoreCode: string;
    }>();

    for (const row of mappingRows) {
      mappingByCode.set(String(row.externalStoreCode).trim(), {
        localStoreId: row.localStoreId,
        localStoreName: row.localStoreName,
        localStoreCode: row.localStoreCode,
      });
    }

    const rows = externalStores.map((item) => {
      const mapping = mappingByCode.get(item.externalStoreCode);
      const availability = availabilityByCode.get(item.externalStoreCode);
      return {
        ...item,
        mappedLocalStoreId: mapping?.localStoreId ?? null,
        mappedLocalStoreName: mapping?.localStoreName ?? null,
        mappedLocalStoreCode: mapping?.localStoreCode ?? null,
        availableDays: availability?.availableDays ?? 0,
        availableFromDate: availability?.availableFromDate ?? null,
        availableToDate: availability?.availableToDate ?? null,
      };
    });

    ok(res, { rows });
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }
});

export const listMappings = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    res.status(403).json({ success: false, error: 'Access denied: no companies in scope', code: 'COMPANY_MISMATCH' });
    return;
  }

  const explicit = req.query?.target_company_id ?? req.query?.company_id ?? req.body?.target_company_id ?? req.body?.company_id;
  let scopedCompanyId: number | null = null;
  if (explicit != null) {
    const parsed = parseInt(String(explicit), 10);
    if (!Number.isFinite(parsed) || !allowedCompanyIds.includes(parsed)) {
      res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
      return;
    }
    scopedCompanyId = parsed;
  }

  const whereParts = ['m.company_id = ANY($1)'];
  const params: Array<number[] | number> = [allowedCompanyIds];
  if (scopedCompanyId != null) {
    whereParts.push('m.company_id = $2');
    params.push(scopedCompanyId);
  }

  const rows = await query<MappingViewRow>(
    `SELECT
       m.id,
       m.company_id AS "companyId",
       c.name AS "companyName",
       m.local_store_id AS "localStoreId",
       s.name AS "localStoreName",
       s.code AS "localStoreCode",
       m.external_store_code AS "externalStoreCode",
       m.external_store_name AS "externalStoreName",
       m.notes,
       m.is_active AS "isActive",
       m.source_table AS "sourceTable",
       m.created_by AS "createdBy",
       cb.name AS "createdByName",
       cb.surname AS "createdBySurname",
      cb.avatar_filename AS "createdByAvatarFilename",
       m.updated_by AS "updatedBy",
       ub.name AS "updatedByName",
       ub.surname AS "updatedBySurname",
      ub.avatar_filename AS "updatedByAvatarFilename",
       m.created_at AS "createdAt",
       m.updated_at AS "updatedAt"
     FROM external_store_mappings m
     JOIN stores s ON s.id = m.local_store_id
     JOIN companies c ON c.id = m.company_id
     LEFT JOIN users cb ON cb.id = m.created_by
     LEFT JOIN users ub ON ub.id = m.updated_by
     WHERE ${whereParts.join(' AND ')}
     ORDER BY c.name, s.name`,
    params,
  );

  let externalByCode = new Map<string, { storeName: string | null; companyName: string | null }>();
  try {
    externalByCode = await fetchDepositiByStoreCodes(rows.map((row) => row.externalStoreCode));
  } catch (err) {
    if (!(err instanceof ExternalDbUnavailableError)) {
      throw err;
    }
  }

  const enrichedRows = rows.map((row) => ({
    ...row,
    externalCompanyName: externalByCode.get(row.externalStoreCode)?.companyName ?? null,
  }));

  ok(res, { mappings: enrichedRows });
});

export const upsertMapping = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.storeId, 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'Invalid store id', 'INVALID_STORE_ID');
    return;
  }

  const externalStoreCode = String(req.body?.external_store_code ?? '').trim();
  const notes = req.body?.notes == null ? null : String(req.body.notes).trim() || null;
  if (!externalStoreCode) {
    badRequest(res, 'External store code is required', 'EXTERNAL_STORE_CODE_REQUIRED');
    return;
  }

  const store = await resolveScopedStore(storeId, req);
  if (!store) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  let externalStoreName: string | null = null;
  let externalCompanyName: string | null = null;
  try {
    const found = await fetchDepositoByCode(externalStoreCode);
    if (!found) {
      badRequest(res, 'External store code was not found in DEPOSITI', 'EXTERNAL_STORE_NOT_FOUND');
      return;
    }
    externalStoreName = found.storeName ?? null;
    externalCompanyName = found.companyName ?? null;
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }

  const actorId = req.user?.userId ?? null;

  try {
    const row = await queryOne<MappingViewRow>(
      `WITH upsert AS (
         INSERT INTO external_store_mappings (
           company_id,
           local_store_id,
           external_store_code,
           external_store_name,
           source_table,
           notes,
           is_active,
           created_by,
           updated_by,
           updated_at
         )
         VALUES ($1, $2, $3, $4, 'depositi', $5, true, $6, $6, NOW())
         ON CONFLICT (company_id, local_store_id)
         DO UPDATE SET
           external_store_code = EXCLUDED.external_store_code,
           external_store_name = EXCLUDED.external_store_name,
           notes = EXCLUDED.notes,
           is_active = true,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
         RETURNING *
       )
       SELECT
         u.id,
         u.company_id AS "companyId",
        c.name AS "companyName",
         u.local_store_id AS "localStoreId",
         s.name AS "localStoreName",
         s.code AS "localStoreCode",
         u.external_store_code AS "externalStoreCode",
         u.external_store_name AS "externalStoreName",
         u.notes,
         u.is_active AS "isActive",
         u.source_table AS "sourceTable",
        u.created_by AS "createdBy",
        cb.name AS "createdByName",
        cb.surname AS "createdBySurname",
        cb.avatar_filename AS "createdByAvatarFilename",
        u.updated_by AS "updatedBy",
        ub.name AS "updatedByName",
        ub.surname AS "updatedBySurname",
        ub.avatar_filename AS "updatedByAvatarFilename",
         u.created_at AS "createdAt",
         u.updated_at AS "updatedAt"
       FROM upsert u
       JOIN stores s ON s.id = u.local_store_id
       JOIN companies c ON c.id = u.company_id
       LEFT JOIN users cb ON cb.id = u.created_by
       LEFT JOIN users ub ON ub.id = u.updated_by`,
      [
        store.companyId,
        store.id,
        externalStoreCode,
        externalStoreName,
        notes,
        actorId,
      ],
    );

    if (!row) {
      badRequest(res, 'Unable to save mapping', 'MAPPING_SAVE_FAILED');
      return;
    }

    created(res, {
      mapping: {
        ...row,
        externalCompanyName,
      },
    }, 'Mapping saved');
  } catch (err: any) {
    if (err?.code === '23505') {
      conflict(res, 'External store code is already mapped to another local store in this company', 'DUPLICATE_EXTERNAL_STORE_CODE');
      return;
    }
    throw err;
  }
});

export const deleteMapping = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.storeId, 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'Invalid store id', 'INVALID_STORE_ID');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const deleted = await queryOne<{ id: number }>(
    `DELETE FROM external_store_mappings m
     USING stores s
     WHERE m.local_store_id = s.id
       AND m.local_store_id = $1
       AND s.company_id = ANY($2)
     RETURNING m.id`,
    [storeId, allowedCompanyIds],
  );

  if (!deleted) {
    notFound(res, 'Mapping not found', 'MAPPING_NOT_FOUND');
    return;
  }

  ok(res, { deleted: deleted.id });
});

async function resolveExternalStoreCode(
  req: Request,
  companyId: number,
): Promise<{ externalStoreCode: string; localStoreId: number | null; externalStoreName: string | null } | null> {
  const explicitCode = typeof req.query.external_store_code === 'string'
    ? String(req.query.external_store_code).trim()
    : '';

  if (explicitCode) {
    return {
      externalStoreCode: explicitCode,
      localStoreId: null,
      externalStoreName: null,
    };
  }

  const storeIdRaw = req.query.store_id ?? req.body?.store_id;
  const storeId = parseInt(String(storeIdRaw ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    return null;
  }

  const mapping = await queryOne<StoreMappingRow>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName"
     FROM external_store_mappings
     WHERE company_id = $1
       AND local_store_id = $2
       AND is_active = true
     LIMIT 1`,
    [companyId, storeId],
  );

  if (!mapping) {
    return null;
  }

  return {
    externalStoreCode: String(mapping.externalStoreCode).trim(),
    localStoreId: storeId,
    externalStoreName: mapping.externalStoreName,
  };
}

export const getIngressiData = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveTargetCompanyId(req);
  if (companyId == null) {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }

  const resolved = await resolveExternalStoreCode(req, companyId);
  if (!resolved) {
    badRequest(res, 'Provide external_store_code or a mapped store_id', 'STORE_MAPPING_REQUIRED');
    return;
  }

  const range = normalizeDateRange(req.query.from_date, req.query.to_date);
  if (!range) {
    badRequest(res, 'Invalid date range', 'INVALID_DATE_RANGE');
    return;
  }

  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 400;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 5000) : 400;

  try {
    const [rows, detail] = await Promise.all([
      fetchIngressiDaily(
        resolved.externalStoreCode,
        range.fromDate,
        range.toDate,
        limit,
      ),
      fetchIngressiDetailedRows(
        resolved.externalStoreCode,
        range.fromDate,
        range.toDate,
        Math.min(limit, 1200),
      ),
    ]);

    ok(res, {
      externalStoreCode: resolved.externalStoreCode,
      externalStoreName: resolved.externalStoreName,
      localStoreId: resolved.localStoreId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      rows,
      summary: buildTrafficSummary(rows),
      detailColumns: detail.columns,
      detailRows: detail.rows,
    });
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }
});

export const getExternalTableData = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveTargetCompanyId(req);
  if (companyId == null) {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }

  const tableNameRaw = String(req.query.table_name ?? '').trim();
  if (!tableNameRaw) {
    badRequest(res, 'table_name is required', 'TABLE_NAME_REQUIRED');
    return;
  }

  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 60;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 60;

  try {
    const tableDetails = await fetchExternalTableDetails(500);
    const tableName = tableDetails.find((table) => table.tableName.toLowerCase() === tableNameRaw.toLowerCase())?.tableName;
    if (!tableName) {
      notFound(res, 'External table not found', 'EXTERNAL_TABLE_NOT_FOUND');
      return;
    }

    const data = await fetchExternalTableSampleData(tableName, limit);
    ok(res, {
      tableName: data.tableName,
      columns: data.columns,
      rows: data.rows,
    });
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }
});

function mergeWithCurrentAffluence(
  recommendations: ExternalAffluenceRecommendationRow[],
  currentRows: CurrentAffluenceRow[],
  scheduledStaffBaseline: Map<string, number>,
  coverageTolerance = DEFAULT_COVERAGE_TOLERANCE,
): Array<ExternalAffluenceRecommendationRow & {
  currentLevel: 'low' | 'medium' | 'high' | null;
  currentRequiredStaff: number | null;
  deltaRequiredStaff: number | null;
  currentScheduledStaff: number;
  deltaToScheduledStaff: number;
  coverageStatus: 'under' | 'balanced' | 'over';
}> {
  const currentMap = new Map<string, CurrentAffluenceRow>();

  for (const row of currentRows) {
    const key = `${row.dayOfWeek}|${row.timeSlot}`;
    if (!currentMap.has(key)) {
      currentMap.set(key, row);
    }
  }

  return recommendations.map((row) => {
    const key = `${row.dayOfWeek}|${row.timeSlot}`;
    const current = currentMap.get(key);
    const currentScheduledStaff = scheduledStaffBaseline.get(key) ?? 0;
    const deltaToScheduledStaff = Number((row.requiredStaff - currentScheduledStaff).toFixed(2));

    let coverageStatus: 'under' | 'balanced' | 'over' = 'balanced';
    if (deltaToScheduledStaff > coverageTolerance) {
      coverageStatus = 'under';
    } else if (deltaToScheduledStaff < -coverageTolerance) {
      coverageStatus = 'over';
    }

    return {
      ...row,
      currentLevel: current?.level ?? null,
      currentRequiredStaff: current?.requiredStaff ?? null,
      deltaRequiredStaff: current ? row.requiredStaff - current.requiredStaff : null,
      currentScheduledStaff,
      deltaToScheduledStaff,
      coverageStatus,
    };
  });
}

export const getAffluencePreview = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveTargetCompanyId(req);
  if (companyId == null) {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }

  const storeId = parseInt(String(req.query.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const store = await queryOne<{ id: number }>(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2`,
    [storeId, companyId],
  );
  if (!store) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const mapping = await queryOne<StoreMappingRow>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName"
     FROM external_store_mappings
     WHERE company_id = $1
       AND local_store_id = $2
       AND is_active = true
     LIMIT 1`,
    [companyId, storeId],
  );

  if (!mapping) {
    badRequest(res, 'Store has no external mapping yet', 'STORE_MAPPING_REQUIRED');
    return;
  }

  const range = normalizeDateRange(req.query.from_date, req.query.to_date);
  if (!range) {
    badRequest(res, 'Invalid date range', 'INVALID_DATE_RANGE');
    return;
  }

  try {
    const rows = await fetchIngressiDaily(
      String(mapping.externalStoreCode).trim(),
      range.fromDate,
      range.toDate,
      1200,
    );

    const recommendations = buildAffluenceRecommendations(rows);

    const currentRows = await query<CurrentAffluenceRow>(
      `SELECT
         day_of_week AS "dayOfWeek",
         time_slot AS "timeSlot",
         level,
         required_staff AS "requiredStaff"
       FROM store_affluence
       WHERE company_id = $1
         AND store_id = $2
         AND iso_week IS NULL
       ORDER BY day_of_week, time_slot, id DESC`,
      [companyId, storeId],
    );

    const includeIsOffDay = await hasShiftsIsOffDayColumn();
    const isOffDaySelect = includeIsOffDay
      ? 'is_off_day AS "isOffDay"'
      : 'false AS "isOffDay"';

    const shiftRows = await query<ShiftCoverageRow>(
      `SELECT
         TO_CHAR(s.date::date, 'YYYY-MM-DD') AS date,
         s.user_id AS "userId",
         TO_CHAR(s.start_time, 'HH24:MI') AS "startTime",
         TO_CHAR(s.end_time, 'HH24:MI') AS "endTime",
         CASE WHEN s.split_start2 IS NULL THEN NULL ELSE TO_CHAR(s.split_start2, 'HH24:MI') END AS "splitStart2",
         CASE WHEN s.split_end2 IS NULL THEN NULL ELSE TO_CHAR(s.split_end2, 'HH24:MI') END AS "splitEnd2",
         s.is_split AS "isSplit",
         ${isOffDaySelect}
       FROM shifts s
       WHERE s.company_id = $1
         AND (
           s.store_id = $2
           OR (
             s.assignment_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM temporary_store_assignments tsa
               WHERE tsa.id = s.assignment_id
                 AND (tsa.origin_store_id = $2 OR tsa.target_store_id = $2)
             )
           )
         )
         AND s.date BETWEEN $3::date AND $4::date
         AND s.status = 'confirmed'`,
      [companyId, storeId, range.fromDate, range.toDate],
    );

    const scheduledStaffBaseline = buildScheduledStaffBaseline(
      shiftRows,
      range.fromDate,
      range.toDate,
    );

    ok(res, {
      storeId,
      externalStoreCode: String(mapping.externalStoreCode).trim(),
      externalStoreName: mapping.externalStoreName,
      fromDate: range.fromDate,
      toDate: range.toDate,
      visitorsPerStaff: getVisitorsPerStaffSetting(),
      sourceSummary: buildTrafficSummary(rows),
      recommendations: mergeWithCurrentAffluence(recommendations, currentRows, scheduledStaffBaseline),
    });
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }
});

export const getWeekAffluenceLive = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.query.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID') {
    badRequest(res, 'Invalid company id', 'INVALID_COMPANY_ID');
    return;
  }
  if (storeResolution === 'COMPANY_MISMATCH') {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }
  if (!storeResolution) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const store = storeResolution;
  const companyId = store.companyId;

  const mapping = await queryOne<StoreMappingRow>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName"
     FROM external_store_mappings
     WHERE company_id = $1
       AND local_store_id = $2
       AND is_active = true
     LIMIT 1`,
    [companyId, storeId],
  );

  if (!mapping) {
    badRequest(res, 'Store has no external mapping yet', 'STORE_MAPPING_REQUIRED');
    return;
  }

  const weekRange = req.query.week != null ? dateRangeFromIsoWeek(req.query.week) : null;
  if (req.query.week != null && !weekRange) {
    badRequest(res, 'Invalid ISO week format. Use YYYY-WNN', 'INVALID_WEEK');
    return;
  }

  const dateRange = weekRange ?? normalizeDateRange(req.query.from_date, req.query.to_date);
  if (!dateRange) {
    badRequest(res, 'Invalid date range', 'INVALID_DATE_RANGE');
    return;
  }

  try {
    const settings = await loadCompanyLiveAffluenceSettings(companyId);

    const rows = await fetchIngressiDaily(
      String(mapping.externalStoreCode).trim(),
      dateRange.fromDate,
      dateRange.toDate,
      1200,
    );

    const recommendations = buildAffluenceRecommendationsWithSettings(rows, settings);

    const currentRows = await query<CurrentAffluenceRow>(
      `SELECT
         day_of_week AS "dayOfWeek",
         time_slot AS "timeSlot",
         level,
         required_staff AS "requiredStaff"
       FROM store_affluence
       WHERE company_id = $1
         AND store_id = $2
         AND iso_week IS NULL
       ORDER BY day_of_week, time_slot, id DESC`,
      [companyId, storeId],
    );

    const includeIsOffDay = await hasShiftsIsOffDayColumn();
    const isOffDaySelect = includeIsOffDay
      ? 'is_off_day AS "isOffDay"'
      : 'false AS "isOffDay"';

    const shiftRows = await query<ShiftCoverageRow>(
      `SELECT
         TO_CHAR(s.date::date, 'YYYY-MM-DD') AS date,
         s.user_id AS "userId",
         TO_CHAR(s.start_time, 'HH24:MI') AS "startTime",
         TO_CHAR(s.end_time, 'HH24:MI') AS "endTime",
         CASE WHEN s.split_start2 IS NULL THEN NULL ELSE TO_CHAR(s.split_start2, 'HH24:MI') END AS "splitStart2",
         CASE WHEN s.split_end2 IS NULL THEN NULL ELSE TO_CHAR(s.split_end2, 'HH24:MI') END AS "splitEnd2",
         s.is_split AS "isSplit",
         ${isOffDaySelect}
       FROM shifts s
       WHERE s.company_id = $1
         AND (
           s.store_id = $2
           OR (
             s.assignment_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM temporary_store_assignments tsa
               WHERE tsa.id = s.assignment_id
                 AND (tsa.origin_store_id = $2 OR tsa.target_store_id = $2)
             )
           )
         )
         AND s.date BETWEEN $3::date AND $4::date
         AND s.status = 'confirmed'`,
      [companyId, storeId, dateRange.fromDate, dateRange.toDate],
    );

    const scheduledStaffBaseline = buildScheduledStaffBaseline(
      shiftRows,
      dateRange.fromDate,
      dateRange.toDate,
    );

    ok(res, {
      storeId,
      companyId: store.companyId,
      companyName: store.companyName,
      localStoreName: store.storeName,
      localStoreCode: store.storeCode,
      externalStoreCode: String(mapping.externalStoreCode).trim(),
      externalStoreName: mapping.externalStoreName,
      week: weekRange?.weekToken ?? null,
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
      settings,
      sourceSummary: buildTrafficSummary(rows),
      recommendations: mergeWithCurrentAffluence(
        recommendations,
        currentRows,
        scheduledStaffBaseline,
        settings.coverageTolerance,
      ),
    });
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }
});

export const getAffluenceConfiguration = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.query.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID') {
    badRequest(res, 'Invalid company id', 'INVALID_COMPANY_ID');
    return;
  }
  if (storeResolution === 'COMPANY_MISMATCH') {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }
  if (!storeResolution) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const store = storeResolution;
  const companyId = store.companyId;

  const mapping = await queryOne<{
    externalStoreCode: string;
    externalStoreName: string | null;
    notes: string | null;
    isActive: boolean;
    mappedByUserId: number | null;
    mappedByName: string | null;
    mappedBySurname: string | null;
    mappedByAvatarFilename: string | null;
    mappedAt: string | null;
  }>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName",
       notes,
       is_active AS "isActive",
       COALESCE(m.updated_by, m.created_by) AS "mappedByUserId",
       COALESCE(ub.name, cb.name) AS "mappedByName",
       COALESCE(ub.surname, cb.surname) AS "mappedBySurname",
       COALESCE(ub.avatar_filename, cb.avatar_filename) AS "mappedByAvatarFilename",
       COALESCE(m.updated_at, m.created_at) AS "mappedAt"
     FROM external_store_mappings m
     LEFT JOIN users ub ON ub.id = m.updated_by
     LEFT JOIN users cb ON cb.id = m.created_by
     WHERE m.company_id = $1
       AND m.local_store_id = $2
     ORDER BY m.id DESC
     LIMIT 1`,
    [companyId, storeId],
  );

  const settings = await loadCompanyLiveAffluenceSettings(companyId);

  ok(res, {
    storeId,
    companyId: store.companyId,
    companyName: store.companyName,
    localStoreName: store.storeName,
    localStoreCode: store.storeCode,
    localStoreLogoFilename: store.storeLogoFilename ?? null,
    integration: {
      mapped: Boolean(mapping?.isActive && mapping?.externalStoreCode),
      externalStoreCode: mapping?.externalStoreCode ?? null,
      externalStoreName: mapping?.externalStoreName ?? null,
      notes: mapping?.notes ?? null,
      isActive: mapping?.isActive ?? false,
      mappedByUserId: mapping?.mappedByUserId ?? null,
      mappedByName: mapping?.mappedByName ?? null,
      mappedBySurname: mapping?.mappedBySurname ?? null,
      mappedByAvatarFilename: mapping?.mappedByAvatarFilename ?? null,
      mappedAt: mapping?.mappedAt ?? null,
    },
    settings,
  });
});

export const updateAffluenceConfiguration = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.body?.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID') {
    badRequest(res, 'Invalid company id', 'INVALID_COMPANY_ID');
    return;
  }
  if (storeResolution === 'COMPANY_MISMATCH') {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }
  if (!storeResolution) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const store = storeResolution;
  const companyId = store.companyId;

  const patch: AffluenceSettingsUpdateInput = {
    visitorsPerStaff: typeof req.body?.visitors_per_staff === 'number' ? req.body.visitors_per_staff : undefined,
    lowMaxStaff: typeof req.body?.low_max_staff === 'number' ? req.body.low_max_staff : undefined,
    mediumMaxStaff: typeof req.body?.medium_max_staff === 'number' ? req.body.medium_max_staff : undefined,
    coverageTolerance: typeof req.body?.coverage_tolerance === 'number' ? req.body.coverage_tolerance : undefined,
    slotWeights: Array.isArray(req.body?.slot_weights)
      ? req.body.slot_weights
          .map((slot: unknown) => {
            if (!slot || typeof slot !== 'object') return null;
            const maybe = slot as { time_slot?: unknown; weight?: unknown };
            if (typeof maybe.time_slot !== 'string' || typeof maybe.weight !== 'number') return null;
            return { timeSlot: maybe.time_slot, weight: maybe.weight };
          })
          .filter((slot: { timeSlot: string; weight: number } | null): slot is { timeSlot: string; weight: number } => slot != null)
      : undefined,
  };

  const current = await loadCompanyLiveAffluenceSettings(companyId);
  const next = normalizeSettingsPatch(current, patch);

  try {
    const saved = await saveCompanyLiveAffluenceSettings(companyId, next, req.user?.userId ?? null);
    ok(res, {
      storeId,
      companyId: store.companyId,
      companyName: store.companyName,
      localStoreName: store.storeName,
      localStoreCode: store.storeCode,
      settings: saved,
    }, 'Affluence configuration updated');
  } catch (err) {
    const anyErr = err as { code?: string; message?: string };
    if (anyErr?.code === 'AFFLUENCE_SETTINGS_SCHEMA_MISSING') {
      res.status(503).json({
        success: false,
        error: anyErr.message ?? 'Live affluence settings schema is missing',
        code: anyErr.code,
      });
      return;
    }
    throw err;
  }
});

export const syncAffluenceFromExternal = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.body?.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const store = await resolveScopedStore(storeId, req);
  if (!store) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const mapping = await queryOne<StoreMappingRow>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName"
     FROM external_store_mappings
     WHERE company_id = $1
       AND local_store_id = $2
       AND is_active = true
     LIMIT 1`,
    [store.companyId, store.id],
  );

  if (!mapping) {
    badRequest(res, 'Store has no external mapping yet', 'STORE_MAPPING_REQUIRED');
    return;
  }

  const range = normalizeDateRange(req.body?.from_date, req.body?.to_date);
  if (!range) {
    badRequest(res, 'Invalid date range', 'INVALID_DATE_RANGE');
    return;
  }

  const overwriteDefault = req.body?.overwrite_default !== false;

  let recommendations: ExternalAffluenceRecommendationRow[] = [];
  let sourceSummary = null as ReturnType<typeof buildTrafficSummary> | null;

  try {
    const sourceRows = await fetchIngressiDaily(
      String(mapping.externalStoreCode).trim(),
      range.fromDate,
      range.toDate,
      1200,
    );

    sourceSummary = buildTrafficSummary(sourceRows);
    recommendations = buildAffluenceRecommendations(sourceRows);
  } catch (err) {
    if (sendExternalDbError(res, err)) return;
    throw err;
  }

  if (recommendations.length === 0) {
    badRequest(res, 'No external traffic data available for the selected range', 'NO_EXTERNAL_TRAFFIC_DATA');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (overwriteDefault) {
      await client.query(
        `DELETE FROM store_affluence
         WHERE company_id = $1
           AND store_id = $2
           AND iso_week IS NULL`,
        [store.companyId, store.id],
      );
    }

    const colsPerRow = 7;
    const params: Array<number | string | null> = [];
    const placeholders = recommendations.map((row, index) => {
      const offset = index * colsPerRow;
      params.push(
        store.companyId,
        store.id,
        null,
        row.dayOfWeek,
        row.timeSlot,
        row.level,
        row.requiredStaff,
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    await client.query(
      `INSERT INTO store_affluence (
         company_id,
         store_id,
         iso_week,
         day_of_week,
         time_slot,
         level,
         required_staff
       ) VALUES ${placeholders.join(',')}`,
      params,
    );

    await client.query('COMMIT');

    ok(res, {
      storeId: store.id,
      externalStoreCode: String(mapping.externalStoreCode).trim(),
      externalStoreName: mapping.externalStoreName,
      fromDate: range.fromDate,
      toDate: range.toDate,
      visitorsPerStaff: getVisitorsPerStaffSetting(),
      overwriteDefault,
      syncedRows: recommendations.length,
      sourceSummary,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getAffluenceForecast = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.query.store_id ?? ''), 10);
  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID') {
    badRequest(res, 'Invalid company id', 'INVALID_COMPANY_ID');
    return;
  }
  if (storeResolution === 'COMPANY_MISMATCH') {
    res.status(403).json({ success: false, error: 'Access denied for selected company', code: 'COMPANY_MISMATCH' });
    return;
  }
  if (!storeResolution) {
    notFound(res, 'Store not found', 'STORE_NOT_FOUND');
    return;
  }

  const store = storeResolution;
  const companyId = store.companyId;

  const mapping = await queryOne<StoreMappingRow>(
    `SELECT
       external_store_code AS "externalStoreCode",
       external_store_name AS "externalStoreName"
     FROM external_store_mappings
     WHERE company_id = $1
       AND local_store_id = $2
       AND is_active = true
     LIMIT 1`,
    [companyId, storeId],
  );

  if (!mapping) {
    badRequest(res, 'Store has no external mapping yet', 'STORE_MAPPING_REQUIRED');
    return;
  }

  const now = new Date();
  const defaultFrom = formatDateOnly(now);
  const defaultToDate = new Date(now);
  defaultToDate.setUTCDate(defaultToDate.getUTCDate() + 13);
  const defaultTo = formatDateOnly(defaultToDate);

  const fromDate = typeof req.query.from_date === 'string' && isDateOnly(req.query.from_date) ? req.query.from_date : defaultFrom;
  const toDate = typeof req.query.to_date === 'string' && isDateOnly(req.query.to_date) ? req.query.to_date : defaultTo;

  if (fromDate > toDate) {
    badRequest(res, 'from_date cannot be greater than to_date', 'INVALID_DATE_RANGE');
    return;
  }

  try {
    const settings = await loadCompanyLiveAffluenceSettings(companyId);

    // Fetch rolling weekday averages (last 4 weeks)
    const historicalToDate = new Date(now);
    historicalToDate.setUTCDate(historicalToDate.getUTCDate() - 1);
    const historicalTo = formatDateOnly(historicalToDate);

    const historicalFromDate = new Date(now);
    historicalFromDate.setUTCDate(historicalFromDate.getUTCDate() - 28);
    const historicalFrom = formatDateOnly(historicalFromDate);

    const histRows = await fetchIngressiDaily(
      String(mapping.externalStoreCode).trim(),
      historicalFrom,
      historicalTo,
      1200,
    );

    const weekdayAvgMap = new Map<number, number>();
    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
      const weekdayRows = histRows.filter((row) => toIsoDayOfWeek(row.date) === dayOfWeek);
      weekdayRows.sort((a, b) => b.date.localeCompare(a.date));
      const top4 = weekdayRows.slice(0, 4);
      const sum = top4.reduce((acc, row) => acc + row.visitors, 0);
      const avg = sum / 4;
      weekdayAvgMap.set(dayOfWeek, Number(avg.toFixed(2)));
    }

    // Fetch overrides
    const overrides = await query<{ overrideDate: string; visitorsOverride: number; note: string }>(
      `SELECT
         TO_CHAR(override_date::date, 'YYYY-MM-DD') AS "overrideDate",
         visitors_override AS "visitorsOverride",
         note
       FROM affluence_forecast_overrides
       WHERE store_id = $1
         AND override_date BETWEEN $2::date AND $3::date`,
      [storeId, fromDate, toDate],
    );

    const overrideMap = new Map<string, { visitors: number; note: string }>();
    for (const r of overrides) {
      overrideMap.set(r.overrideDate, { visitors: r.visitorsOverride, note: r.note ?? '' });
    }

    // Fetch actual future/scheduled shifts for the forecast period to overlay actual planned coverage
    const includeIsOffDay = await hasShiftsIsOffDayColumn();
    const isOffDaySelect = includeIsOffDay
      ? 'is_off_day AS "isOffDay"'
      : 'false AS "isOffDay"';

    const shiftRows = await query<ShiftCoverageRow>(
      `SELECT
         TO_CHAR(s.date::date, 'YYYY-MM-DD') AS date,
         s.user_id AS "userId",
         TO_CHAR(s.start_time, 'HH24:MI') AS "startTime",
         TO_CHAR(s.end_time, 'HH24:MI') AS "endTime",
         CASE WHEN s.split_start2 IS NULL THEN NULL ELSE TO_CHAR(s.split_start2, 'HH24:MI') END AS "splitStart2",
         CASE WHEN s.split_end2 IS NULL THEN NULL ELSE TO_CHAR(s.split_end2, 'HH24:MI') END AS "splitEnd2",
         s.is_split AS "isSplit",
         ${isOffDaySelect}
       FROM shifts s
       WHERE s.company_id = $1
         AND (
           s.store_id = $2
           OR (
             s.assignment_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM temporary_store_assignments tsa
               WHERE tsa.id = s.assignment_id
                 AND (tsa.origin_store_id = $2 OR tsa.target_store_id = $2)
             )
           )
         )
         AND s.date BETWEEN $3::date AND $4::date
         AND s.status = 'confirmed'`,
      [companyId, storeId, fromDate, toDate],
    );

    const actualScheduledStaff = buildActualScheduledStaffForDates(shiftRows);

    // Build forecast rows
    const days: any[] = [];
    const currentIter = new Date(fromDate + 'T12:00:00Z');
    const endIter = new Date(toDate + 'T12:00:00Z');

    const visitorsPerStaff = settings.visitorsPerStaff;
    const tolerance = settings.coverageTolerance;

    while (currentIter <= endIter) {
      const dateStr = formatDateOnly(currentIter);
      const jsDay = currentIter.getUTCDay();
      const dayOfWeek = jsDay === 0 ? 7 : jsDay;

      const overrideObj = overrideMap.get(dateStr);
      const hasOverride = overrideMap.has(dateStr);
      const effectiveDailyVisitors = hasOverride && overrideObj != null
        ? overrideObj.visitors
        : (weekdayAvgMap.get(dayOfWeek) ?? 0);

      const slotsList: any[] = [];

      for (const slot of settings.slotWeights) {
        const estimatedVisitors = Number((effectiveDailyVisitors * slot.weight).toFixed(2));
        const requiredStaff = estimatedVisitors <= 0
          ? 0
          : Math.max(1, Math.ceil(estimatedVisitors / visitorsPerStaff));

        const level = detectLevelFromEstimatedVisitors(estimatedVisitors, settings);

        const currentScheduledStaff = actualScheduledStaff.get(`${dateStr}|${slot.timeSlot}`) ?? 0;
        const deltaToScheduledStaff = Number((requiredStaff - currentScheduledStaff).toFixed(2));

        let coverageStatus: 'under' | 'balanced' | 'over' = 'balanced';
        if (deltaToScheduledStaff > tolerance) {
          coverageStatus = 'under';
        } else if (deltaToScheduledStaff < -tolerance) {
          coverageStatus = 'over';
        }

        slotsList.push({
          timeSlot: slot.timeSlot,
          slotWeight: slot.weight,
          estimatedVisitors,
          level,
          requiredStaff,
          currentScheduledStaff,
          deltaToScheduledStaff,
          coverageStatus,
        });
      }

      days.push({
        date: dateStr,
        dayOfWeek,
        isOverridden: hasOverride,
        overriddenVisitors: overrideObj?.visitors ?? null,
        overrideNote: overrideObj?.note ?? null,
        estimatedDailyVisitors: weekdayAvgMap.get(dayOfWeek) ?? 0,
        effectiveDailyVisitors,
        slots: slotsList,
      });

      currentIter.setUTCDate(currentIter.getUTCDate() + 1);
    }

    ok(res, {
      storeId,
      companyId,
      fromDate,
      toDate,
      days,
      settings,
    });
  } catch (err) {
    if (err instanceof ExternalDbUnavailableError) {
      res.status(503).json({ success: false, error: 'Database esterno non disponibile', code: 'EXTERNAL_DB_UNAVAILABLE' });
      return;
    }
    throw err;
  }
});

export const upsertForecastOverride = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.body.store_id ?? ''), 10);
  const date = String(req.body.date ?? '').trim();
  const visitorsOverride = parseInt(String(req.body.visitors_override ?? ''), 10);
  const note = req.body.note != null ? String(req.body.note).trim() : null;

  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }
  if (!isDateOnly(date)) {
    badRequest(res, 'Invalid date format. Use YYYY-MM-DD', 'INVALID_DATE');
    return;
  }
  if (!Number.isFinite(visitorsOverride) || visitorsOverride < 0) {
    badRequest(res, 'visitors_override must be a positive integer', 'INVALID_VISITORS_OVERRIDE');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID' || storeResolution === 'COMPANY_MISMATCH' || !storeResolution) {
    res.status(403).json({ success: false, error: 'Access denied', code: 'ACCESS_DENIED' });
    return;
  }

  const userId = req.user?.userId ?? null;

  await query(
    `INSERT INTO affluence_forecast_overrides (store_id, override_date, visitors_override, note, created_by)
     VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (store_id, override_date)
     DO UPDATE SET
       visitors_override = EXCLUDED.visitors_override,
       note = EXCLUDED.note,
       created_by = EXCLUDED.created_by,
       updated_at = NOW()`,
    [storeId, date, visitorsOverride, note, userId],
  );

  ok(res, { success: true });
});

export const deleteForecastOverride = asyncHandler(async (req: Request, res: Response) => {
  const storeId = parseInt(String(req.query.store_id ?? ''), 10);
  const date = String(req.query.date ?? '').trim();

  if (!Number.isFinite(storeId)) {
    badRequest(res, 'store_id is required', 'STORE_ID_REQUIRED');
    return;
  }
  if (!isDateOnly(date)) {
    badRequest(res, 'Invalid date format. Use YYYY-MM-DD', 'INVALID_DATE');
    return;
  }

  const storeResolution = await resolveScopedStoreWithDetails(req, storeId);
  if (storeResolution === 'INVALID_COMPANY_ID' || storeResolution === 'COMPANY_MISMATCH' || !storeResolution) {
    res.status(403).json({ success: false, error: 'Access denied', code: 'ACCESS_DENIED' });
    return;
  }

  await query(
    `DELETE FROM affluence_forecast_overrides
     WHERE store_id = $1 AND override_date = $2::date`,
    [storeId, date],
  );

  ok(res, { success: true });
});
