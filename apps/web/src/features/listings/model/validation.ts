import { LISTING_CONSTRAINTS, type ListingKind } from '@/features/listings/model/types';

export function getListingKindError(value: ListingKind | null): string | null {
  if (!value) {
    return 'Choose whether you lost or found the item.';
  }

  return null;
}

export function getListingTitleError(value: string): string | null {
  const title = value.trim();

  if (!title) {
    return 'Enter a title.';
  }

  if (title.length < LISTING_CONSTRAINTS.titleMinLength) {
    return `Title must be at least ${LISTING_CONSTRAINTS.titleMinLength} characters.`;
  }

  if (title.length > LISTING_CONSTRAINTS.titleMaxLength) {
    return `Title must be ${LISTING_CONSTRAINTS.titleMaxLength} characters or fewer.`;
  }

  return null;
}

export function getListingDescriptionError(value: string): string | null {
  const description = value.trim();

  if (!description) {
    return 'Enter a description.';
  }

  if (description.length > LISTING_CONSTRAINTS.descriptionMaxLength) {
    return `Description must be ${LISTING_CONSTRAINTS.descriptionMaxLength} characters or fewer.`;
  }

  return null;
}

export function getListingLocationError(value: string): string | null {
  const location = value.trim();

  if (!location) {
    return 'Enter a location.';
  }

  if (location.length < LISTING_CONSTRAINTS.locationMinLength) {
    return `Location must be at least ${LISTING_CONSTRAINTS.locationMinLength} characters.`;
  }

  if (location.length > LISTING_CONSTRAINTS.locationMaxLength) {
    return `Location must be ${LISTING_CONSTRAINTS.locationMaxLength} characters or fewer.`;
  }

  return null;
}

export function getListingOccurredOnError(value: string): string | null {
  if (!value) {
    return 'Enter the date the item was lost or found.';
  }

  return null;
}
