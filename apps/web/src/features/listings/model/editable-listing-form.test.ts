import { describe, expect, it } from 'vitest';
import { validateCreateListingForm } from './create-listing-form';
import {
  toEditableValues,
  toEditableListingInput,
  validateEditableListingFields,
} from './editable-listing-form';
import { ownerReport } from '@/test/fixtures/listing-management';

describe('editable listing fields', () => {
  it('uses the same validation for create and edit, with kind remaining create-only', () => {
    const values = { title: ' ', description: '', location: ' ', occurredOn: '2026-02-30' };
    const errors = {
      title: 'Enter a title.',
      description: 'Enter a description.',
      location: 'Enter a location.',
      occurredOn: 'Enter a valid date.',
    };
    expect(validateEditableListingFields(values)).toEqual(errors);
    expect(validateCreateListingForm({ ...values, kind: 'lost' })).toEqual(errors);
    expect(validateCreateListingForm({ ...values, kind: null })).toEqual({
      ...errors,
      kind: 'Choose whether you lost or found the item.',
    });
    expect(validateEditableListingFields(ownerReport().listing)).toEqual({});
  });

  it('seeds only editable fields and trims them only when preparing the request', () => {
    const listing = {
      ...ownerReport().listing,
      title: '  Blue backpack  ',
      description: '  Red zip  ',
      location: '  Library  ',
    };
    const values = toEditableValues(listing);
    expect(values).toEqual({
      title: listing.title,
      description: listing.description,
      location: listing.location,
      occurredOn: listing.occurredOn,
    });
    expect(toEditableListingInput(values)).toEqual({
      title: 'Blue backpack',
      description: 'Red zip',
      location: 'Library',
      occurredOn: listing.occurredOn,
    });
    expect(values.title).toBe(listing.title);
  });
});
