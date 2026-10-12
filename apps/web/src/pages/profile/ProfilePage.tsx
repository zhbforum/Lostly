import { AppNavigation } from '@/app/navigation/AppNavigation';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/model/auth-context';
import { getProfile } from '@/features/profile/api/profile-api';
import { ProfileEditor } from '@/features/profile/ui/ProfileEditor';
import { useApiResource } from '@/shared/model/use-api-resource';
import { profilePath } from '@/shared/navigation/profile-path';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { user } = useAuth();
  const { state, refresh } = useApiResource('profile', getProfile);
  return (
    <main className={styles.page}>
      <AppNavigation />
      <div className={styles.content}>
        <div className={styles.heading}>
          <h1>Edit profile</h1>
          <p>Your photo, name, bio and join date are visible to anyone with your profile link.</p>
          <Link className={styles.profileLink} to={profilePath(user!)}>
            View public profile <span aria-hidden="true">↗</span>
          </Link>
        </div>
        {state.status === 'loading' && (
          <div className={styles.loading} role="status" aria-busy="true">
            Loading your profile…
          </div>
        )}
        {state.status === 'error' && (
          <div className={styles.loading} role="alert">
            <p>We could not load your profile.</p>
            <button type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'success' && (
          <ProfileEditor key={state.data.profile.id} initialProfile={state.data.profile} />
        )}
      </div>
    </main>
  );
}
