import { Navigate, Route, Routes } from 'react-router';

import { useAuth } from '@/features/auth/model/auth-context';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { HomePage } from '@/pages/home/HomePage';
import styles from '@/app/router/AppRouter.module.css';

export function AppRouter() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <main className={styles.statusPage} aria-busy="true">
        <div className={styles.statusCard} role="status">
          <div className={styles.loader} aria-hidden="true" />
          <p className={styles.eyebrow}>Lostly</p>
          <h1 className={styles.title}>Getting things ready</h1>
          <p className={styles.description}>Checking your session…</p>
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className={styles.statusPage}>
        <div className={styles.statusCard}>
          <p className={styles.eyebrow}>Connection issue</p>
          <h1 className={styles.title}>We could not load your session</h1>
          <p className={styles.description}>Check your connection and try again.</p>

          <button
            className={styles.retryButton}
            type="button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (status === 'authenticated') {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
