import { Link, useLocation } from 'react-router';
import styles from './ProfileLink.module.css';

export function ProfileLink({ id, name }: { id: string; name: string }) {
  const location = useLocation();
  return (
    <Link
      className={styles.link}
      to={`/users/${encodeURIComponent(id)}`}
      state={{ returnTo: location.pathname + location.search }}
      title="View public profile"
    >
      {name}
      <span className={styles.arrow} aria-hidden="true">
        ↗
      </span>
    </Link>
  );
}
