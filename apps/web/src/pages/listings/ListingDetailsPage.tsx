import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { useListingDetails } from '@/features/listings/model/use-listing-details';
import { ListingDetails } from '@/features/listings/ui/ListingDetails/ListingDetails';
import { ClaimPanel } from '@/features/claims/ui/ClaimPanel/ClaimPanel';
import { ListingOwnerControls } from '@/features/listings/ui/ListingOwnerControls';
import styles from '@/pages/listings/ListingDetailsPage.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';
import { ListingPhotos } from '@/features/listings/ui/ListingPhotos';
import { safeReturnTo } from '@/shared/navigation/return-to';
import { getConversationReturn } from '@/shared/navigation/conversation-return';

export function ListingDetailsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState: unknown = location.state;
  const stateWithNotice =
    typeof navigationState === 'object' &&
    navigationState !== null &&
    !Array.isArray(navigationState) &&
    'reportNotice' in navigationState
      ? navigationState
      : null;
  const navigationNotice =
    stateWithNotice?.reportNotice === 'Your report was updated.'
      ? stateWithNotice.reportNotice
      : null;
  const candidate: unknown = location.state?.returnTo;
  const conversationReturn = getConversationReturn(location.state);
  const returningToConversation =
    typeof candidate === 'string' &&
    safeReturnTo(candidate) === candidate &&
    /^\/messages\/[^/?#]+$/.test(candidate);
  const returnTo =
    typeof candidate === 'string' &&
    (/^\/(listings|activity)(\?|$)/.test(candidate) || returningToConversation)
      ? candidate
      : '/listings';
  const { id } = useParams<{ id: string }>();
  const { state, retry, acceptClaim } = useListingDetails(id);
  const [notice, setNotice] = useState<{ id: string | undefined; message: string | null }>({
    id,
    message: navigationNotice,
  });
  // Capture a new notice before consuming its history state, and clear it on a different report.
  if (notice.id !== id || (navigationNotice !== null && notice.message !== navigationNotice)) {
    setNotice({ id, message: navigationNotice });
  }
  const message = notice.id === id ? notice.message : null;
  const listingTitleRef = useRef<HTMLHeadingElement>(null);
  const notFoundTitleRef = useRef<HTMLHeadingElement>(null);
  const errorTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!stateWithNotice) return;
    const { reportNotice: _reportNotice, ...restState } = stateWithNotice;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: restState },
    );
  }, [stateWithNotice, navigate, location.pathname, location.search, location.hash]);

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

        <Link
          className={styles.backLink}
          to={returnTo}
          state={{ pagination: location.state?.returnPagination }}
          replace={returningToConversation}
          onClick={(event) => {
            if (
              returningToConversation &&
              conversationReturn &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              void navigate(-conversationReturn.steps);
            }
          }}
        >
          <span aria-hidden="true">←</span>
          {returningToConversation ? 'Back to conversation' : 'Back to results'}
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
          <>
            <ListingDetails listing={state.listing.listing} titleRef={listingTitleRef} />
            <ListingPhotos
              key={`photos:${state.listing.listing.id}`}
              listingId={state.listing.listing.id}
              images={state.listing.images}
              canManage={state.listing.capabilities.canManageImages}
            />
            {message && <p role="status">{message}</p>}
            <ListingOwnerControls
              listingId={state.listing.listing.id}
              capabilities={state.listing.capabilities}
              onChanged={(noticeMessage) => {
                setNotice({ id, message: noticeMessage });
                retry();
              }}
            />
            <ClaimPanel
              key={`claim-panel:${state.listing.listing.id}`}
              listingId={state.listing.listing.id}
              capabilities={state.listing.capabilities}
              initialClaim={state.listing.claim}
              onChanged={retry}
              onCreated={acceptClaim}
            />
          </>
        )}
      </div>
    </main>
  );
}
