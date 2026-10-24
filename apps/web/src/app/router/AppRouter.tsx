import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, matchPath } from 'react-router';

import styles from '@/app/router/AppRouter.module.css';
import { useAuth } from '@/features/auth/model/auth-context';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { HomePage } from '@/pages/home/HomePage';
import { ConversationPage } from '@/pages/messages/ConversationPage';
import { MessagesEmptyRoute } from '@/pages/messages/MessagesEmptyRoute';
import { safeReturnTo } from '@/shared/navigation/return-to';
import { profilePath } from '@/shared/navigation/profile-path';
import { ModerationPage } from '@/pages/moderation/ModerationPage';

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

const EditListingPage = lazy(async () => ({
  default: (await import('@/pages/listings/EditListingPage')).EditListingPage,
}));

const ListingsPage = lazy(async () => {
  const module = await import('@/pages/listings/ListingsPage');

  return {
    default: module.ListingsPage,
  };
});

const ActivityPage = lazy(async () => ({
  default: (await import('@/pages/activity/ActivityPage')).ActivityPage,
}));

const MessagesPage = lazy(async () => ({
  default: (await import('@/pages/messages/MessagesPage')).MessagesPage,
}));

const ProfilePage = lazy(async () => ({
  default: (await import('@/pages/profile/ProfilePage')).ProfilePage,
}));

const PublicProfilePage = lazy(async () => ({
  default: (await import('@/pages/profile/PublicProfilePage')).PublicProfilePage,
}));

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
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'authenticated' && user?.restriction)
    return (
      <Routes>
        <Route path="/moderation" element={<ModerationPage />} />
        <Route path="*" element={<Navigate to="/moderation" replace />} />
      </Routes>
    );

  const publicRoute = matchPath('/u/:username', location.pathname) ? '/u/:username' : '/users/:id';
  if (matchPath(publicRoute, location.pathname))
    return (
      <Routes>
        <Route
          path={publicRoute}
          element={
            <Suspense
              fallback={
                <ListingPageFallback title="Profile" description="Loading this member’s profile…" />
              }
            >
              <PublicProfilePage />
            </Suspense>
          }
        />
      </Routes>
    );

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
        <Route path="/moderation" element={<ModerationPage />} />
        <Route
          path="/listings/:id/edit"
          element={
            <Suspense
              fallback={
                <ListingPageFallback
                  title="Opening the editor"
                  description="Loading your report…"
                />
              }
            >
              <EditListingPage />
            </Suspense>
          }
        />
        <Route
          path="/login"
          element={
            <Navigate
              to={safeReturnTo(location.state?.returnTo)}
              state={location.state?.returnState}
              replace
            />
          }
        />
        <Route
          path="/register"
          element={
            <Navigate
              to={safeReturnTo(location.state?.returnTo)}
              state={location.state?.returnState}
              replace
            />
          }
        />
        <Route path="/" element={<HomePage />} />
        <Route path="/profile" element={<Navigate to={profilePath(user!)} replace />} />
        <Route
          path="/profile/edit"
          element={
            <Suspense
              fallback={
                <ListingPageFallback title="Your profile" description="Loading your details…" />
              }
            >
              <ProfilePage />
            </Suspense>
          }
        />
        <Route
          path="/messages"
          element={
            <Suspense
              fallback={
                <ListingPageFallback title="Your messages" description="Opening your inbox…" />
              }
            >
              <MessagesPage />
            </Suspense>
          }
        >
          <Route index element={<MessagesEmptyRoute />} />
          <Route path=":conversationId" element={<ConversationPage />} />
        </Route>
        <Route
          path="/activity"
          element={
            <Suspense
              fallback={
                <ListingPageFallback
                  title="Your activity"
                  description="Loading reports and claims…"
                />
              }
            >
              <ActivityPage />
            </Suspense>
          }
        />

        <Route
          path="/listings"
          element={
            <Suspense
              fallback={
                <ListingPageFallback
                  title="Opening active reports"
                  description="Loading the latest listings…"
                />
              }
            >
              <ListingsPage />
            </Suspense>
          }
        />

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
      <Route
        path="*"
        element={
          <Navigate
            to="/login"
            replace
            state={{
              returnTo: location.pathname + location.search + location.hash,
              returnState: location.state,
            }}
          />
        }
      />
    </Routes>
  );
}
