import { useState, type CSSProperties } from 'react';
import type { ProfileAvatar } from '@lostly/contracts/profile';
import styles from './Avatar.module.css';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const firstGrapheme = (word = '') =>
  segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '';

interface AvatarProps {
  name: string;
  avatar?: ProfileAvatar | null;
  size?: number;
  animate?: boolean;
}

export function Avatar({ name, avatar, size = 32, animate = false }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const names = name.trim().split(/\s+/);
  const initials = [firstGrapheme(names[0]), names.length > 1 ? firstGrapheme(names.at(-1)) : '']
    .join('')
    .toUpperCase();
  const url = avatar && (animate ? avatar.url : avatar.staticUrl);
  return (
    <span
      className={styles.avatar}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {url && failedUrl !== url ? (
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet={avatar!.staticUrl} />
          <img src={url} alt="" width={size} height={size} onError={() => setFailedUrl(url)} />
        </picture>
      ) : (
        initials || '?'
      )}
    </span>
  );
}
