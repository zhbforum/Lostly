import { describe, expect, it } from 'vitest';

import { LISTING_CONSTRAINTS } from '@/features/listings/model/types';
import {
  getListingDescriptionError,
  getListingLocationError,
  getListingOccurredOnError,
  getListingTitleError,
  getListingKindError,
} from '@/features/listings/model/validation';

describe('getListingTitleError', () => {
  it('requires a title', () => {
    expect(getListingTitleError('')).toBe('Enter a title.');
    expect(getListingTitleError('   ')).toBe('Enter a title.');
  });

  it('rejects a title shorter than the minimum length', () => {
    expect(getListingTitleError('a'.repeat(LISTING_CONSTRAINTS.titleMinLength - 1))).toBe(
      `Title must be at least ${LISTING_CONSTRAINTS.titleMinLength} characters.`,
    );
  });

  it('accepts a title at the minimum length', () => {
    expect(getListingTitleError('a'.repeat(LISTING_CONSTRAINTS.titleMinLength))).toBeNull();
  });

  it('trims surrounding whitespace before validating the length', () => {
    expect(
      getListingTitleError(`  ${'a'.repeat(LISTING_CONSTRAINTS.titleMinLength)}  `),
    ).toBeNull();
  });

  it('accepts a title at the maximum length', () => {
    expect(getListingTitleError('a'.repeat(LISTING_CONSTRAINTS.titleMaxLength))).toBeNull();
  });

  it('rejects a title longer than the maximum length', () => {
    expect(getListingTitleError('a'.repeat(LISTING_CONSTRAINTS.titleMaxLength + 1))).toBe(
      `Title must be ${LISTING_CONSTRAINTS.titleMaxLength} characters or fewer.`,
    );
  });
});

describe('getListingKindError', () => {
  it('requires a listing kind', () => {
    expect(getListingKindError(null)).toBe('Choose whether you lost or found the item.');
  });

  it('accepts lost and found listing kinds', () => {
    expect(getListingKindError('lost')).toBeNull();
    expect(getListingKindError('found')).toBeNull();
  });
});

describe('getListingDescriptionError', () => {
  it('requires a description', () => {
    expect(getListingDescriptionError('')).toBe('Enter a description.');
    expect(getListingDescriptionError('   ')).toBe('Enter a description.');
  });

  it('accepts a non-empty description', () => {
    expect(getListingDescriptionError('Black backpack.')).toBeNull();
  });

  it('accepts a description at the maximum length', () => {
    expect(
      getListingDescriptionError('a'.repeat(LISTING_CONSTRAINTS.descriptionMaxLength)),
    ).toBeNull();
  });

  it('rejects a description longer than the maximum length', () => {
    expect(
      getListingDescriptionError('a'.repeat(LISTING_CONSTRAINTS.descriptionMaxLength + 1)),
    ).toBe(`Description must be ${LISTING_CONSTRAINTS.descriptionMaxLength} characters or fewer.`);
  });
});

describe('getListingLocationError', () => {
  it('requires a location', () => {
    expect(getListingLocationError('')).toBe('Enter a location.');
    expect(getListingLocationError('   ')).toBe('Enter a location.');
  });

  it('rejects a location shorter than the minimum length', () => {
    expect(getListingLocationError('a'.repeat(LISTING_CONSTRAINTS.locationMinLength - 1))).toBe(
      `Location must be at least ${LISTING_CONSTRAINTS.locationMinLength} characters.`,
    );
  });

  it('accepts a location at the minimum length', () => {
    expect(getListingLocationError('a'.repeat(LISTING_CONSTRAINTS.locationMinLength))).toBeNull();
  });

  it('trims surrounding whitespace before validating the length', () => {
    expect(
      getListingLocationError(`  ${'a'.repeat(LISTING_CONSTRAINTS.locationMinLength)}  `),
    ).toBeNull();
  });

  it('accepts a location at the maximum length', () => {
    expect(getListingLocationError('a'.repeat(LISTING_CONSTRAINTS.locationMaxLength))).toBeNull();
  });

  it('rejects a location longer than the maximum length', () => {
    expect(getListingLocationError('a'.repeat(LISTING_CONSTRAINTS.locationMaxLength + 1))).toBe(
      `Location must be ${LISTING_CONSTRAINTS.locationMaxLength} characters or fewer.`,
    );
  });
});

describe('getListingOccurredOnError', () => {
  it('requires an occurrence date', () => {
    expect(getListingOccurredOnError('')).toBe('Enter the date the item was lost or found.');
  });

  it('accepts a provided occurrence date', () => {
    expect(getListingOccurredOnError('2026-09-01')).toBeNull();
  });

  it.each(['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])(
    'accepts the real calendar date %s',
    (value) => expect(getListingOccurredOnError(value)).toBeNull(),
  );

  it.each([
    ' ',
    '2026-9-01',
    '2026-09-1',
    '09/01/2026',
    '2026-09-01T00:00:00Z',
    '2026-02-29',
    '1900-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '0000-01-01',
  ])('rejects the invalid calendar date %s', (value) => {
    expect(getListingOccurredOnError(value)).toBe('Enter a valid date.');
  });
});
