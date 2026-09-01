import type { ReactNode } from 'react';

import styles from '@/features/auth/ui/AuthAlert/AuthAlert.module.css';

interface AuthAlertProps {
  children: ReactNode;
}

export function AuthAlert({ children }: AuthAlertProps) {
  return (
    <div className={styles.alert} role="alert">
      {children}
    </div>
  );
}
