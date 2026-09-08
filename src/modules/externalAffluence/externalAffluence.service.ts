import { createPool, Pool, RowDataPacket } from 'mysql2/promise';

export type ExternalTableName = 'depositi' | 'ingressi';
export type AffluenceLevel = 'low' | 'medium' | 'high';

export type ExternalTableCellValue = string | number | boolean | null;

export interface ExternalTableDataRow {
  [column: string]: ExternalTableCellValue;
}

export interface ExternalTableDataResult {
  tableName: string;
  columns: string[];
  rows: ExternalTableDataRow[];
}

export interface ExternalTableColumnDef {
  field: string;
  englishLabel: string;
  type: string;
  description: string;
}

export interface ExternalTableCatalogItem {
  table: ExternalTableName;
  englishName: string;
  description: string;
  columns: ExternalTableColumnDef[];
}

export interface ExternalDepositoRow {
  externalStoreCode: string;
  storeName: string | null;
  companyName: string | null;
  availableDays?: number;
  availableFromDate?: string | null;
  availableToDate?: string | null;
}

export interface ExternalIngressiDailyRow {
  date: string;
  externalStoreCode: string;
  visitors: number;
}

export interface ExternalTrafficSummary {
  totalDays: number;
  nonZeroDays: number;
  totalVisitors: number;
  avgVisitors: number;
  minVisitors: number;
  maxVisitors: number;
  weekdayAverages: Array<{
    dayOfWeek: number;
    days: number;
    avgVisitors: number;
  }>;
}

export interface ExternalAffluenceRecommendationRow {
  dayOfWeek: number;
  timeSlot: string;
  estimatedVisitors: number;
  level: AffluenceLevel;
  requiredStaff: number;
}

export interface ExternalDbConnectionStatus {
  configured: boolean;
  ok: boolean;
  host: string | null;
  database: string | null;
  port: number | null;
  message: string;
  checkedAt: string;
  code?: string;
}

export interface ExternalTableDetailColumn {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  maxLength: number | null;
}

export interface ExternalTableDetail {
  tableName: string;
  engine: string | null;
  rowEstimate: number;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
  columns: ExternalTableDetailColumn[];
}

interface ExternalDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface DepositoSqlRow extends RowDataPacket {
  external_store_code: string | null;
  store_name: string | null;
  company_name: string | null;
}

interface IngressiSqlRow extends RowDataPacket {
  date: string;
  external_store_code: string | null;
  visitors: number | string | null;
}

interface IngressiAvailabilitySqlRow extends RowDataPacket {
  external_store_code: string | null;
  available_days: number | string | null;
  min_date: string | null;
  max_date: string | null;
}

const EXTERNAL_TABLE_CATALOG: ExternalTableCatalogItem[] = [
  {
    table: 'depositi',
    englishName: 'Stores',
    description: 'External source of store codes and names used for mapping to local stores.',
    columns: [
      {
        field: 'coddep',
        englishLabel: 'external_store_code',
        type: 'varchar(20)',
        description: 'External store code used to join traffic rows.',
      },
      {
        field: 'deposito',
        englishLabel: 'store_name',
        type: 'varchar(50)',
        description: 'Store name in external database.',
      },
      {
        field: 'azienda',
        englishLabel: 'company_name',
        type: 'varchar(50)',
        description: 'Company label in external database.',
      },
    ],
  },
  {
    table: 'ingressi',
    englishName: 'Daily Foot Traffic',
    description: 'Daily visitors per external store code used for affluence forecasting.',
    columns: [
      {
        field: 'deposito',
        englishLabel: 'external_store_code',
        type: 'varchar(20)',
        description: 'External store code matching DEPOSITI.coddep.',
      },
      {
        field: 'data',
        englishLabel: 'date',
        type: 'date',
        description: 'Traffic date.',
      },
      {
        field: 'valore',
        englishLabel: 'visitors',
        type: 'double',
        description: 'Daily visitors count.',
      },
      {
        field: 'user',
        englishLabel: 'source_user',
        type: 'varchar(20)',
        description: 'Source user in external system.',
      },
    ],
  },
];

const SLOT_DISTRIBUTION: Array<{ timeSlot: string; weight: number }> = [
  { timeSlot: '00:00-06:00', weight: 0.1 },
  { timeSlot: '06:00-12:00', weight: 0.3 },
  { timeSlot: '12:00-18:00', weight: 0.35 },
  { timeSlot: '18:00-24:00', weight: 0.25 },
];

let externalPool: Pool | null = null;

function readEnvValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && value !== '') {
      return value;
    }
  }
  return '';
}

function readExternalDbConfig(): ExternalDbConfig | null {
  const host = readEnvValue('EXTERNAL_AFFLUENCE_DB_HOST', 'AFFLUENCE_MYSQL_HOST', 'MYSQL_HOST');
  const user = readEnvValue('EXTERNAL_AFFLUENCE_DB_USER', 'AFFLUENCE_MYSQL_USER', 'MYSQL_USER');
  const password = readEnvValue('EXTERNAL_AFFLUENCE_DB_PASSWORD', 'AFFLUENCE_MYSQL_PASSWORD', 'MYSQL_PASSWORD');
  const database = readEnvValue('EXTERNAL_AFFLUENCE_DB_NAME', 'AFFLUENCE_MYSQL_DATABASE', 'MYSQL_DATABASE', 'DB_DATABASE');
  const portRaw = readEnvValue('EXTERNAL_AFFLUENCE_DB_PORT', 'AFFLUENCE_MYSQL_PORT', 'MYSQL_PORT');

  if (!host || !user || !database) {
    return null;
  }

  const parsedPort = portRaw ? parseInt(portRaw, 10) : 3306;
  const port = Number.isFinite(parsedPort) ? parsedPort : 3306;

  return {
    host,
    user,
    password,
    database,
    port,
  };
}

export function getExternalDbConfigStatus(): {
  configured: boolean;
  host: string | null;
  database: string | null;
  port: number | null;
} {
  const cfg = readExternalDbConfig();
  if (!cfg) {
    return {
      configured: false,
      host: null,
      database: null,
      port: null,
    };
  }

  return {
    configured: true,
    host: cfg.host,
    database: cfg.database,
    port: cfg.port,
  };
}

export class ExternalDbUnavailableError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'EXTERNAL_DB_UNAVAILABLE', status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function getExternalPool(): Pool {
  if (externalPool) {
    return externalPool;
  }

  const cfg = readExternalDbConfig();
  if (!cfg) {
    throw new ExternalDbUnavailableError(
      'External MySQL connection is not configured. Set EXTERNAL_AFFLUENCE_DB_* variables.',
      'EXTERNAL_DB_NOT_CONFIGURED',
      503,
    );
  }

  externalPool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 0,
    connectTimeout: 30000, // Increased to 30 seconds
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: true,
    decimalNumbers: true,
    charset: 'utf8mb4',
  });

  return externalPool;
}

export async function checkExternalConnection(): Promise<ExternalDbConnectionStatus> {
  const checkedAt = new Date().toISOString();
  const cfg = readExternalDbConfig();
  if (!cfg) {
    return {
      configured: false,
      ok: false,
      host: null,
      database: null,
      port: null,
      message: 'External MySQL is not configured',
      checkedAt,
      code: 'EXTERNAL_DB_NOT_CONFIGURED',
    };
  }

  try {
    const pool = getExternalPool();
    
    // Add a timeout wrapper for the connection check
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection check timed out after 30 seconds')), 30000);
    });
    
    const queryPromise = pool.query('SELECT 1');
    
    await Promise.race([queryPromise, timeoutPromise]);
    
    return {
      configured: true,
      ok: true,
      host: cfg.host,
      database: cfg.database,
      port: cfg.port,
      message: 'Connected',
      checkedAt,
    };
  } catch (err: any) {
    const isTimeout = err?.code === 'ETIMEDOUT' || err?.message?.includes('timed out');
    return {
      configured: true,
      ok: false,
      host: cfg.host,
      database: cfg.database,
      port: cfg.port,
      message: isTimeout 
        ? `Connection timeout: Unable to reach ${cfg.host}:${cfg.port}. Please check network connectivity and firewall settings.`
        : (err?.message || 'Unable to connect to external MySQL'),
      checkedAt,
      code: isTimeout ? 'EXTERNAL_DB_TIMEOUT' : 'EXTERNAL_DB_CONNECTION_FAILED',
    };
  }
}

export async function fetchExternalTableNames(limit = 200): Promise<string[]> {
  const pool = getExternalPool();
  const safeLimit = clamp(limit, 1, 1000);
  const [rows] = await pool.query<Array<RowDataPacket & { table_name: string }>>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
     ORDER BY table_name
     LIMIT ?`,
    [safeLimit],
  );

  return rows
    .map((row) => String(row.table_name || '').trim())
    .filter((name) => name.length > 0);
}

export async function fetchExternalTableDetails(limit = 200): Promise<ExternalTableDetail[]> {
  const pool = getExternalPool();
  const safeLimit = clamp(limit, 1, 1000);

  const [tableRows] = await pool.query<Array<RowDataPacket & {
    table_name: string;
    engine: string | null;
    row_estimate: number | string | null;
    data_bytes: number | string | null;
    index_bytes: number | string | null;
  }>>(
    `SELECT
       t.table_name,
       t.engine,
       COALESCE(t.table_rows, 0) AS row_estimate,
       COALESCE(t.data_length, 0) AS data_bytes,
       COALESCE(t.index_length, 0) AS index_bytes
     FROM information_schema.tables t
     WHERE t.table_schema = DATABASE()
     ORDER BY t.table_name
     LIMIT ?`,
    [safeLimit],
  );

  const [columnRows] = await pool.query<Array<RowDataPacket & {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    max_length: number | null;
  }>>(
    `SELECT
       c.table_name,
       c.column_name,
       c.column_type AS data_type,
       c.is_nullable,
       c.character_maximum_length AS max_length
     FROM information_schema.columns c
     WHERE c.table_schema = DATABASE()
     ORDER BY c.table_name, c.ordinal_position`,
  );

  const columnsByTable = new Map<string, ExternalTableDetailColumn[]>();
  for (const row of columnRows) {
    const tableName = String(row.table_name ?? '').trim();
    if (!tableName) continue;

    const list = columnsByTable.get(tableName) ?? [];
    list.push({
      columnName: String(row.column_name ?? '').trim(),
      dataType: String(row.data_type ?? '').trim(),
      isNullable: String(row.is_nullable ?? '').toUpperCase() === 'YES',
      maxLength: row.max_length == null ? null : Number(row.max_length),
    });
    columnsByTable.set(tableName, list);
  }

  return tableRows
    .map((row) => {
      const tableName = String(row.table_name ?? '').trim();
      const dataBytes = Number(row.data_bytes ?? 0);
      const indexBytes = Number(row.index_bytes ?? 0);
      return {
        tableName,
        engine: row.engine ? String(row.engine) : null,
        rowEstimate: Number(row.row_estimate ?? 0),
        dataBytes,
        indexBytes,
        totalBytes: dataBytes + indexBytes,
        columns: columnsByTable.get(tableName) ?? [],
      };
    })
    .filter((row) => row.tableName.length > 0);
}

function normalizeStoreCode(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function quoteMysqlIdentifier(identifier: string): string {
  const normalized = (identifier ?? '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
    throw new ExternalDbUnavailableError(
      'Invalid external table identifier',
      'INVALID_EXTERNAL_TABLE_IDENTIFIER',
      400,
    );
  }
  return `\`${normalized}\``;
}

function toExternalTableCellValue(value: unknown): ExternalTableCellValue {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeTableRows(
  rows: RowDataPacket[],
  columns: string[],
): ExternalTableDataRow[] {
  return rows.map((row) => {
    const output: ExternalTableDataRow = {};
    for (const column of columns) {
      output[column] = toExternalTableCellValue((row as Record<string, unknown>)[column]);
    }
    return output;
  });
}

async function fetchTableColumnNames(tableName: string): Promise<string[]> {
  const normalizedTableName = (tableName ?? '').trim();
  if (!normalizedTableName) return [];

  const pool = getExternalPool();
  const [rows] = await pool.query<Array<RowDataPacket & { column_name: string }>>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
     ORDER BY ordinal_position`,
    [normalizedTableName],
  );

  return rows
    .map((row) => String(row.column_name ?? '').trim())
    .filter((name) => name.length > 0);
}

export async function fetchExternalTableSampleData(
  tableName: string,
  limit = 50,
): Promise<ExternalTableDataResult> {
  const normalizedTableName = (tableName ?? '').trim();
  if (!normalizedTableName) {
    return {
      tableName: normalizedTableName,
      columns: [],
      rows: [],
    };
  }

  const safeLimit = clamp(limit, 1, 300);
  const columns = await fetchTableColumnNames(normalizedTableName);
  if (columns.length === 0) {
    return {
      tableName: normalizedTableName,
      columns: [],
      rows: [],
    };
  }

  const pool = getExternalPool();
  const escapedTable = quoteMysqlIdentifier(normalizedTableName);
  const selectedColumns = columns.map((column) => quoteMysqlIdentifier(column)).join(', ');

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${selectedColumns}
     FROM ${escapedTable}
     LIMIT ?`,
    [safeLimit],
  );

  return {
    tableName: normalizedTableName,
    columns,
    rows: serializeTableRows(rows, columns),
  };
}

export async function fetchIngressiDetailedRows(
  externalStoreCode: string,
  fromDate: string,
  toDate: string,
  limit = 600,
): Promise<ExternalTableDataResult> {
  const normalizedStoreCode = normalizeStoreCode(externalStoreCode);
  if (!normalizedStoreCode) {
    return {
      tableName: 'ingressi',
      columns: [],
      rows: [],
    };
  }

  const safeLimit = clamp(limit, 1, 2000);
  const tableName = 'ingressi';
  const columns = await fetchTableColumnNames(tableName);
  if (columns.length === 0) {
    return {
      tableName,
      columns: [],
      rows: [],
    };
  }

  const pool = getExternalPool();
  const escapedTable = quoteMysqlIdentifier(tableName);
  const selectedColumns = columns.map((column) => quoteMysqlIdentifier(column)).join(', ');

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${selectedColumns}
     FROM ${escapedTable}
     WHERE TRIM(deposito) = ?
       AND DATE(data) BETWEEN ? AND ?
     ORDER BY DATE(data) DESC
     LIMIT ?`,
    [normalizedStoreCode, fromDate, toDate, safeLimit],
  );

  return {
    tableName,
    columns,
    rows: serializeTableRows(rows, columns),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseVisitorsPerStaff(): number {
  const raw = process.env.EXTERNAL_AFFLUENCE_VISITORS_PER_STAFF;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return parsed;
}

export function getVisitorsPerStaffSetting(): number {
  return parseVisitorsPerStaff();
}

function toIsoDayOfWeek(dateValue: string): number {
  const parsed = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return 1;
  }
  const jsDay = parsed.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function getExternalTableCatalog(): ExternalTableCatalogItem[] {
  return EXTERNAL_TABLE_CATALOG;
}

export async function fetchDepositiRows(search: string | null, limit = 300): Promise<ExternalDepositoRow[]> {
  const pool = getExternalPool();
  const safeLimit = clamp(limit, 1, 1000);
  const q = (search ?? '').trim();

  let rows: DepositoSqlRow[] = [];

  if (q) {
    const [result] = await pool.query<DepositoSqlRow[]>(
      `SELECT
         TRIM(coddep) AS external_store_code,
         NULLIF(TRIM(deposito), '') AS store_name,
         NULLIF(TRIM(azienda), '') AS company_name
       FROM depositi
       WHERE TRIM(coddep) LIKE CONCAT('%', ?, '%')
          OR TRIM(deposito) LIKE CONCAT('%', ?, '%')
          OR TRIM(azienda) LIKE CONCAT('%', ?, '%')
       ORDER BY TRIM(coddep)
       LIMIT ?`,
      [q, q, q, safeLimit],
    );
    rows = result;
  } else {
    const [result] = await pool.query<DepositoSqlRow[]>(
      `SELECT
         TRIM(coddep) AS external_store_code,
         NULLIF(TRIM(deposito), '') AS store_name,
         NULLIF(TRIM(azienda), '') AS company_name
       FROM depositi
       ORDER BY TRIM(coddep)
       LIMIT ?`,
      [safeLimit],
    );
    rows = result;
  }

  return rows
    .map((row) => ({
      externalStoreCode: normalizeStoreCode(row.external_store_code),
      storeName: row.store_name ?? null,
      companyName: row.company_name ?? null,
    }))
    .filter((row) => row.externalStoreCode.length > 0);
}

export async function fetchDepositiByStoreCodes(
  externalStoreCodes: string[],
): Promise<Map<string, { storeName: string | null; companyName: string | null }>> {
  const normalizedCodes = Array.from(new Set(
    externalStoreCodes
      .map((code) => normalizeStoreCode(code))
      .filter((code) => code.length > 0),
  ));

  if (normalizedCodes.length === 0) {
    return new Map();
  }

  const pool = getExternalPool();
  const placeholders = normalizedCodes.map(() => '?').join(',');
  const [rows] = await pool.query<DepositoSqlRow[]>(
    `SELECT
       TRIM(coddep) AS external_store_code,
       NULLIF(TRIM(deposito), '') AS store_name,
       NULLIF(TRIM(azienda), '') AS company_name
     FROM depositi
     WHERE TRIM(coddep) IN (${placeholders})`,
    normalizedCodes,
  );

  const output = new Map<string, { storeName: string | null; companyName: string | null }>();
  for (const row of rows) {
    const code = normalizeStoreCode(row.external_store_code);
    if (!code) continue;
    output.set(code, {
      storeName: row.store_name ?? null,
      companyName: row.company_name ?? null,
    });
  }

  return output;
}

export async function fetchIngressiAvailabilityByStoreCodes(
  externalStoreCodes: string[],
): Promise<Map<string, { availableDays: number; availableFromDate: string | null; availableToDate: string | null }>> {
  const normalizedCodes = Array.from(new Set(
    externalStoreCodes
      .map((code) => normalizeStoreCode(code))
      .filter((code) => code.length > 0),
  ));

  if (normalizedCodes.length === 0) {
    return new Map();
  }

  const pool = getExternalPool();
  const placeholders = normalizedCodes.map(() => '?').join(',');
  const [rows] = await pool.query<IngressiAvailabilitySqlRow[]>(
    `SELECT
       TRIM(deposito) AS external_store_code,
       COUNT(DISTINCT DATE(data)) AS available_days,
       DATE_FORMAT(MIN(DATE(data)), '%Y-%m-%d') AS min_date,
       DATE_FORMAT(MAX(DATE(data)), '%Y-%m-%d') AS max_date
     FROM ingressi
     WHERE TRIM(deposito) IN (${placeholders})
     GROUP BY TRIM(deposito)`,
    normalizedCodes,
  );

  const output = new Map<string, { availableDays: number; availableFromDate: string | null; availableToDate: string | null }>();
  for (const row of rows) {
    const code = normalizeStoreCode(row.external_store_code);
    if (!code) continue;
    output.set(code, {
      availableDays: Number(row.available_days ?? 0),
      availableFromDate: row.min_date ?? null,
      availableToDate: row.max_date ?? null,
    });
  }

  return output;
}

export async function fetchDepositoByCode(code: string): Promise<ExternalDepositoRow | null> {
  const normalized = normalizeStoreCode(code);
  if (!normalized) {
    return null;
  }

  const pool = getExternalPool();
  const [rows] = await pool.query<DepositoSqlRow[]>(
    `SELECT
       TRIM(coddep) AS external_store_code,
       NULLIF(TRIM(deposito), '') AS store_name,
       NULLIF(TRIM(azienda), '') AS company_name
     FROM depositi
     WHERE TRIM(coddep) = ?
     LIMIT 1`,
    [normalized],
  );

  if (!rows[0]) {
    return null;
  }

  return {
    externalStoreCode: normalizeStoreCode(rows[0].external_store_code),
    storeName: rows[0].store_name ?? null,
    companyName: rows[0].company_name ?? null,
  };
}

export async function fetchIngressiDaily(
  externalStoreCode: string,
  fromDate: string,
  toDate: string,
  limit = 400,
): Promise<ExternalIngressiDailyRow[]> {
  const normalized = normalizeStoreCode(externalStoreCode);
  if (!normalized) {
    return [];
  }

  const pool = getExternalPool();
  const safeLimit = clamp(limit, 1, 5000);

  const [rows] = await pool.query<IngressiSqlRow[]>(
    `SELECT
       DATE_FORMAT(data, '%Y-%m-%d') AS date,
       TRIM(deposito) AS external_store_code,
       SUM(COALESCE(valore, 0)) AS visitors
     FROM ingressi
     WHERE TRIM(deposito) = ?
       AND data BETWEEN ? AND ?
     GROUP BY DATE(data), TRIM(deposito)
     ORDER BY DATE(data) DESC
     LIMIT ?`,
    [normalized, fromDate, toDate, safeLimit],
  );

  return rows
    .map((row) => ({
      date: row.date,
      externalStoreCode: normalizeStoreCode(row.external_store_code),
      visitors: Number(row.visitors ?? 0),
    }))
    .filter((row) => row.date && row.externalStoreCode.length > 0);
}

export function buildTrafficSummary(rows: ExternalIngressiDailyRow[]): ExternalTrafficSummary {
  if (rows.length === 0) {
    return {
      totalDays: 0,
      nonZeroDays: 0,
      totalVisitors: 0,
      avgVisitors: 0,
      minVisitors: 0,
      maxVisitors: 0,
      weekdayAverages: [],
    };
  }

  let totalVisitors = 0;
  let minVisitors = Number.POSITIVE_INFINITY;
  let maxVisitors = Number.NEGATIVE_INFINITY;
  let nonZeroDays = 0;

  const weekdayBuckets = new Map<number, number[]>();

  for (const row of rows) {
    const visitors = Number.isFinite(row.visitors) ? row.visitors : 0;
    totalVisitors += visitors;
    minVisitors = Math.min(minVisitors, visitors);
    maxVisitors = Math.max(maxVisitors, visitors);
    if (visitors > 0) {
      nonZeroDays += 1;
    }

    const dayOfWeek = toIsoDayOfWeek(row.date);
    const bucket = weekdayBuckets.get(dayOfWeek) ?? [];
    bucket.push(visitors);
    weekdayBuckets.set(dayOfWeek, bucket);
  }

  const weekdayAverages = Array.from({ length: 7 }, (_, idx) => {
    const dayOfWeek = idx + 1;
    const bucket = weekdayBuckets.get(dayOfWeek) ?? [];
    const sum = bucket.reduce((acc, value) => acc + value, 0);
    const avg = bucket.length > 0 ? sum / bucket.length : 0;

    return {
      dayOfWeek,
      days: bucket.length,
      avgVisitors: Number(avg.toFixed(2)),
    };
  });

  return {
    totalDays: rows.length,
    nonZeroDays,
    totalVisitors: Number(totalVisitors.toFixed(2)),
    avgVisitors: Number((totalVisitors / rows.length).toFixed(2)),
    minVisitors: Number(minVisitors.toFixed(2)),
    maxVisitors: Number(maxVisitors.toFixed(2)),
    weekdayAverages,
  };
}

function detectAffluenceLevel(requiredStaff: number): AffluenceLevel {
  if (requiredStaff <= 2) return 'low';
  if (requiredStaff <= 4) return 'medium';
  return 'high';
}

export function buildAffluenceRecommendations(rows: ExternalIngressiDailyRow[]): ExternalAffluenceRecommendationRow[] {
  if (rows.length === 0) {
    return [];
  }

  const visitorsPerStaff = parseVisitorsPerStaff();
  const summary = buildTrafficSummary(rows);
  const weekdayAvgMap = new Map<number, number>();
  for (const row of summary.weekdayAverages) {
    weekdayAvgMap.set(row.dayOfWeek, row.days > 0 ? row.avgVisitors : 0);
  }

  const output: ExternalAffluenceRecommendationRow[] = [];

  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
    const dayAvgVisitors = weekdayAvgMap.get(dayOfWeek) ?? 0;
    for (const slot of SLOT_DISTRIBUTION) {
      const estimatedVisitors = Number((dayAvgVisitors * slot.weight).toFixed(2));
      const requiredStaff = estimatedVisitors <= 0
        ? 0
        : Math.max(1, Math.ceil(estimatedVisitors / visitorsPerStaff));

      output.push({
        dayOfWeek,
        timeSlot: slot.timeSlot,
        estimatedVisitors,
        level: detectAffluenceLevel(requiredStaff),
        requiredStaff,
      });
    }
  }

  return output;
}
