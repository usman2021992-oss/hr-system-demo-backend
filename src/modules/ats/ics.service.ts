import { createEvent, EventAttributes } from 'ics';
import { randomUUID } from 'crypto';

export interface ICSEventOptions {
  uid?: string;
  title: string;
  description?: string;
  location?: string;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  startDate: Date;
  durationMinutes?: number;
}

export interface ICSResult {
  icsContent: string;
  uid: string;
}

export function generateICSEvent(options: ICSEventOptions): ICSResult {
  const uid = options.uid ?? `interview-${randomUUID()}`;
  const start = options.startDate;
  const durationMinutes = options.durationMinutes ?? 60;

  const eventAttrs: EventAttributes = {
    uid,
    title: options.title,
    description: options.description,
    location: options.location,
    start: [
      start.getUTCFullYear(),
      (start.getUTCMonth() + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
    ],
    startInputType: 'utc',
    startOutputType: 'utc',
    duration: { minutes: durationMinutes },
    ...(options.organizerEmail
      ? { organizer: { email: options.organizerEmail, name: options.organizerName ?? options.organizerEmail } }
      : {}),
    ...(options.attendeeEmail
      ? { attendees: [{ email: options.attendeeEmail, name: options.attendeeName ?? options.attendeeEmail }] }
      : {}),
  };

  const { error, value } = createEvent(eventAttrs);
  if (error || !value) {
    throw new Error(`Failed to generate ICS event: ${error?.message ?? 'unknown error'}`);
  }

  return { icsContent: value, uid };
}
