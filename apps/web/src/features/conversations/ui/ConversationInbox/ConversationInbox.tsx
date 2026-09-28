import type { useConversationInbox } from '../../model/use-conversation-inbox';
import { ConversationListItem } from '../ConversationListItem/ConversationListItem';
import styles from './ConversationInbox.module.css';

interface Props {
  inbox: ReturnType<typeof useConversationInbox>;
  selectedId?: string;
  linkState?: { messagesInboxKey: string };
}

export function ConversationInbox({ inbox, selectedId, linkState }: Props) {
  return (
    <section className={styles.inbox} aria-labelledby="inbox-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your conversations</p>
          <h1 id="inbox-heading" tabIndex={-1}>
            Messages
          </h1>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={inbox.refresh}
          disabled={inbox.refreshing}
          aria-label="Refresh conversations"
          title="Refresh conversations"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-5l-3 3M5 13a7 7 0 0 0 12 5l3-3" />
          </svg>
        </button>
      </div>
      <div
        className={styles.scroll}
        data-testid="inbox-scroll"
        aria-busy={!inbox.initialized && inbox.refreshing}
      >
        {!inbox.initialized && inbox.refreshing && (
          <p className={styles.notice} role="status">
            Loading conversations…
          </p>
        )}
        {inbox.error && (
          <div className={styles.error} role={inbox.initialized ? 'status' : 'alert'}>
            <p>{inbox.error}</p>
            <button type="button" onClick={inbox.refresh} disabled={inbox.refreshing}>
              Try again
            </button>
          </div>
        )}
        {inbox.initialized && inbox.conversations.length === 0 && (
          <div className={styles.empty}>
            <h2>No conversations yet</h2>
            <p>Your conversations about claims will appear here.</p>
          </div>
        )}
        {inbox.conversations.length > 0 && (
          <ul className={styles.list}>
            {inbox.conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                linkState={linkState}
              />
            ))}
          </ul>
        )}
        {inbox.moreError && (
          <p className={styles.error} role="alert">
            {inbox.moreError}
          </p>
        )}
        {inbox.hasMore && (
          <div className={styles.footer}>
            <button
              type="button"
              onClick={() => void inbox.loadMore()}
              disabled={inbox.loadingMore}
              aria-busy={inbox.loadingMore}
            >
              {inbox.loadingMore
                ? 'Loading more…'
                : inbox.moreError
                  ? 'Retry loading more'
                  : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
