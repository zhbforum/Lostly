import type { Ref } from 'react';

import { formatListingDate } from '@/features/listings/model/formatters';
import type { Listing } from '@/features/listings/model/types';
import styles from '@/features/listings/ui/ListingDetails/ListingDetails.module.css';

interface ListingDetailsProps {
  listing: Listing;
  titleRef?: Ref<HTMLHeadingElement>;
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function getKindLabel(listing: Listing): string {
  return listing.kind === 'lost' ? 'Lost item' : 'Found item';
}

function getOccurredOnLabel(listing: Listing): string {
  return listing.kind === 'lost' ? 'Lost on' : 'Found on';
}

function getStatusLabel(listing: Listing): string {
  switch (listing.status) {
    case 'active':
      return 'Active';
    case 'resolved':
      return 'Resolved';
    case 'archived':
      return 'Archived';
  }
}

export function ListingDetails({ listing, titleRef }: ListingDetailsProps) {
  return (
    <article className={styles.details} aria-labelledby="listing-details-title">
      <header className={styles.header}>
        <div className={styles.badges}>
          <span className={styles.kindBadge}>{getKindLabel(listing)}</span>
          <span className={styles.statusBadge}>{getStatusLabel(listing)}</span>
        </div>

        <h1 className={styles.title} id="listing-details-title" ref={titleRef} tabIndex={-1}>
          {listing.title}
        </h1>

        <p className={styles.reportedAt}>Reported {formatCreatedAt(listing.createdAt)}</p>
      </header>

      <section className={styles.descriptionSection} aria-labelledby="listing-description-heading">
        <h2 className={styles.sectionTitle} id="listing-description-heading">
          Item details
        </h2>

        <p className={styles.description}>{listing.description}</p>
      </section>

      <dl className={styles.metadata}>
        <div className={styles.metadataItem}>
          <dt>Location</dt>
          <dd>{listing.location}</dd>
        </div>

        <div className={styles.metadataItem}>
          <dt>{getOccurredOnLabel(listing)}</dt>
          <dd>{formatListingDate(listing.occurredOn)}</dd>
        </div>
      </dl>
    </article>
  );
}
