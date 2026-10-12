import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PROFILE_CONSTRAINTS,
  normalizeUsername,
  type UserProfile,
} from '@lostly/contracts/profile';
import { useAuth } from '@/features/auth/model/auth-context';
import { getDisplayNameError } from '@/features/auth/model/validation';
import { ApiError } from '@/shared/api/client';
import { discardDraft, readDraft, saveDraft } from '@/shared/model/form-drafts';
import { getProfile, saveProfile } from '../api/profile-api';
import { AvatarEditor } from './AvatarEditor';
import { UsernameField } from './UsernameField';
import { getUsernameError } from '../model/username-validation';
import styles from './ProfileEditor.module.css';

interface ProfileDraft {
  displayName: string;
  username: string | null;
  bio: string;
  version: number;
}

export function ProfileEditor({ initialProfile }: { initialProfile: UserProfile }) {
  const { user, updateProfile } = useAuth();
  const draftKey = `profile:${initialProfile.id}`;
  const [draft] = useState(() => {
    const saved = readDraft<ProfileDraft>(draftKey);
    return saved?.version === initialProfile.version ? saved : initialProfile;
  });
  const [profile, setProfile] = useState(initialProfile);
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [username, setUsername] = useState(draft.username ?? '');
  const [bio, setBio] = useState(draft.bio);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const nameInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const nameLocked = Boolean(
    profile.nextDisplayNameChangeAt && Date.parse(profile.nextDisplayNameChangeAt) > now,
  );
  const usernameLocked = Boolean(
    profile.nextUsernameChangeAt && Date.parse(profile.nextUsernameChangeAt) > now,
  );
  const normalizedUsername = normalizeUsername(username);
  const usernameChanged = normalizedUsername !== (profile.username ?? '');
  const dirty =
    displayName.trim() !== profile.displayName || bio.trim() !== profile.bio || usernameChanged;
  const busy = saving || avatarBusy;

  useEffect(() => {
    updateProfile(initialProfile);
  }, [initialProfile, updateProfile]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!nameLocked && !usernameLocked) return;
    const nextUnlock = Math.min(
      ...[profile.nextDisplayNameChangeAt, profile.nextUsernameChangeAt]
        .filter((value): value is string => Boolean(value) && Date.parse(value!) > now)
        .map(Date.parse),
    );
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(60_000, Math.max(100, nextUnlock - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [
    nameLocked,
    usernameLocked,
    now,
    profile.nextDisplayNameChangeAt,
    profile.nextUsernameChangeAt,
  ]);
  useEffect(() => {
    if (dirty) saveDraft(draftKey, { displayName, username, bio, version: profile.version });
    else discardDraft(draftKey);
  }, [draftKey, displayName, username, bio, profile.version, dirty]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  function acceptProfile(next: UserProfile, message: string) {
    if (!mounted.current) return;
    setProfile(next);
    updateProfile(next);
    setNotice(message);
    setNow(Date.now());
  }

  async function refreshAfterConflict() {
    try {
      const response = await getProfile();
      if (!mounted.current) return;
      acceptProfile(response.profile, '');
      if (response.profile.displayName !== profile.displayName) {
        setDisplayName(response.profile.displayName);
        setNameError(null);
      }
      if (response.profile.username !== profile.username) {
        setUsername(response.profile.username ?? '');
        setUsernameError(null);
      }
      if (response.profile.bio !== profile.bio) {
        setBio(response.profile.bio);
      }
    } catch {
      return;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !dirty) return;
    const validation = getDisplayNameError(displayName);
    const usernameValidation = getUsernameError(normalizedUsername, profile.username);
    setNameError(validation);
    setUsernameError(usernameValidation);
    setError(null);
    setNotice('');
    if (validation) {
      nameInput.current?.focus();
      return;
    }
    if (usernameValidation) {
      usernameInput.current?.focus();
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setSaving(true);
    try {
      const response = await saveProfile(
        {
          displayName: displayName.trim(),
          bio: bio.trim(),
          expectedVersion: profile.version,
          ...(usernameChanged ? { username: normalizedUsername } : {}),
        },
        request.signal,
      );
      if (request.signal.aborted) return;
      acceptProfile(response.profile, 'Changes saved.');
      setDisplayName(response.profile.displayName);
      setUsername(response.profile.username ?? '');
      setBio(response.profile.bio);
      discardDraft(draftKey);
    } catch (cause) {
      if (request.signal.aborted) return;
      if (
        cause instanceof ApiError &&
        ['PROFILE_CHANGED', 'DISPLAY_NAME_LOCKED', 'USERNAME_LOCKED'].includes(cause.code)
      ) {
        await refreshAfterConflict();
        if (mounted.current)
          setError(
            cause.code === 'DISPLAY_NAME_LOCKED'
              ? 'Your name was recently changed. You can still update your bio.'
              : cause.code === 'USERNAME_LOCKED'
                ? 'Your username was recently changed. You can still update the other details.'
                : 'Your profile changed elsewhere. Review the latest details, then save again.',
          );
      } else if (
        cause instanceof ApiError &&
        ['USERNAME_TAKEN', 'USERNAME_RESERVED', 'INVALID_USERNAME'].includes(cause.code)
      ) {
        setUsernameError(cause.message);
        requestAnimationFrame(() => {
          if (mounted.current && !request.signal.aborted) usernameInput.current?.focus();
        });
      } else setError('We could not save your changes. Please try again.');
    } finally {
      if (!request.signal.aborted) setSaving(false);
    }
  }

  const joined = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(
    new Date(profile.createdAt),
  );
  const nextChange = profile.nextDisplayNameChangeAt
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(profile.nextDisplayNameChangeAt),
      )
    : '';
  const avatar = user?.avatar?.id === profile.avatar?.id ? (user?.avatar ?? null) : profile.avatar;

  return (
    <div className={styles.card}>
      <AvatarEditor
        profile={profile}
        avatar={avatar}
        disabled={saving}
        onBusy={setAvatarBusy}
        onSaved={acceptProfile}
        onConflict={refreshAfterConflict}
      />
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-busy={saving}
      >
        <div className={styles.field}>
          <label htmlFor="profile-name">Display name</label>
          <input
            ref={nameInput}
            id="profile-name"
            name="displayName"
            autoComplete="nickname"
            maxLength={PROFILE_CONSTRAINTS.displayNameMaxLength}
            value={displayName}
            readOnly={nameLocked}
            disabled={busy}
            aria-describedby={
              nameError ? 'profile-name-hint profile-name-error' : 'profile-name-hint'
            }
            aria-invalid={Boolean(nameError)}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setNameError(null);
              setNotice('');
            }}
          />
          <p id="profile-name-hint" className={styles.hint}>
            {nameLocked
              ? `You can change your name again on ${nextChange}.`
              : 'You can change your name once every 7 days.'}
          </p>
          {nameError && (
            <p id="profile-name-error" className={styles.error} role="alert">
              {nameError}
            </p>
          )}
        </div>
        <UsernameField
          profile={profile}
          value={username}
          locked={usernameLocked}
          disabled={busy}
          error={usernameError}
          inputRef={usernameInput}
          onChange={(value) => {
            setUsername(value);
            setUsernameError(null);
            setNotice('');
          }}
        />
        <div className={styles.field}>
          <label htmlFor="profile-bio">
            Bio <span className={styles.optional}>Optional</span>
          </label>
          <textarea
            id="profile-bio"
            name="bio"
            rows={3}
            maxLength={PROFILE_CONSTRAINTS.bioMaxLength}
            value={bio}
            disabled={busy}
            aria-describedby="profile-bio-hint"
            placeholder="A few words about you…"
            onChange={(event) => {
              setBio(event.target.value);
              setNotice('');
            }}
          />
          <div className={styles.fieldMeta}>
            <p id="profile-bio-hint" className={styles.hint}>
              A short introduction to the person behind the profile.
            </p>
            <span
              className={styles.counter}
              aria-label={`${bio.length} of ${PROFILE_CONSTRAINTS.bioMaxLength} characters`}
            >
              {bio.length}/{PROFILE_CONSTRAINTS.bioMaxLength}
            </span>
          </div>
        </div>
        <div className={styles.joined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            Member since <time dateTime={profile.createdAt}>{joined}</time>
          </span>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <p className={styles.saveStatus} role="status" aria-label="Profile save status">
            {notice || (dirty ? 'Unsaved changes' : '')}
          </p>
          <div className={styles.footerActions}>
            {dirty && (
              <button
                type="button"
                className={styles.textButton}
                disabled={busy}
                onClick={() => {
                  setDisplayName(profile.displayName);
                  setUsername(profile.username ?? '');
                  setBio(profile.bio);
                  setNameError(null);
                  setUsernameError(null);
                  setError(null);
                  setNotice('');
                }}
              >
                Cancel
              </button>
            )}
            <button type="submit" className={styles.primary} disabled={busy || !dirty}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
