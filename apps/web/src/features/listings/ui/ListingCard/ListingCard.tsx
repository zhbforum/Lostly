import { Link, useLocation } from 'react-router';

import { formatListingDate } from '@/features/listings/model/formatters';
import type { Listing } from '@/features/listings/model/types';
import styles from './ListingCard.module.css';

interface ListingCardProps {
  listing: Listing;
}

function getKindLabel(kind: Listing['kind']): string {
  return kind === 'lost' ? 'Lost item' : 'Found item';
}

export function ListingCard({ listing }: ListingCardProps) {
  const location = useLocation();
  return (
    <li>
      <Link
        className={styles.card}
        to={`/listings/${listing.id}`}
        state={{
          returnTo: location.pathname + location.search,
          returnPagination: location.state?.pagination,
        }}
      >
        <div className={styles.header}>
          <span className={listing.kind === 'lost' ? styles.lostBadge : styles.foundBadge}>
            {getKindLabel(listing.kind)}
          </span>
          <span className={styles.status}>
            {listing.status === 'active'
              ? 'Active'
              : listing.status === 'resolved'
                ? 'Resolved'
                : 'Archived'}
          </span>
        </div>

        <h3 className={styles.title}>{listing.title}</h3>
        <p className={styles.description}>{listing.description}</p>

        <dl className={styles.metadata}>
          <div>
            <dt>Location</dt>
            <dd>{listing.location}</dd>
          </div>
          <div>
            <dt>{listing.kind === 'lost' ? 'Lost on' : 'Found on'}</dt>
            <dd>{formatListingDate(listing.occurredOn)}</dd>
          </div>
        </dl>

        <span className={styles.viewAction}>
          View report <span aria-hidden="true">→</span>
        </span>
      </Link>
    </li>
  );
}
