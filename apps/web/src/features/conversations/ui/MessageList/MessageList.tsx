import { Fragment } from 'react';
import { messageDay } from '../../model/conversation-formatters';
import type { useConversationThread } from '../../model/use-conversation-thread';
import type { useMessageComposer } from '../../model/use-message-composer';
import type { useMessageScroll } from '../../model/use-message-scroll';
import { MessageBubble, PendingBubble } from '../MessageBubble/MessageBubble';
import styles from './MessageList.module.css';

export function MessageList({
  thread,
  composer,
  scroll: { root: historyRef, onScroll, earlier, hasNew, bottom, announcement },
  userId,
}: {
  thread: ReturnType<typeof useConversationThread>;
  composer: ReturnType<typeof useMessageComposer>;
  scroll: ReturnType<typeof useMessageScroll>;
  userId: string;
}) {
  const { history } = thread;
  return (
    <div className={styles.wrapper}>
      <div
        className={styles.scroll}
        ref={historyRef}
        onScroll={onScroll}
        aria-label="Message history"
        role="region"
        aria-busy={!history.initialized && !thread.historyError}
        tabIndex={0}
      >
        {!history.initialized && !thread.historyError && (
          <p role="status" className={styles.notice}>
            Loading messages…
          </p>
        )}
        {thread.historyError && (
          <div role={history.initialized ? 'status' : 'alert'} className={styles.notice}>
            <p>{thread.historyError}</p>
            <button onClick={thread.refreshMessages}>Retry messages</button>
          </div>
        )}
        {history.hasOlder && (
          <div className={styles.earlier}>
            <button disabled={thread.loadingOlder} onClick={() => void earlier()}>
              {thread.loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {thread.olderError && (
          <p role="alert" className={styles.notice}>
            {thread.olderError}
          </p>
        )}
        {history.initialized &&
          history.messages.length === 0 &&
          composer.operations.length === 0 && (
            <p className={styles.notice}>
              {thread.context?.canSendMessages
                ? 'No messages yet. Start the conversation about this item.'
                : 'No messages were sent in this conversation.'}
            </p>
          )}
        <ol className={styles.list} aria-label="Messages">
          {history.messages.map((message, index) => {
            const previous = history.messages[index - 1];
            const day = messageDay(message.createdAt);
            const sameDay = previous && messageDay(previous.createdAt) === day;
            return (
              <Fragment key={message.id}>
                {!sameDay && (
                  <li className={styles.date}>
                    <time dateTime={message.createdAt}>{day}</time>
                  </li>
                )}
                <MessageBubble
                  message={message}
                  own={message.senderUserId === userId}
                  sender={thread.context?.otherParticipant.displayName ?? 'Participant'}
                  grouped={Boolean(sameDay && previous.senderUserId === message.senderUserId)}
                />
              </Fragment>
            );
          })}
          {composer.operations.map((operation) => (
            <PendingBubble
              key={operation.operationId}
              operation={operation}
              seconds={composer.retrySeconds(operation)}
              onRetry={() => void composer.retry(operation.operationId)}
            />
          ))}
        </ol>
      </div>
      {hasNew && (
        <button className={styles.newMessages} onClick={() => bottom(true)}>
          ↓ New messages
        </button>
      )}
      <div
        className={styles.srOnly}
        aria-live="polite"
        aria-atomic="true"
        data-testid="message-announcer"
      >
        <span key={announcement.revision}>{announcement.text}</span>
      </div>
    </div>
  );
}
