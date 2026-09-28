import { useState } from 'react';
import { Link } from 'react-router';
import { formatConversationActivity } from '../../model/conversation-formatters';
import type { ConversationSummary } from '../../model/types';
import styles from './ConversationListItem.module.css';

export function ConversationListItem({
  conversation,
  selected,
  linkState,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  linkState?: { messagesInboxKey: string };
}) {
  const { listing, otherParticipant, lastMessage, unreadCount, claim, canSendMessages } =
    conversation;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = listing.coverImage;
  return (
    <li className={styles.item}>
      <Link
        to={`/messages/${encodeURIComponent(conversation.id)}`}
        state={linkState}
        className={styles.row}
        data-conversation-id={conversation.id}
        data-unread={unreadCount > 0 || undefined}
        aria-current={selected ? 'page' : undefined}
      >
        <span className={styles.cover} aria-hidden="true">
          {cover && cover.url !== failedUrl ? (
            <img
              src={cover.url}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(cover.url)}
            />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              focusable="false"
            >
              <path d="M8 6V4h8v2M5 6h14v14H5zM9 10h6" />
            </svg>
          )}
        </span>
        <span className={styles.content}>
          <span className={styles.top}>
            <span className={styles.title}>{listing.title}</span>
            <time
              className={styles.time}
              dateTime={conversation.lastActivityAt}
              title={new Date(conversation.lastActivityAt).toLocaleString('en')}
            >
              {formatConversationActivity(conversation.lastActivityAt)}
            </time>
          </span>
          <span className={styles.participant}>
            {otherParticipant.displayName}
            {unreadCount > 0 && (
              <span className={styles.unread}>
                <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
                <span className={styles.srOnly}>
                  {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
                </span>
              </span>
            )}
          </span>
          <span className={styles.preview}>
            {lastMessage?.body ?? 'Claim submitted · No messages yet'}
          </span>
          <span className={styles.status}>
            {!canSendMessages
              ? 'Read-only'
              : claim.status === 'approved'
                ? 'Claim approved'
                : 'Pending claim'}
          </span>
        </span>
      </Link>
    </li>
  );
}
