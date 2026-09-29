import { AppNavigation } from '@/app/navigation/AppNavigation';
import { ListingFeed } from '@/features/listings/ui/ListingFeed/ListingFeed';
import styles from '@/pages/listings/ListingsPage.module.css';

export function ListingsPage() {
  return (
    <main className={styles.page}>
      <AppNavigation />

      <div className={styles.content}>
        <ListingFeed />
      </div>
    </main>
  );
}
