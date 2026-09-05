import { Link } from 'react-router';

import { ListingFeed } from '@/features/listings/ui/ListingFeed/ListingFeed';
import styles from '@/pages/listings/ListingsPage.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';

export function ListingsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Brand variant="header" />
        <Link className={styles.backLink} to="/activity">
          My activity
        </Link>

        <Link className={styles.backLink} to="/">
          <span aria-hidden="true">←</span>
          Back to home
        </Link>
      </header>

      <div className={styles.content}>
        <ListingFeed />
      </div>
    </main>
  );
}
