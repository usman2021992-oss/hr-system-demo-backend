import { applyReductionFloor } from '../license.service';

/**
 * A scheduled reduction is checked against usage when the admin asks for it,
 * and applied a whole period later. These cover what happens when usage has
 * moved in between — the case where a company could end up with more active
 * people than licences.
 */
describe('applyReductionFloor', () => {
  const base = {
    currentSeats: 10,
    currentDevices: 4,
    requestedSeats: null as number | null,
    requestedDevices: null as number | null,
    inUseEmployees: 5,
    inUseTerminals: 2,
  };

  it('applies a reduction in full when usage allows it', () => {
    const out = applyReductionFloor({ ...base, requestedSeats: 7, inUseEmployees: 6 });
    expect(out.seats).toBe(7);
    expect(out.seatsCapped).toBe(false);
    expect(out.keepPendingSeats).toBeNull();
  });

  it('never drops below the people actually active, and keeps the request pending', () => {
    // 10 licences, asked to go to 7, but 10 employees are active again.
    const out = applyReductionFloor({ ...base, requestedSeats: 7, inUseEmployees: 10 });
    expect(out.seats).toBe(10);
    expect(out.seatsCapped).toBe(true);
    expect(out.keepPendingSeats).toBe(7);
  });

  it('applies as much of the reduction as usage allows', () => {
    const out = applyReductionFloor({ ...base, requestedSeats: 5, inUseEmployees: 8 });
    expect(out.seats).toBe(8);
    expect(out.seatsCapped).toBe(true);
    expect(out.keepPendingSeats).toBe(5);
  });

  it('never raises the licences above what was paid for', () => {
    // More active employees than licences (possible on a grandfathered company):
    // the reduction must not hand out licences nobody paid for.
    const out = applyReductionFloor({ ...base, requestedSeats: 7, inUseEmployees: 25 });
    expect(out.seats).toBe(10);
  });

  it('treats employees and terminals independently', () => {
    const out = applyReductionFloor({
      ...base,
      requestedSeats: 7,
      inUseEmployees: 9,   // seats held up
      requestedDevices: 2,
      inUseTerminals: 1,   // terminals free to drop
    });
    expect(out.seats).toBe(9);
    expect(out.seatsCapped).toBe(true);
    expect(out.keepPendingSeats).toBe(7);
    expect(out.devices).toBe(2);
    expect(out.devicesCapped).toBe(false);
    expect(out.keepPendingDevices).toBeNull();
  });

  it('leaves a quantity alone when no reduction was asked for', () => {
    const out = applyReductionFloor({ ...base, requestedSeats: null, requestedDevices: null });
    expect(out.seats).toBe(base.currentSeats);
    expect(out.devices).toBe(base.currentDevices);
    expect(out.seatsCapped).toBe(false);
    expect(out.devicesCapped).toBe(false);
    expect(out.keepPendingSeats).toBeNull();
    expect(out.keepPendingDevices).toBeNull();
  });

  it('is stable when applied twice — the second pass changes nothing', () => {
    const first = applyReductionFloor({ ...base, requestedSeats: 7, inUseEmployees: 10 });
    const second = applyReductionFloor({
      ...base,
      currentSeats: first.seats,
      requestedSeats: first.keepPendingSeats,
      inUseEmployees: 10,
    });
    expect(second.seats).toBe(first.seats);
    expect(second.keepPendingSeats).toBe(7);
  });

  it('finishes the job once the counts come down', () => {
    const capped = applyReductionFloor({ ...base, requestedSeats: 7, inUseEmployees: 10 });
    const later = applyReductionFloor({
      ...base,
      currentSeats: capped.seats,
      requestedSeats: capped.keepPendingSeats,
      inUseEmployees: 6,
    });
    expect(later.seats).toBe(7);
    expect(later.seatsCapped).toBe(false);
    expect(later.keepPendingSeats).toBeNull();
  });
});
