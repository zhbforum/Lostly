import type { RefObject } from 'react';
import {
  PROFILE_CONSTRAINTS,
  normalizeUsername,
  usernameIssue,
  type UserProfile,
} from '@lostly/contracts/profile';
import { profilePath } from '@/shared/navigation/profile-path';
import { useUsernameAvailability } from '../model/use-username-availability';
import { getUsernameError } from '../model/username-validation';
import styles from './ProfileEditor.module.css';

interface Props {
  profile: UserProfile;
  value: string;
  locked: boolean;
  disabled: boolean;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}

export function UsernameField({
  profile,
  value,
  locked,
  disabled,
  error,
  inputRef,
  onChange,
}: Props) {
  const username = normalizeUsername(value);
  const changed = username !== (profile.username ?? '');
  const availability = useUsernameAvailability(username, changed && !locked);
  const localError = changed && username ? getUsernameError(username, profile.username) : null;
  const fieldError =
    error ||
    localError ||
    (availability === 'taken' ? 'This username is not available. Please choose another.' : null);
  const path = profilePath({
    id: profile.id,
    username: username && !usernameIssue(username) ? username : profile.username,
  });

  return (
    <div className={styles.field}>
      <label htmlFor="profile-username">
        Username {!profile.username && <span className={styles.optional}>Optional</span>}
      </label>
      <input
        id="profile-username"
        ref={inputRef}
        name="username"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={PROFILE_CONSTRAINTS.usernameMaxLength}
        value={value}
        readOnly={locked}
        disabled={disabled}
        placeholder="alex_morgan"
        aria-invalid={Boolean(fieldError)}
        aria-describedby={`profile-username-hint profile-username-link${fieldError ? ' profile-username-error' : ''}${availability && !fieldError ? ' profile-username-status' : ''}`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="profile-username-link" className={styles.profileUrl}>
        {window.location.origin}
        {path}
      </p>
      <p id="profile-username-hint" className={styles.hint}>
        {locked && profile.nextUsernameChangeAt
          ? `You can change your username again on ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.nextUsernameChangeAt))}.`
          : '3–30 letters, numbers or underscores. Once chosen, you can change it every 30 days.'}
        {profile.username && ' Previous links stay yours and continue to work.'}
      </p>
      {fieldError && (
        <p id="profile-username-error" className={styles.error} role="alert">
          {fieldError}
        </p>
      )}
      {availability && !fieldError && (
        <p
          id="profile-username-status"
          className={styles.hint}
          role="status"
          aria-label="Username availability"
        >
          {availability === 'checking'
            ? 'Checking availability…'
            : availability === 'available'
              ? 'Available — reserved when you save.'
              : 'Could not check availability. You can still try saving.'}
        </p>
      )}
    </div>
  );
}
