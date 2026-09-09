import {
  parseRejectionReason,
  serializeRejectionReason,
  isRejectionReasonCode,
  REJECTION_REASON_CODES,
} from '../rejectionReasons';

describe('rejection reason codes', () => {
  it('exposes exactly the agreed closed list', () => {
    expect([...REJECTION_REASON_CODES]).toEqual([
      'not_suitable',
      'insufficient_experience',
      'salary_expectations',
      'not_available',
      'other',
    ]);
  });

  it('rejects anything outside the list', () => {
    expect(isRejectionReasonCode('non idoneo')).toBe(false);
    expect(isRejectionReasonCode('')).toBe(false);
    expect(isRejectionReasonCode(undefined)).toBe(false);
    expect(isRejectionReasonCode('not_suitable')).toBe(true);
  });
});

describe('legacy values already on the live server', () => {
  // The five spellings reported from production. They must aggregate as one.
  const REPORTED_VARIANTS = [
    'non idoneo',
    "Non e' idoneo",
    'non idonea',
    'Non idoneo',
    'NON IDONEA',
  ];

  it('folds every reported spelling onto a single code', () => {
    const codes = REPORTED_VARIANTS.map((v) => parseRejectionReason(v).code);

    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe('not_suitable');
  });

  it('marks them as legacy and keeps the original wording', () => {
    const parsed = parseRejectionReason("Non e' idoneo");

    expect(parsed.legacy).toBe(true);
    expect(parsed.note).toBe("Non e' idoneo");
  });

  it('leaves an unrecognised phrase readable instead of discarding it', () => {
    const parsed = parseRejectionReason('ha accettato altra offerta');

    expect(parsed.code).toBeNull();
    expect(parsed.note).toBe('ha accettato altra offerta');
    expect(parsed.legacy).toBe(true);
  });
});

describe('round trip', () => {
  it('stores a plain code for every reason except "other"', () => {
    expect(serializeRejectionReason('salary_expectations')).toBe('salary_expectations');
    expect(parseRejectionReason('salary_expectations')).toEqual({
      code: 'salary_expectations',
      note: null,
      legacy: false,
    });
  });

  it('carries the free-text note for "other"', () => {
    const stored = serializeRejectionReason('other', '  Ha rifiutato la sede  ');

    expect(stored).toBe('other:Ha rifiutato la sede');
    expect(parseRejectionReason(stored)).toEqual({
      code: 'other',
      note: 'Ha rifiutato la sede',
      legacy: false,
    });
  });

  it('handles a note containing a colon', () => {
    const stored = serializeRejectionReason('other', 'Motivo: sede troppo lontana');

    expect(parseRejectionReason(stored).note).toBe('Motivo: sede troppo lontana');
  });

  it('treats an empty reason as absent', () => {
    expect(parseRejectionReason(null)).toEqual({ code: null, note: null, legacy: false });
    expect(parseRejectionReason('   ')).toEqual({ code: null, note: null, legacy: false });
  });
});
