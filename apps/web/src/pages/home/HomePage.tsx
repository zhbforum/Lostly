import { SessionPanel } from '@/features/auth/ui/SessionPanel/SessionPanel';
import { ListingIntentActions } from '@/features/listings/ui/ListingIntentActions/ListingIntentActions';
import styles from '@/pages/home/HomePage.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';

export function HomePage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand variant="header" />
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Your Lostly space</p>
          <h1 className={styles.title}>A clearer way to reunite people with their things.</h1>
          <p className={styles.description}>
            Report lost items, share what you have found, and verify ownership without exposing
            sensitive details publicly.
          </p>
        </section>

        <ListingIntentActions />

        <SessionPanel />
      </div>
    </main>
  );
}
