import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useListingDetails } from '@/features/listings/model/use-listing-details';
import { EditListingForm } from '@/features/listings/ui/EditListingForm';
import { Brand } from '@/shared/ui/Brand/Brand';
import styles from './ListingFormPage.module.css';

export function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const { state, retry } = useListingDetails(id);
  const location = useLocation();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status !== 'loading') heading.current?.focus();
  }, [state]);
  const detailPath = id ? '/listings/' + encodeURIComponent(id) : '/listings';
  const title =
    state.status === 'loading'
      ? 'Loading your report…'
      : state.status === 'not-found'
        ? 'Report not found'
        : state.status === 'error'
          ? 'We could not load this report'
          : state.listing.capabilities.canEdit
            ? 'Edit report'
            : 'This report is not available for editing';
  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Brand variant="header" />
        <Link className={styles.backLink} to={detailPath} state={location.state}>
          Back to report
        </Link>
      </header>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <h1 className={styles.title} ref={heading} tabIndex={-1}>
            {title}
          </h1>
        </header>
        <div className={styles.card}>
          {state.status === 'loading' && <p role="status">Loading the current report details.</p>}
          {state.status === 'error' && (
            <button type="button" onClick={retry}>
              Try again
            </button>
          )}
          {state.status === 'not-found' && (
            <p>This report does not exist or the link is incorrect.</p>
          )}
          {state.status === 'success' &&
            (state.listing.capabilities.canEdit ? (
              <EditListingForm
                key={`${state.listing.listing.id}:${state.listing.listing.updatedAt}`}
                listing={state.listing.listing}
                onSaved={() => {
                  navigate(detailPath, {
                    replace: true,
                    state: { ...location.state, reportNotice: 'Your report was updated.' },
                  });
                }}
              />
            ) : (
              <p>
                You can edit only your own active reports. Return to the report to see its current
                status.
              </p>
            ))}
        </div>
      </div>
    </main>
  );
}
