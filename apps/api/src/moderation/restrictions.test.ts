import { expect, test } from 'bun:test';
import { accountRestriction } from './restrictions';

test('temporary restrictions expire exactly at their deadline and permanent ones do not', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const record = {
    suspendedPermanently: false,
    suspendedUntil: null as Date | null,
    suspensionReason: null as string | null,
  };
  expect(accountRestriction(record, now)).toBeNull();
  expect(accountRestriction({ ...record, suspendedUntil: now }, now)).toBeNull();
  expect(
    accountRestriction(
      {
        ...record,
        suspendedUntil: new Date(now.getTime() + 1),
        suspensionReason: 'Public decision',
      },
      now,
    ),
  ).toEqual({ reason: 'Public decision', until: '2026-10-24T10:00:00.001Z' });
  expect(
    accountRestriction({ ...record, suspendedPermanently: true, suspendedUntil: new Date(0) }, now),
  ).toMatchObject({ until: null });
});
