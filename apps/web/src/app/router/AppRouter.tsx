import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import styles from '@/app/router/AppRouter.module.css';
import { useAuth } from '@/features/auth/model/auth-context';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { HomePage } from '@/pages/home/HomePage';

const CreateListingPage = lazy(async () => {
  const module = await import('@/pages/listings/CreateListingPage');

  return {
    default: module.CreateListingPage,
  };
});

const ListingDetailsPage = lazy(async () => {
  const module = await import('@/pages/listings/ListingDetailsPage');

  return {
    default: module.ListingDetailsPage,
  };
});

interface ListingPageFallbackProps {
  title: string;
  description: string;
}

function ListingPageFallback({ title, description }: ListingPageFallbackProps) {
  return (
    <main className={styles.statusPage} aria-busy="true">
      <div className={styles.statusCard} role="status">
        <div className={styles.loader} aria-hidden="true" />
        <p className={styles.eyebrow}>Lostly</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
    </main>
  );
}

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

        <Route
          path="/listings/new"
          element={
            <Suspense
              fallback={
                <ListingPageFallback
                  title="Opening your report"
                  description="Getting the form ready…"
                />
              }
            >
              <CreateListingPage />
            </Suspense>
          }
        />

        <Route
          path="/listings/:id"
          element={
            <Suspense
              fallback={
                <ListingPageFallback
                  title="Opening this report"
                  description="Loading the report page…"
                />
              }
            >
              <ListingDetailsPage />
            </Suspense>
          }
        />

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
