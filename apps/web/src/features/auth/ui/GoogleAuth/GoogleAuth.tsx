import { useEffect, useState } from 'react';
import { getAuthProviders, startGoogleAuth } from '@/features/auth/api/auth-api';
import { AuthAlert } from '@/features/auth/ui/AuthAlert/AuthAlert';
import { ApiError } from '@/shared/api/client';
import styles from './GoogleAuth.module.css';

const RESULTS: Record<string, string> = {
  failed: 'Google sign-in was cancelled or could not be completed. Please try again.',
  account_exists:
    'Use your password to sign in, then connect Google in your account. The Google email must match your Lostly email.',
  already_linked:
    'This Google account is already connected, or your account has another Google account connected.',
  session_expired: 'Your session expired. Sign in again before connecting Google.',
};

export function GoogleAuth({
  mode = 'login',
  returnTo = '/',
  disabled = false,
}: {
  mode?: 'login' | 'link';
  returnTo?: string;
  disabled?: boolean;
}) {
  const [provider, setProvider] = useState<{ enabled: boolean; linked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = new URLSearchParams(window.location.search).get('google');
  useEffect(() => {
    const controller = new AbortController();
    void getAuthProviders(controller.signal)
      .then(({ google }) => {
        if (!controller.signal.aborted) setProvider(google);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [mode]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startGoogleAuth(mode, returnTo);
      window.location.assign(url);
    } catch (error) {
      setError(
        error instanceof ApiError && error.code === 'RATE_LIMITED'
          ? 'Too many attempts. Please wait a minute and try again.'
          : 'Google sign-in is unavailable. Please try again later.',
      );
      setBusy(false);
    }
  }

  return (
    <div className={styles.container}>
      {(error || (result && RESULTS[result])) && <AuthAlert>{error || RESULTS[result!]}</AuthAlert>}
      {mode === 'link' && provider?.linked ? (
        <p role="status" className={styles.connected}>
          Google connected
        </p>
      ) : provider?.enabled ? (
        <button
          className={styles.button}
          type="button"
          disabled={disabled || busy}
          onClick={() => void start()}
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.85 46.98 24.55z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          {busy ? 'Connecting…' : mode === 'link' ? 'Connect Google' : 'Continue with Google'}
        </button>
      ) : null}
    </div>
  );
}
