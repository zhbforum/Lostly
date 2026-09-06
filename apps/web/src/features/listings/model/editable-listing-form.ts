import type { UpdateListingInput } from '@/features/listings/model/types';
import {
  getListingDescriptionError,
  getListingLocationError,
  getListingOccurredOnError,
  getListingTitleError,
} from '@/features/listings/model/validation';

export type EditableListingFormField = keyof UpdateListingInput;
export type EditableListingFormErrors = Partial<Record<EditableListingFormField, string>>;

const validators = {
  title: getListingTitleError,
  description: getListingDescriptionError,
  location: getListingLocationError,
  occurredOn: getListingOccurredOnError,
} satisfies Record<EditableListingFormField, (value: string) => string | null>;

export function validateEditableListingFields(
  values: UpdateListingInput,
): EditableListingFormErrors {
  const errors: EditableListingFormErrors = {};
  for (const field of Object.keys(validators) as EditableListingFormField[]) {
    const error = validators[field](values[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

export function toEditableValues(listing: UpdateListingInput): UpdateListingInput {
  return {
    title: listing.title,
    description: listing.description,
    location: listing.location,
    occurredOn: listing.occurredOn,
  };
}

export function toUpdateListingInput(values: UpdateListingInput): UpdateListingInput {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    location: values.location.trim(),
    occurredOn: values.occurredOn,
  };
}
