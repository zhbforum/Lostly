import { useState } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { Link } from 'react-router';
import { Avatar } from '@/shared/ui/Avatar/Avatar';

import { useAuth } from '@/features/auth/model/auth-context';
import { AuthAlert } from '@/features/auth/ui/AuthAlert/AuthAlert';
import styles from './AccountMenu.module.css';

export function AccountMenu() {
  const { user, logout } = useAuth();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    if (isLoggingOut) return;
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

  return (
    <DialogTrigger>
      <Button className={styles.trigger} aria-label={`Account: ${user.displayName}`}>
        {({ isHovered, isFocused }) => (
          <>
            <Avatar name={user.displayName} avatar={user.avatar} animate={isHovered || isFocused} />
            <span className={styles.triggerName}>{user.displayName}</span>
            <svg
              className={styles.chevron}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </>
        )}
      </Button>

      <Popover className={styles.popover} placement="bottom end" offset={10} containerPadding={12}>
        <Dialog className={styles.dialog} aria-label="Your account">
          {({ close }) => (
            <>
              <div className={styles.identity}>
                <p className={styles.eyebrow}>Signed in</p>
                <p className={styles.name}>{user.displayName}</p>
                <p className={styles.email}>{user.email}</p>
              </div>

              <Link to="/profile" className={styles.menuLink} onClick={close}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M5 21v-2a7 7 0 0 1 14 0v2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                Profile
              </Link>

              {errorMessage && (
                <div className={styles.error}>
                  <AuthAlert>{errorMessage}</AuthAlert>
                </div>
              )}

              <Button
                className={styles.signOut}
                isPending={isLoggingOut}
                onPress={() => void handleLogout()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9 5H5v14h4m5-14 7 7-7 7m-5-7h12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{isLoggingOut ? 'Signing out…' : 'Sign out'}</span>
              </Button>
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
