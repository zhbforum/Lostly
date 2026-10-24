import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { AppNavigation } from '@/app/navigation/AppNavigation';
import { useAuth } from '@/features/auth/model/auth-context';
import { usePublicProfile } from '@/features/profile/model/use-public-profile';
import { safeReturnTo } from '@/shared/navigation/return-to';
import { profilePath } from '@/shared/navigation/profile-path';
import { Avatar } from '@/shared/ui/Avatar/Avatar';
import { Brand } from '@/shared/ui/Brand/Brand';
import { ReportButton } from '@/features/moderation/ReportButton';
import layout from './ProfilePage.module.css';
import styles from './PublicProfilePage.module.css';

export function PublicProfilePage() {
  const { id = '', username } = useParams();
  return (
    <ProfileView
      key={`${username === undefined ? 'id' : 'username'}:${username ?? id}`}
      id={username ?? id}
      lookup={username === undefined ? 'id' : 'username'}
    />
  );
}

function ProfileView({ id, lookup }: { id: string; lookup: 'id' | 'username' }) {
  const { user, status } = useAuth();
  const { state, refresh } = usePublicProfile(id, lookup);
  const location = useLocation();
  const [playing, setPlaying] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const own = state.status === 'success' && user?.id === state.profile.id;
  const canonicalPath = state.status === 'success' ? profilePath(state.profile) : location.pathname;

  if (state.status === 'success' && location.pathname !== canonicalPath)
    return (
      <Navigate
        to={canonicalPath + location.search + location.hash}
        replace
        state={location.state}
      />
    );

  async function share() {
    try {
      await navigator.clipboard.writeText(new URL(canonicalPath, window.location.origin).href);
      setCopyStatus('Profile link copied.');
    } catch {
      setCopyStatus('Could not copy the link. You can copy it from your address bar.');
    }
  }

  return (
    <main className={layout.page}>
      {status === 'authenticated' ? (
        <AppNavigation />
      ) : (
        <header className={styles.guestHeader}>
          <Link to="/" aria-label="Lostly home">
            <Brand variant="header" />
          </Link>
          {status !== 'loading' && (
            <Link className={styles.secondary} to="/login" state={{ returnTo: location.pathname }}>
              Sign in
            </Link>
          )}
        </header>
      )}
      <div className={layout.content}>
        {status === 'authenticated' && (
          <Link className={styles.back} to={safeReturnTo(location.state?.returnTo)}>
            <span aria-hidden="true">←</span> {location.state?.returnTo ? 'Back' : 'Back to Lostly'}
          </Link>
        )}
        {state.status === 'loading' && (
          <div className={layout.loading} role="status">
            Loading profile…
          </div>
        )}
        {state.status === 'not-found' && (
          <div className={layout.loading}>
            <h1>Profile not found</h1>
            <p>This profile is no longer available, or the link is incorrect.</p>
          </div>
        )}
        {state.status === 'error' && (
          <div className={layout.loading} role="alert">
            <h1>Could not load this profile</h1>
            <p>Please try again in a moment.</p>
            <button type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'success' && (
          <article className={styles.card} aria-labelledby="public-profile-name">
            <div className={styles.identity}>
              <div className={styles.photo}>
                <Avatar
                  name={state.profile.displayName}
                  avatar={state.profile.avatar}
                  size={104}
                  animate={playing}
                />
                {state.profile.avatar?.animated && (
                  <button
                    type="button"
                    className={styles.animation}
                    aria-pressed={playing}
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? 'Pause animation' : 'Play animation'}
                  </button>
                )}
              </div>
              <div className={styles.details}>
                <p className={styles.eyebrow}>Lostly member</p>
                <h1 id="public-profile-name">{state.profile.displayName}</h1>
                {state.profile.username && (
                  <p className={styles.username}>@{state.profile.username}</p>
                )}
                <p className={styles.joined}>
                  Member since{' '}
                  <time dateTime={state.profile.createdAt}>
                    {new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(
                      new Date(state.profile.createdAt),
                    )}
                  </time>
                </p>
              </div>
            </div>
            <section className={styles.about} aria-labelledby="public-profile-about">
              <h2 id="public-profile-about">About</h2>
              {state.profile.bio ? (
                <p className={styles.bio}>{state.profile.bio}</p>
              ) : (
                <p className={styles.empty}>
                  {own
                    ? 'A few words can help people get to know you. Add a bio when you edit your profile.'
                    : 'This member hasn’t added a bio yet.'}
                </p>
              )}
            </section>
            <footer className={styles.footer}>
              {!own && (
                <ReportButton
                  targetType="user"
                  targetId={state.profile.id}
                  label="Report profile"
                />
              )}
              {!own && state.profile.avatar && (
                <ReportButton
                  targetType="avatar"
                  targetId={state.profile.id}
                  label="Report avatar"
                />
              )}
              <div className={styles.actions}>
                {own && (
                  <Link className={styles.primary} to="/profile/edit">
                    Edit profile
                  </Link>
                )}
                <button type="button" className={styles.secondary} onClick={() => void share()}>
                  Copy profile link
                </button>
              </div>
              <p className={styles.feedback} role="status">
                {copyStatus}
              </p>
            </footer>
          </article>
        )}
      </div>
    </main>
  );
}
