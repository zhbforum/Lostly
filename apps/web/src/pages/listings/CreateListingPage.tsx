import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import type { Listing, ListingKind } from '@/features/listings/model/types';
import { CreateListingForm } from '@/features/listings/ui/CreateListingForm';
import { ListingCreationSuccess } from '@/features/listings/ui/ListingCreationSuccess/ListingCreationSuccess';
import styles from '@/pages/listings/ListingFormPage.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';

function getInitialKind(searchParams: URLSearchParams): ListingKind | null {
  const kind = searchParams.get('kind');

  if (kind === 'lost' || kind === 'found') {
    return kind;
  }

  return null;
}

export function CreateListingPage() {
  const [searchParams] = useSearchParams();
  const [createdListing, setCreatedListing] = useState<Listing | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const initialKind = getInitialKind(searchParams);

  function handleCreateAnother() {
    setCreatedListing(null);
    setFormVersion((version) => version + 1);
  }

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
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Report an item</p>

          <h1 className={styles.title}>Help this item find its way back.</h1>

          <p className={styles.description}>
            Share the details people need to understand what happened and recognize the item. Keep
            private verification details to yourself.
          </p>
        </header>

        <div className={styles.card}>
          {createdListing ? (
            <ListingCreationSuccess
              listing={createdListing}
              onCreateAnother={handleCreateAnother}
            />
          ) : (
            <CreateListingForm
              key={formVersion}
              initialKind={initialKind}
              onCreated={setCreatedListing}
            />
          )}
        </div>
      </div>
    </main>
  );
}
