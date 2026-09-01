import styles from '@/shared/ui/Brand/Brand.module.css';

interface BrandProps {
  variant: 'auth' | 'header';
}

export function Brand({ variant }: BrandProps) {
  return (
    <div className={`${styles.root} ${styles[variant]}`}>
      <span className={styles.mark} aria-hidden="true">
        L
      </span>
      <span>Lostly</span>
    </div>
  );
}
