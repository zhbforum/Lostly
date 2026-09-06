import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ListingCapabilities } from '@/features/listings/model/types';
import { archiveListing, resolveListing } from '@/features/listings/api/listings-api';
import { ApiError } from '@/shared/api/client';
import styles from './ListingOwnerControls.module.css';

interface ListingOwnerControlsProps {
  listingId: string;
  capabilities: ListingCapabilities;
  onChanged: (message: string) => void;
}

export function ListingOwnerControls({
  listingId,
  capabilities,
  onChanged,
}: ListingOwnerControlsProps) {
  const location = useLocation();
  const [action, setAction] = useState<'resolve' | 'archive' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  if (!capabilities.canEdit && !capabilities.canResolve && !capabilities.canArchive) return null;
  const label = action === 'resolve' ? 'Mark as resolved' : 'Archive report';

  function open(next: 'resolve' | 'archive') {
    if (busy.current) return;
    setError(null);
    setAction(next);
  }

  async function confirm() {
    if (!action || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await (action === 'resolve' ? resolveListing(listingId) : archiveListing(listingId));
      setAction(null);
      onChanged(
        action === 'resolve'
          ? 'Your report was marked as resolved.'
          : 'Your report was archived. It remains available in My reports.',
      );
    } catch (failure) {
      if (failure instanceof ApiError && [403, 404, 409].includes(failure.status)) {
        setAction(null);
        onChanged(
          'This report changed while you were viewing it. Its current status and available actions have been refreshed.',
        );
      } else {
        setError(
          'We could not confirm the change. Try again, or refresh the report to check its current status.',
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="owner-controls-title">
      <h2 id="owner-controls-title">Your report</h2>
      <p>Update your report or close it when you no longer need it to appear in active reports.</p>
      <div className={styles.actions}>
        {capabilities.canEdit && (
          <Link
            className={styles.button}
            to={`/listings/${encodeURIComponent(listingId)}/edit`}
            state={location.state}
            aria-disabled={pending || undefined}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            Edit report
          </Link>
        )}
        {capabilities.canResolve && (
          <Button className={styles.button} isDisabled={pending} onPress={() => open('resolve')}>
            Mark as resolved
          </Button>
        )}
        {capabilities.canArchive && (
          <Button
            className={`${styles.button} ${styles.archive}`}
            isDisabled={pending}
            onPress={() => open('archive')}
          >
            Archive report
          </Button>
        )}
      </div>
      <ModalOverlay
        className={styles.overlay}
        isOpen={action !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !busy.current) setAction(null);
        }}
        isKeyboardDismissDisabled={pending}
      >
        <Modal className={styles.modal}>
          <Dialog className={styles.dialog} aria-busy={pending}>
            <Heading slot="title">
              {action === 'resolve' ? 'Mark this report as resolved?' : 'Archive this report?'}
            </Heading>
            <p>
              {action === 'resolve'
                ? 'It will disappear from active reports. Any pending claims will be closed. This report cannot be reactivated.'
                : 'It will no longer appear in active reports, but it will remain available in your activity history and by direct link. Any pending claims will be closed. This report cannot be reactivated.'}
            </p>
            {error && (
              <div role="alert" className={styles.error}>
                {error}
              </div>
            )}
            <div className={styles.actions}>
              <Button
                className={styles.button}
                autoFocus
                isDisabled={pending}
                onPress={() => setAction(null)}
              >
                Cancel
              </Button>
              <Button
                className={`${styles.button} ${styles.primary}`}
                isDisabled={pending}
                onPress={() => void confirm()}
              >
                {pending ? 'Saving…' : label}
              </Button>
              {error && (
                <Button
                  className={styles.button}
                  isDisabled={pending}
                  onPress={() => {
                    setAction(null);
                    onChanged('Report status refreshed.');
                  }}
                >
                  Refresh report
                </Button>
              )}
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
}
