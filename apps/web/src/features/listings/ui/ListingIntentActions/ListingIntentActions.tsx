import { Link } from 'react-router';

import styles from '@/features/listings/ui/ListingIntentActions/ListingIntentActions.module.css';

const ACTIONS = [
  {
    kind: 'lost',
    title: 'I lost something',
    description: 'Create a report with the details that could help someone recognize your item.',
  },
  {
    kind: 'found',
    title: 'I found something',
    description: 'Share what you found so the right person has a better chance of getting it back.',
  },
] as const;

export function ListingIntentActions() {
  return (
    <section className={styles.section} aria-labelledby="listing-intent-heading">
      <div className={styles.header}>
        <h2 className={styles.title} id="listing-intent-heading">
          What would you like to report?
        </h2>

        <p className={styles.description}>
          Start with what happened. You can add the item details next.
        </p>
      </div>

      <div className={styles.actions}>
        {ACTIONS.map((action) => (
          <Link
            className={styles.action}
            key={action.kind}
            to={`/listings/new?kind=${action.kind}`}
          >
            <span className={styles.actionTitle}>{action.title}</span>

            <span className={styles.actionDescription}>{action.description}</span>

            <span className={styles.actionCallout} aria-hidden="true">
              Start report
              <span className={styles.actionArrow}>→</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
