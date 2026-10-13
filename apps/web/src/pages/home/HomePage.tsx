import { ListingIntentActions } from '@/features/listings/ui/ListingIntentActions/ListingIntentActions';
import styles from '@/pages/home/HomePage.module.css';
import { AppNavigation } from '@/app/navigation/AppNavigation';
import { Link } from 'react-router';

export function HomePage() {
  return (
    <main className={styles.page}>
      <AppNavigation />

      <div className={styles.content}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Your Lostly space</p>
          <h1 className={styles.title}>A clearer way to reunite people with their things.</h1>
          <p className={styles.description}>
            Report lost items, share what you have found, and verify ownership without exposing
            sensitive details publicly.
          </p>
        </section>

        <Link className={styles.browseAction} to="/listings">
          Browse active reports <span aria-hidden="true">→</span>
        </Link>

        <ListingIntentActions />
        <Link className={styles.browseAction} to="/activity">
          My reports and claims
        </Link>
      </div>
    </main>
  );
}
