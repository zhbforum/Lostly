import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import { formatListingDate } from '@/features/listings/model/formatters';
import type { Listing } from '@/features/listings/model/types';
import styles from '@/features/listings/ui/ListingCreationSuccess/ListingCreationSuccess.module.css';

interface ListingCreationSuccessProps {
  listing: Listing;
  onCreateAnother: () => void;
}

function getKindLabel(listing: Listing): string {
  return listing.kind === 'lost' ? 'Lost item report' : 'Found item report';
}

export function ListingCreationSuccess({ listing, onCreateAnother }: ListingCreationSuccessProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className={styles.success} aria-labelledby="listing-created-heading">
      <div className={styles.icon} aria-hidden="true">
        ✓
      </div>

      <div className={styles.header}>
        <p className={styles.eyebrow}>{getKindLabel(listing)}</p>

        <h2 className={styles.title} id="listing-created-heading" ref={headingRef} tabIndex={-1}>
          Your report was created.
        </h2>

        <p className={styles.description}>Your item details have been saved.</p>
      </div>

      <dl className={styles.summary}>
        <div className={styles.summaryRow}>
          <dt>Item</dt>
          <dd>{listing.title}</dd>
        </div>

        <div className={styles.summaryRow}>
          <dt>Location</dt>
          <dd>{listing.location}</dd>
        </div>

        <div className={styles.summaryRow}>
          <dt>Date</dt>
          <dd>{formatListingDate(listing.occurredOn)}</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <Link className={styles.primaryAction} to={`/listings/${listing.id}`}>
          View report
        </Link>

        <button className={styles.secondaryAction} type="button" onClick={onCreateAnother}>
          Create another report
        </button>

        <Link className={styles.textAction} to="/">
          Back to home
        </Link>
      </div>
    </section>
  );
}
