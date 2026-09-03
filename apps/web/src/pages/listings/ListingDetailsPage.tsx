import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';

import { useListingDetails } from '@/features/listings/model/use-listing-details';
import { ListingDetails } from '@/features/listings/ui/ListingDetails/ListingDetails';
import styles from '@/pages/listings/ListingDetailsPage.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';

export function ListingDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { state, retry } = useListingDetails(id);
  const listingTitleRef = useRef<HTMLHeadingElement>(null);
  const notFoundTitleRef = useRef<HTMLHeadingElement>(null);
  const errorTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    switch (state.status) {
      case 'success':
        listingTitleRef.current?.focus();
        break;
      case 'not-found':
        notFoundTitleRef.current?.focus();
        break;
      case 'error':
        errorTitleRef.current?.focus();
        break;
      case 'loading':
        break;
    }
  }, [state]);

  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Brand variant="header" />

        <Link className={styles.backLink} to="/">
          <span aria-hidden="true">←</span>
          Back to home
        </Link>
      </header>

      <div className={styles.content}>
        {state.status === 'loading' && (
          <section className={styles.statusCard} role="status" aria-live="polite">
            <div className={styles.loader} aria-hidden="true" />

            <div className={styles.statusHeader}>
              <p className={styles.eyebrow}>Lostly</p>
              <h1 className={styles.statusTitle}>Opening this report</h1>
              <p className={styles.statusDescription}>Loading the item details…</p>
            </div>
          </section>
        )}

        {state.status === 'not-found' && (
          <section className={styles.statusCard}>
            <div className={styles.statusIcon} aria-hidden="true">
              ?
            </div>

            <div className={styles.statusHeader}>
              <p className={styles.eyebrow}>Report not found</p>
              <h1 className={styles.statusTitle} ref={notFoundTitleRef} tabIndex={-1}>
                We could not find this report.
              </h1>
              <p className={styles.statusDescription}>
                It may no longer exist, or the link may be incorrect.
              </p>
            </div>

            <div className={styles.actions}>
              <Link className={styles.primaryAction} to="/">
                Back to home
              </Link>
            </div>
          </section>
        )}

        {state.status === 'error' && (
          <section className={styles.statusCard}>
            <div className={`${styles.statusIcon} ${styles.errorIcon}`} aria-hidden="true">
              !
            </div>

            <div className={styles.statusHeader}>
              <p className={`${styles.eyebrow} ${styles.errorEyebrow}`}>Connection issue</p>
              <h1 className={styles.statusTitle} ref={errorTitleRef} tabIndex={-1}>
                We could not load this report.
              </h1>
              <p className={styles.statusDescription}>Check your connection and try again.</p>
            </div>

            <div className={styles.actions}>
              <button className={styles.primaryAction} type="button" onClick={retry}>
                Try again
              </button>

              <Link className={styles.secondaryAction} to="/">
                Back to home
              </Link>
            </div>
          </section>
        )}

        {state.status === 'success' && (
          <ListingDetails listing={state.listing} titleRef={listingTitleRef} />
        )}
      </div>
    </main>
  );
}
