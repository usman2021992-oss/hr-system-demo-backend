/**
 * Thresholds turn raw numbers into "this needs attention".
 *
 * Defaults mirror the tolerances the inline anomaly engine already applied
 * (late > 5 min, escalating at > 30 min) so switching a report to the KPI
 * layout does not silently change which events are considered anomalous.
 *
 * Every value is overridable per-company via report_configurations.thresholds.
 */

export type RagStatus = 'green' | 'amber' | 'red';

export interface ReportThresholds {
  /** Minutes late before a check-in counts as an anomaly at all. */
  lateArrivalMinutes: number;
  /** Minutes late before that anomaly escalates to high severity. */
  lateArrivalCriticalMinutes: number;
  /** Minutes early before a check-out counts as an anomaly. */
  earlyDepartureMinutes: number;
  /** Minutes early before that anomaly escalates to high severity. */
  earlyDepartureCriticalMinutes: number;
  /** Anomalies at a single store, within the period, before the store is flagged. */
  storeAnomalyAmber: number;
  storeAnomalyRed: number;
  /** Absence rate (%) across the period. */
  absenceRateAmber: number;
  absenceRateRed: number;
  /** Shift coverage (%) below which a store is flagged. Lower is worse. */
  shiftCoverageAmber: number;
  shiftCoverageRed: number;
  /** Days remaining before a contract expiry is surfaced / urgent. */
  contractExpiryAmber: number;
  contractExpiryRed: number;
  /** Days remaining before a training or medical-check expiry is surfaced / urgent. */
  complianceExpiryAmber: number;
  complianceExpiryRed: number;
  /** Leave requests left pending, in days, before they are flagged. */
  pendingLeaveAgeAmber: number;
  pendingLeaveAgeRed: number;
  /** Monthly turnover (%) tolerated before flagging. */
  turnoverAmber: number;
  turnoverRed: number;
  /** ATS candidates stalled in one stage, in days. */
  candidateStallAmber: number;
  candidateStallRed: number;
}

export const DEFAULT_THRESHOLDS: ReportThresholds = {
  lateArrivalMinutes: 5,
  lateArrivalCriticalMinutes: 30,
  earlyDepartureMinutes: 5,
  earlyDepartureCriticalMinutes: 30,
  storeAnomalyAmber: 5,
  storeAnomalyRed: 15,
  absenceRateAmber: 5,
  absenceRateRed: 10,
  shiftCoverageAmber: 90,
  shiftCoverageRed: 75,
  contractExpiryAmber: 60,
  contractExpiryRed: 30,
  complianceExpiryAmber: 45,
  complianceExpiryRed: 15,
  pendingLeaveAgeAmber: 3,
  pendingLeaveAgeRed: 7,
  turnoverAmber: 5,
  turnoverRed: 10,
  candidateStallAmber: 7,
  candidateStallRed: 14,
};

/**
 * Merges a persisted override blob over the defaults, discarding anything
 * that is not a finite number so a malformed JSONB column cannot produce
 * NaN thresholds (which would silently classify everything as green).
 */
export function resolveThresholds(overrides: unknown): ReportThresholds {
  const resolved: ReportThresholds = { ...DEFAULT_THRESHOLDS };
  if (!overrides || typeof overrides !== 'object') return resolved;

  const raw = overrides as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof ReportThresholds)[]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Classifies a value where a HIGHER number is worse (anomalies, absence, turnover).
 */
export function ragAscending(value: number, amber: number, red: number): RagStatus {
  if (value >= red) return 'red';
  if (value >= amber) return 'amber';
  return 'green';
}

/**
 * Classifies a value where a LOWER number is worse (coverage %, days remaining).
 */
export function ragDescending(value: number, amber: number, red: number): RagStatus {
  if (value <= red) return 'red';
  if (value <= amber) return 'amber';
  return 'green';
}

/** Ordering for the exceptions page: worst first. */
export const RAG_SEVERITY_RANK: Record<RagStatus, number> = { red: 0, amber: 1, green: 2 };
