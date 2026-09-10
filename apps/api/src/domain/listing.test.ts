import { describe, expect, test } from 'bun:test';
import { canArchiveListing, canEditListing, canResolveListing } from '@/domain/listing';

describe('listing owner transitions', () => {
  test.each([
    { status: 'active', edit: true, resolve: true, archive: true },
    { status: 'resolved', edit: false, resolve: false, archive: true },
    { status: 'archived', edit: false, resolve: false, archive: false },
  ] as const)('$status', ({ status, edit, resolve, archive }) => {
    expect(canEditListing(status)).toBe(edit);
    expect(canResolveListing(status)).toBe(resolve);
    expect(canArchiveListing(status)).toBe(archive);
  });
});
