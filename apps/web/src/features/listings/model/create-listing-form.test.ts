import { describe, expect, it } from 'vitest';

import {
  createInitialListingFormValues,
  toCreateListingInput,
  validateCreateListingForm,
} from '@/features/listings/model/create-listing-form';

describe('createInitialListingFormValues', () => {
  it('creates empty values with the supplied listing kind', () => {
    expect(createInitialListingFormValues('found')).toEqual({
      kind: 'found',
      title: '',
      description: '',
      location: '',
      occurredOn: '',
    });
  });
});

describe('validateCreateListingForm', () => {
  it('returns errors for every invalid field', () => {
    expect(validateCreateListingForm(createInitialListingFormValues(null))).toEqual({
      kind: 'Choose whether you lost or found the item.',
      title: 'Enter a title.',
      description: 'Enter a description.',
      location: 'Enter a location.',
      occurredOn: 'Enter the date the item was lost or found.',
    });
  });
});

describe('toCreateListingInput', () => {
  it('normalizes text values for a valid selected kind', () => {
    expect(
      toCreateListingInput({
        kind: 'lost',
        title: '  Black backpack  ',
        description: '  With a front pocket.  ',
        location: '  TU Berlin  ',
        occurredOn: '2026-09-01',
      }),
    ).toEqual({
      kind: 'lost',
      title: 'Black backpack',
      description: 'With a front pocket.',
      location: 'TU Berlin',
      occurredOn: '2026-09-01',
    });
  });

  it('does not create an API payload without a listing kind', () => {
    expect(
      toCreateListingInput({
        kind: null,
        title: 'Black backpack',
        description: 'With a front pocket.',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      }),
    ).toBeNull();
  });
});
