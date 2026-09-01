import type { ReactNode } from 'react';

import styles from '@/features/auth/ui/AuthPageLayout/AuthPageLayout.module.css';
import { Brand } from '@/shared/ui/Brand/Brand';

interface AuthPageLayoutProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthPageLayout({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthPageLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Brand variant="auth" />

        <section className={styles.card}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </header>

          {children}

          <div className={styles.footer}>{footer}</div>
        </section>
      </div>
    </main>
  );
}
