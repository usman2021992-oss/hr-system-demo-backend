// ---------------------------------------------------------------------------
// Candidate rejection reasons
//
// The reason arrived as an unvalidated free string, so the same reason reached
// the database five ways — "non idoneo", "Non e' idoneo", "non idonea",
// "Non idoneo", "NON IDONEA" — and could not be counted in a report.
//
// The fix stores a closed set of codes in the existing candidates.rejection_reason
// column. No schema change: the column is TEXT and already holds free text, so
// codes coexist with the legacy phrases already on the live server.
//
// Rows written before this change keep their original wording. normaliseLegacy()
// maps those phrases onto the same codes when they are read, so aggregation is
// correct across the whole table without rewriting a single live row.
//
// This mirrors utils/salaryPeriod.ts, where English tokens and legacy Italian
// phrases share one column and one parser.
// ---------------------------------------------------------------------------

export const REJECTION_REASON_CODES = [
  'not_suitable',
  'insufficient_experience',
  'salary_expectations',
  'not_available',
  'other',
] as const;

export type RejectionReasonCode = typeof REJECTION_REASON_CODES[number];

export function isRejectionReasonCode(value: unknown): value is RejectionReasonCode {
  return typeof value === 'string' && (REJECTION_REASON_CODES as readonly string[]).includes(value);
}

/**
 * "other" carries the note the user typed. Everything else is the bare code, so
 * a GROUP BY on the column aggregates without any parsing.
 */
const OTHER_PREFIX = 'other:';

export interface ParsedRejectionReason {
  /** null only when the stored text matches no known code or legacy phrase. */
  code: RejectionReasonCode | null;
  /** Free-text note. Populated for "other", and for unrecognised legacy rows. */
  note: string | null;
  /** True when the value predates the closed list and was mapped on read. */
  legacy: boolean;
}

export function serializeRejectionReason(code: RejectionReasonCode, note?: string | null): string {
  const trimmed = (note ?? '').trim();
  return code === 'other' && trimmed ? `${OTHER_PREFIX}${trimmed}` : code;
}

/**
 * Legacy free text → code. Keys are already normalised by normaliseKey().
 * Extend this list rather than editing live rows.
 */
const LEGACY_REASON_MAP: Record<string, RejectionReasonCode> = {
  'non idoneo': 'not_suitable',
  'non idonea': 'not_suitable',
  'non e idoneo': 'not_suitable',
  'non e idonea': 'not_suitable',
  'non adatto': 'not_suitable',
  'non adatta': 'not_suitable',
  'profilo non idoneo': 'not_suitable',
  'not suitable': 'not_suitable',
  'esperienza insufficiente': 'insufficient_experience',
  'poca esperienza': 'insufficient_experience',
  'esperienza non sufficiente': 'insufficient_experience',
  'insufficient experience': 'insufficient_experience',
  'aspettative economiche': 'salary_expectations',
  'aspettative salariali': 'salary_expectations',
  'ral troppo alta': 'salary_expectations',
  'salary expectations': 'salary_expectations',
  'non disponibile': 'not_available',
  'non piu disponibile': 'not_available',
  'indisponibile': 'not_available',
  'not available': 'not_available',
};

/**
 * Lowercase, strip accents and apostrophes, collapse whitespace and trailing
 * punctuation. This is what folds "Non e' idoneo" and "NON IDONEA" together.
 */
// Combining marks left by NFD normalisation, written as escapes so the source
// file stays ASCII-only.
const COMBINING_MARKS = new RegExp("[̀-ͯ]", 'g');

function normaliseKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseLegacy(raw: string): RejectionReasonCode | null {
  return LEGACY_REASON_MAP[normaliseKey(raw)] ?? null;
}

/**
 * Read any stored value — new code, "other:note", or a pre-existing free-text
 * phrase — and return a consistent shape.
 */
export function parseRejectionReason(raw: string | null | undefined): ParsedRejectionReason {
  if (!raw || !raw.trim()) return { code: null, note: null, legacy: false };
  const value = raw.trim();

  if (value.startsWith(OTHER_PREFIX)) {
    const note = value.slice(OTHER_PREFIX.length).trim();
    return { code: 'other', note: note || null, legacy: false };
  }

  if (isRejectionReasonCode(value)) {
    return { code: value, note: null, legacy: false };
  }

  const mapped = normaliseLegacy(value);
  if (mapped) {
    // Keep the original wording visible so nothing is lost in translation.
    return { code: mapped, note: value, legacy: true };
  }

  return { code: null, note: value, legacy: true };
}
