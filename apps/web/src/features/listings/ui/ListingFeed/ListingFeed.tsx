import { useSearchParams } from 'react-router';

import { useListingFeed } from '@/features/listings/model/use-listing-feed';
import {
  LISTING_FEED_SORTS,
  type ListingFeedSort,
  type ListingKind,
} from '@/features/listings/model/types';
import { useCursorNavigation } from '@/shared/model/use-cursor-navigation';
import { Pagination } from '@/shared/ui/Pagination/Pagination';
import { ListingCard } from '@/features/listings/ui/ListingCard/ListingCard';
import styles from './ListingFeed.module.css';

const SORT_OPTIONS: Array<{ value: ListingFeedSort; label: string }> = [
  { value: 'newest', label: 'Newest reports' },
  { value: 'oldest', label: 'Oldest reports' },
  { value: 'occurredOnDesc', label: 'Most recently lost or found' },
  { value: 'occurredOnAsc', label: 'Oldest item date' },
];

export function ListingFeed() {
  const [params] = useSearchParams();
  const navigation = useCursorNavigation();
  const rawKind = params.get('kind');
  const kind = rawKind === 'lost' || rawKind === 'found' ? rawKind : undefined;
  const rawSort = params.get('sort') as ListingFeedSort;
  const sort = LISTING_FEED_SORTS.includes(rawSort) ? rawSort : 'newest';
  const { state, retry } = useListingFeed({ kind, sort, cursor: navigation.cursor ?? null });

  function updateKind(nextKind: ListingKind | undefined) {
    navigation.changeFilters({ kind: nextKind });
  }

  function updateSort(nextSort: ListingFeedSort) {
    navigation.changeFilters({ sort: nextSort });
  }

  return (
    <section className={styles.section} aria-labelledby="listing-feed-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Community reports</p>
          <h1 className={styles.title} id="listing-feed-heading">
            Browse active listings
          </h1>
          <p className={styles.description}>
            Explore current reports and help an item find its way back.
          </p>
        </div>

        <div className={styles.filters} aria-label="Listing filters">
          <label className={styles.filter}>
            <span>Report type</span>
            <select
              value={kind ?? 'all'}
              onChange={(event) =>
                updateKind(
                  event.target.value === 'all' ? undefined : (event.target.value as ListingKind),
                )
              }
            >
              <option value="all">All reports</option>
              <option value="lost">Lost items</option>
              <option value="found">Found items</option>
            </select>
          </label>

          <label className={styles.filter}>
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(event) => updateSort(event.target.value as ListingFeedSort)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {state.status === 'loading' && (
        <div className={styles.status} role="status" aria-live="polite">
          <div className={styles.loader} aria-hidden="true" />
          Loading active reports…
        </div>
      )}

      {state.status === 'error' && (
        <div className={styles.status} role="alert">
          <p>We couldn&apos;t load listings right now.</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
          {navigation.hasPrevious && (
            <button type="button" onClick={navigation.reset}>
              First page
            </button>
          )}
        </div>
      )}

      {state.status === 'success' && (
        <>
          {state.listings.length > 0 ? (
            <ul className={styles.cards} aria-label="Active listings">
              {state.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <h2>No matching active reports</h2>
              <p>Try a different filter, or check back when new reports are posted.</p>
            </div>
          )}

          <Pagination
            pageInfo={state.pageInfo}
            hasPrevious={navigation.hasPrevious}
            previousLabel={navigation.previousLabel}
            onPrevious={navigation.previous}
            onNext={navigation.next}
            label="Listing pages"
          />
        </>
      )}
    </section>
  );
}
