import { useState } from 'react';

import { useAuth } from '@/features/auth/model/auth-context';
import { AuthAlert } from '@/features/auth/ui/AuthAlert/AuthAlert';
import styles from '@/features/auth/ui/SessionPanel/SessionPanel.module.css';

export function SessionPanel() {
  const { user, logout } = useAuth();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setErrorMessage(null);
    setIsLoggingOut(true);

    try {
      await logout();
    } catch {
      setErrorMessage('Unable to sign out. Please try again.');

      setIsLoggingOut(false);
    }
  }

  if (!user) {
    return null;
  }

  const initial = user.displayName.trim().charAt(0).toUpperCase();

  return (
    <section className={styles.card} aria-labelledby="account-heading">
      <div className={styles.identity}>
        <div className={styles.avatar} aria-hidden="true">
          {initial}
        </div>

        <div className={styles.details}>
          <p className={styles.eyebrow}>Signed in</p>
          <h2 className={styles.name} id="account-heading">
            {user.displayName}
          </h2>
          <p className={styles.email}>{user.email}</p>
        </div>
      </div>

      {errorMessage && <AuthAlert>{errorMessage}</AuthAlert>}

      <button
        className={styles.signOut}
        type="button"
        disabled={isLoggingOut}
        onClick={() => void handleLogout()}
      >
        {isLoggingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}
