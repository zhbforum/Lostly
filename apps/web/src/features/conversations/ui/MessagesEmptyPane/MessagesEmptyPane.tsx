import styles from './MessagesEmptyPane.module.css';

export function MessagesEmptyPane() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon} aria-hidden="true">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M20 11a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 17 0Z" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      </span>
      <h2>Select a conversation</h2>
      <p>Choose a conversation to keep in touch about an item.</p>
    </div>
  );
}
