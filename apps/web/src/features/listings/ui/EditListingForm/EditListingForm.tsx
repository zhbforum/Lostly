import { useEffect, useRef, useState } from 'react';
import { updateListing } from '@/features/listings/api/listings-api';
import { LISTING_CONSTRAINTS, type Listing } from '@/features/listings/model/types';
import {
  toEditableValues,
  toEditableListingInput,
  validateEditableListingFields,
  type EditableListingFormField,
  type EditableListingFormErrors,
} from '@/features/listings/model/editable-listing-form';
import { ApiError } from '@/shared/api/client';
import { useFormDraft } from '@/shared/model/use-form-draft';
import { ListingTextField } from '../ListingFormFields/ListingTextField';
import { ListingTextareaField } from '../ListingFormFields/ListingTextareaField';
import { ListingDateField } from '../ListingFormFields/ListingDateField/ListingDateField';
import { ListingFormErrorSummary } from '../ListingFormFields/ListingFormErrorSummary';
import styles from '../ListingFormFields/ListingForm.module.css';

const ids: Record<EditableListingFormField, string> = {
  title: 'edit-title',
  description: 'edit-description',
  location: 'edit-location',
  occurredOn: 'edit-occurred-on',
};

interface EditListingFormProps {
  listing: Listing;
  onSaved: (listing: Listing) => void;
}

export function EditListingForm(props: EditListingFormProps) {
  return <ListingEditor key={`${props.listing.id}:${props.listing.version}`} {...props} />;
}

function ListingEditor({ listing, onSaved }: EditListingFormProps) {
  const [values, setValues, discardDraft] = useFormDraft(
    `listing:edit:${listing.id}:${listing.version}`,
    () => toEditableValues(listing),
  );
  const [errors, setErrors] = useState<EditableListingFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const request = useRef<AbortController | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const dateField = useRef<HTMLSpanElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (focusRequest) summary.current?.focus();
  }, [focusRequest]);

  function update(field: EditableListingFormField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (!versionConflict) setSubmitError(null);
    if (submitted) setErrors(validateEditableListingFields(next));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || unavailable || versionConflict) return;
    const nextErrors = validateEditableListingFields(values);
    setSubmitted(true);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length) {
      setFocusRequest((value) => value + 1);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const result = await updateListing(
        listing.id,
        { ...toEditableListingInput(values), expectedVersion: listing.version },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      discardDraft();
      onSaved(result.listing);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'LISTING_VERSION_CONFLICT'
      ) {
        setVersionConflict(true);
        setSubmitError(
          'This report was updated elsewhere. Your input is still here. Copy your changes, then return to the report to review the latest version before editing again.',
        );
      } else if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'LISTING_NOT_EDITABLE'
      ) {
        setUnavailable(true);
        setSubmitError(
          'This report can no longer be edited because its status has changed. Return to the report to see its current status.',
        );
      } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setUnavailable(true);
        setSubmitError(
          'This report is no longer available for editing. Return to the report to check its current state.',
        );
      } else {
        setSubmitError('We could not save your changes. Your input is still here. Try again.');
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  const disabled = pending || unavailable;
  return (
    <form className={styles.form} noValidate onSubmit={save} aria-busy={pending}>
      <div>
        <h2 className={styles.formSectionTitle}>
          {listing.kind === 'lost' ? 'Lost item' : 'Found item'}
        </h2>
        <p className={styles.formSectionDescription}>
          Report type cannot be changed after publication.
        </p>
      </div>
      <ListingFormErrorSummary
        ref={summary}
        errors={(Object.keys(errors) as EditableListingFormField[]).map((field) => ({
          fieldId: ids[field],
          message: errors[field]!,
        }))}
        onFocusField={(id) =>
          id === ids.occurredOn ? dateField.current?.focus() : document.getElementById(id)?.focus()
        }
      />
      <ListingTextField
        id={ids.title}
        name="title"
        label="Title"
        value={values.title}
        error={errors.title ?? null}
        disabled={disabled}
        onChange={(event) => update('title', event.target.value)}
      />
      <ListingTextareaField
        id={ids.description}
        name="description"
        label="Description"
        hint="Keep private proof of ownership out of the report."
        value={values.description}
        error={errors.description ?? null}
        maxLength={LISTING_CONSTRAINTS.descriptionMaxLength}
        disabled={disabled}
        onChange={(event) => update('description', event.target.value)}
      />
      <ListingTextField
        id={ids.location}
        name="location"
        label="Location"
        value={values.location}
        error={errors.location ?? null}
        disabled={disabled}
        onChange={(event) => update('location', event.target.value)}
      />
      <ListingDateField
        id={ids.occurredOn}
        name="occurredOn"
        label="Date"
        value={values.occurredOn}
        error={errors.occurredOn ?? null}
        disabled={disabled}
        focusRef={dateField}
        onChange={(value) => update('occurredOn', value)}
      />
      {submitError && (
        <div className={styles.submitError} role="alert">
          {submitError}
        </div>
      )}
      <div className={styles.formActions}>
        <button className={styles.submit} type="submit" disabled={disabled || versionConflict}>
          {pending ? 'Saving changes…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
