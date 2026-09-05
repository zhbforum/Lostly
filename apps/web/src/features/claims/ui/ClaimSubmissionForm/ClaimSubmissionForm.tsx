import { useState } from 'react';

import { createClaim } from '@/features/claims/api/claims-api';
import { CLAIM_CONSTRAINTS, type Claim } from '@/features/claims/model/types';
import { ApiError } from '@/shared/api/client';
import { useFormDraft } from '@/shared/model/use-form-draft';
import styles from './ClaimSubmissionForm.module.css';

interface ClaimSubmissionFormProps {
  listingId: string;
  onCreated: (claim: Claim) => void;
}

export function ClaimSubmissionForm({ listingId, onCreated }: ClaimSubmissionFormProps) {
  const [verificationDetails, setVerificationDetails, discardDraft] = useFormDraft(
    'claim:' + listingId,
    () => '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const value = verificationDetails.trim();

    if (value.length < CLAIM_CONSTRAINTS.verificationDetailsMinLength) {
      setValidationError(
        `Please provide at least ${CLAIM_CONSTRAINTS.verificationDetailsMinLength} characters.`,
      );
      return;
    }

    setValidationError(null);
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await createClaim(listingId, { verificationDetails: value });

      discardDraft();
      onCreated(response.claim);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : 'We could not submit your claim. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="claim-form-heading">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Private verification</p>
        <h2 id="claim-form-heading">Is this your item?</h2>
        <p>
          Tell the finder details that only the owner is likely to know. This answer is not shown in
          the public report.
        </p>
      </header>

      <form noValidate aria-busy={isSubmitting} onSubmit={handleSubmit}>
        <label className={styles.field} htmlFor="claim-verification-details">
          <span>Proof of ownership</span>
          <textarea
            id="claim-verification-details"
            value={verificationDetails}
            disabled={isSubmitting}
            maxLength={CLAIM_CONSTRAINTS.verificationDetailsMaxLength}
            aria-describedby={validationError ? 'claim-verification-error' : undefined}
            aria-invalid={validationError ? true : undefined}
            onChange={(event) => {
              setVerificationDetails(event.target.value);
              setValidationError(null);
              setSubmitError(null);
            }}
          />
          <span className={styles.hint}>
            For example: a distinguishing mark, the contents, or where you last used it. Do not
            share passwords or financial information.
          </span>
        </label>

        {validationError && (
          <p className={styles.error} id="claim-verification-error" role="alert">
            {validationError}
          </p>
        )}

        {submitError && (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting claim…' : 'Submit private claim'}
        </button>
      </form>
    </section>
  );
}
