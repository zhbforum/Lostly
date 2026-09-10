import { useEffect, useRef, useState } from 'react';

import { createListing } from '@/features/listings/api/listings-api';
import { useFormDraft } from '@/shared/model/use-form-draft';
import {
  createInitialListingFormValues,
  toCreateListingInput,
  type CreateListingFormErrors,
  type CreateListingFormField,
  type CreateListingFormValues,
  validateCreateListingForm,
} from '@/features/listings/model/create-listing-form';
import {
  LISTING_CONSTRAINTS,
  type Listing,
  type ListingKind,
} from '@/features/listings/model/types';
import styles from '../ListingFormFields/ListingForm.module.css';
import { ListingDateField } from '../ListingFormFields/ListingDateField/ListingDateField';
import {
  type ListingFormError,
  ListingFormErrorSummary,
} from '../ListingFormFields/ListingFormErrorSummary';
import { ListingKindField } from './_parts/ListingKindField';
import { ListingTextareaField } from '../ListingFormFields/ListingTextareaField';
import { ListingTextField } from '../ListingFormFields/ListingTextField';

interface CreateListingFormProps {
  initialKind?: ListingKind | null;
  onCreated: (listing: Listing) => void;
}

const FIELD_IDS = {
  kind: 'kind-lost',
  title: 'listing-title',
  description: 'listing-description',
  location: 'listing-location',
  occurredOn: 'listing-occurred-on',
} as const satisfies Record<CreateListingFormField, string>;

function getErrorSummary(errors: CreateListingFormErrors): ListingFormError[] {
  const summary: ListingFormError[] = [];

  if (errors.kind) {
    summary.push({
      fieldId: FIELD_IDS.kind,
      message: errors.kind,
    });
  }

  if (errors.title) {
    summary.push({
      fieldId: FIELD_IDS.title,
      message: errors.title,
    });
  }

  if (errors.description) {
    summary.push({
      fieldId: FIELD_IDS.description,
      message: errors.description,
    });
  }

  if (errors.location) {
    summary.push({
      fieldId: FIELD_IDS.location,
      message: errors.location,
    });
  }

  if (errors.occurredOn) {
    summary.push({
      fieldId: FIELD_IDS.occurredOn,
      message: errors.occurredOn,
    });
  }

  return summary;
}

function getLocationHint(kind: ListingKind | null): string {
  if (kind === 'lost') {
    return 'Where did you last see the item?';
  }

  if (kind === 'found') {
    return 'Where did you find the item?';
  }

  return 'Where did you last see or find the item?';
}

function getDateHint(kind: ListingKind | null): string {
  if (kind === 'lost') {
    return 'Choose the closest date you remember losing or last seeing it.';
  }

  if (kind === 'found') {
    return 'Choose the closest date you remember finding it.';
  }

  return 'Choose the closest date you remember.';
}

export function CreateListingForm({ initialKind = null, onCreated }: CreateListingFormProps) {
  const [values, setValues, discardDraft] = useFormDraft<CreateListingFormValues>(
    'listing:new:' + initialKind,
    () => createInitialListingFormValues(initialKind),
  );
  const [errors, setErrors] = useState<CreateListingFormErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errorSummaryFocusRequest, setErrorSummaryFocusRequest] = useState(0);

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const occurredOnRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (errorSummaryFocusRequest === 0) {
      return;
    }

    errorSummaryRef.current?.focus();
  }, [errorSummaryFocusRequest]);

  function focusField(fieldId: string) {
    if (fieldId === FIELD_IDS.occurredOn) {
      occurredOnRef.current?.focus();
      return;
    }

    document.getElementById(fieldId)?.focus();
  }

  function updateField<Field extends CreateListingFormField>(
    field: Field,
    value: CreateListingFormValues[Field],
  ) {
    const nextValues: CreateListingFormValues = {
      ...values,
      [field]: value,
    };

    setValues(nextValues);
    setSubmitError(null);

    if (hasSubmitted) {
      setErrors(validateCreateListingForm(nextValues));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const nextErrors = validateCreateListingForm(values);

    setHasSubmitted(true);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      setErrorSummaryFocusRequest((request) => request + 1);
      return;
    }

    const input = toCreateListingInput(values);

    if (!input) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await createListing(input);

      discardDraft();
      setIsSubmitting(false);
      onCreated(response.listing);
    } catch {
      setIsSubmitting(false);
      setSubmitError('Something went wrong while creating your report. Try again.');
    }
  }

  const errorSummary = getErrorSummary(errors);

  return (
    <form className={styles.form} noValidate aria-busy={isSubmitting} onSubmit={handleSubmit}>
      <ListingFormErrorSummary
        ref={errorSummaryRef}
        errors={errorSummary}
        onFocusField={focusField}
      />

      <ListingKindField
        name="kind"
        value={values.kind}
        error={errors.kind ?? null}
        disabled={isSubmitting}
        onChange={(kind) => updateField('kind', kind)}
      />

      <div className={styles.sectionDivider} aria-hidden="true" />

      <section className={styles.formSection} aria-labelledby="listing-about-item-heading">
        <header className={styles.formSectionHeader}>
          <h2 className={styles.formSectionTitle} id="listing-about-item-heading">
            About the item
          </h2>

          <p className={styles.formSectionDescription}>
            Give people enough detail to recognize the item without sharing information that should
            stay private.
          </p>
        </header>

        <ListingTextField
          id={FIELD_IDS.title}
          name="title"
          label="Title"
          hint="A short description people can recognize quickly."
          error={errors.title ?? null}
          value={values.title}
          disabled={isSubmitting}
          onChange={(event) => updateField('title', event.target.value)}
        />

        <ListingTextareaField
          id={FIELD_IDS.description}
          name="description"
          label="Description"
          hint="Describe its appearance and useful identifying details. Keep private proof of ownership out of the report."
          error={errors.description ?? null}
          value={values.description}
          maxLength={LISTING_CONSTRAINTS.descriptionMaxLength}
          disabled={isSubmitting}
          onChange={(event) => updateField('description', event.target.value)}
        />
      </section>

      <div className={styles.sectionDivider} aria-hidden="true" />

      <section className={styles.formSection} aria-labelledby="listing-place-time-heading">
        <header className={styles.formSectionHeader}>
          <h2 className={styles.formSectionTitle} id="listing-place-time-heading">
            Where and when
          </h2>

          <p className={styles.formSectionDescription}>
            Add the best location and date you remember. An approximate location is fine if you are
            not sure.
          </p>
        </header>

        <ListingTextField
          id={FIELD_IDS.location}
          name="location"
          label="Location"
          hint={getLocationHint(values.kind)}
          error={errors.location ?? null}
          value={values.location}
          disabled={isSubmitting}
          onChange={(event) => updateField('location', event.target.value)}
        />

        <ListingDateField
          id={FIELD_IDS.occurredOn}
          name="occurredOn"
          label="Date"
          hint={getDateHint(values.kind)}
          error={errors.occurredOn ?? null}
          value={values.occurredOn}
          disabled={isSubmitting}
          focusRef={occurredOnRef}
          onChange={(value) => updateField('occurredOn', value)}
        />
      </section>

      {submitError && (
        <div className={styles.submitError} role="alert">
          <p className={styles.submitErrorTitle}>We couldn&apos;t create your report.</p>
          <p className={styles.submitErrorDescription}>{submitError}</p>
        </div>
      )}

      <div className={styles.formActions}>
        <button className={styles.submit} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating report…' : 'Create report'}
        </button>
      </div>
    </form>
  );
}
