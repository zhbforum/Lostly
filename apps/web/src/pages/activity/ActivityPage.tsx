import { useCallback } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { getActivity, type ActivityTab } from '@/features/activity/api/activity-api';
import { ListingCard } from '@/features/listings/ui/ListingCard/ListingCard';
import { useApiResource } from '@/shared/model/use-api-resource';
import { useCursorNavigation } from '@/shared/model/use-cursor-navigation';
import { Pagination } from '@/shared/ui/Pagination/Pagination';
import { AppNavigation } from '@/app/navigation/AppNavigation';
import pageStyles from '@/pages/listings/ListingsPage.module.css';
import styles from './ActivityPage.module.css';

const TABS: Array<{ value: ActivityTab; label: string }> = [
  { value: 'reports', label: 'My reports' },
  { value: 'claims', label: 'My claims' },
  { value: 'incoming', label: 'Incoming claims' },
];

export function ActivityPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const rawTab = params.get('tab');
  const tab: ActivityTab = rawTab === 'claims' || rawTab === 'incoming' ? rawTab : 'reports';
  const navigation = useCursorNavigation();
  const { cursor } = navigation;
  const fetcher = useCallback(
    (signal: AbortSignal) => getActivity(tab, cursor, signal),
    [tab, cursor],
  );
  const { state, refresh } = useApiResource(JSON.stringify([tab, cursor]), fetcher);
  return (
    <main className={pageStyles.page}>
      <AppNavigation />
      <div className={pageStyles.content}>
        <h1>Your activity</h1>
        <p>Revisit your reports and claims, including resolved and archived items.</p>
        <nav className={styles.tabs} aria-label="Activity sections">
          {TABS.map((item) => (
            <Link
              key={item.value}
              to={'/activity?tab=' + item.value}
              aria-current={tab === item.value ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button type="button" className={styles.refresh} onClick={refresh}>
          Refresh activity
        </button>
        {state.status === 'loading' && <p role="status">Loading activity…</p>}
        {state.status === 'error' && (
          <div role="alert">
            <p>Could not load your activity.</p>
            <button type="button" onClick={refresh}>
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
            {state.data.kind === 'reports' ? (
              state.data.listings.length ? (
                <ul className={styles.cards}>
                  {state.data.listings.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </ul>
              ) : (
                <p>No reports on this page.</p>
              )
            ) : state.data.claims.length ? (
              <ul className={styles.cards}>
                {state.data.claims.map((claim) => (
                  <li className={styles.claim} key={claim.id}>
                    <h2>
                      <Link
                        to={'/listings/' + claim.listing.id}
                        state={{
                          returnTo: location.pathname + location.search,
                          returnPagination: location.state?.pagination,
                        }}
                      >
                        {claim.listing.title}
                      </Link>
                    </h2>
                    <p>
                      Claim: <strong>{claim.status}</strong> · Report: {claim.listing.status}
                    </p>
                    <p>
                      Submitted{' '}
                      {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
                        new Date(claim.createdAt),
                      )}
                    </p>
                    <Link
                      className={styles.conversation}
                      to={`/messages/${encodeURIComponent(claim.conversationId)}`}
                    >
                      Open conversation
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No claims on this page.</p>
            )}
            <Pagination
              pageInfo={state.data.pageInfo}
              hasPrevious={navigation.hasPrevious}
              previousLabel={navigation.previousLabel}
              onPrevious={navigation.previous}
              onNext={navigation.next}
              label="Activity pages"
            />
          </>
        )}
      </div>
    </main>
  );
}
