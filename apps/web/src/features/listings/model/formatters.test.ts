import { describe, expect, it } from 'vitest';

import { formatListingDate } from '@/features/listings/model/formatters';

describe('formatListingDate', () => {
  it('formats a date-only listing value without a timezone shift', () => {
    expect(formatListingDate('2026-09-01')).toBe('September 1, 2026');
  });
});
