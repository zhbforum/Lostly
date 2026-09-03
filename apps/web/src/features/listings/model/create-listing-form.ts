import type { CreateListingInput, ListingKind } from '@/features/listings/model/types';
import {
  getListingDescriptionError,
  getListingKindError,
  getListingLocationError,
  getListingOccurredOnError,
  getListingTitleError,
} from '@/features/listings/model/validation';

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
  const errors: CreateListingFormErrors = {};

  const kindError = getListingKindError(values.kind);
  const titleError = getListingTitleError(values.title);
  const descriptionError = getListingDescriptionError(values.description);
  const locationError = getListingLocationError(values.location);
  const occurredOnError = getListingOccurredOnError(values.occurredOn);

  if (kindError) {
    errors.kind = kindError;
  }

  if (titleError) {
    errors.title = titleError;
  }

  if (descriptionError) {
    errors.description = descriptionError;
  }

  if (locationError) {
    errors.location = locationError;
  }

  if (occurredOnError) {
    errors.occurredOn = occurredOnError;
  }

  return errors;
}

export function toCreateListingInput(values: CreateListingFormValues): CreateListingInput | null {
  if (!values.kind) {
    return null;
  }

  return {
    kind: values.kind,
    title: values.title.trim(),
    description: values.description.trim(),
    location: values.location.trim(),
    occurredOn: values.occurredOn,
  };
}
