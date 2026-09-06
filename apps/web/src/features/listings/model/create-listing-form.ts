import type { CreateListingInput, ListingKind } from '@/features/listings/model/types';
import {
  toUpdateListingInput,
  validateEditableListingFields,
} from '@/features/listings/model/editable-listing-form';
import { getListingKindError } from '@/features/listings/model/validation';

export type CreateListingFormValues = Omit<CreateListingInput, 'kind'> & {
  kind: ListingKind | null;
};

export type CreateListingFormField = keyof CreateListingFormValues;

export type CreateListingFormErrors = Partial<Record<CreateListingFormField, string>>;

export function createInitialListingFormValues(
  initialKind: ListingKind | null,
): CreateListingFormValues {
  return {
    kind: initialKind,
    title: '',
    description: '',
    location: '',
    occurredOn: '',
  };
}

export function validateCreateListingForm(
  values: CreateListingFormValues,
): CreateListingFormErrors {
  const errors: CreateListingFormErrors = validateEditableListingFields(values);

  const kindError = getListingKindError(values.kind);

  if (kindError) {
    errors.kind = kindError;
  }

  return errors;
}

export function toCreateListingInput(values: CreateListingFormValues): CreateListingInput | null {
  if (!values.kind) {
    return null;
  }

  return {
    kind: values.kind,
    ...toUpdateListingInput(values),
  };
}
