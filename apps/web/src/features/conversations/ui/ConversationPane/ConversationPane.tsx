import { useConversationPane } from '../../model/use-conversation-pane';
import { ConversationHeader } from '../ConversationHeader/ConversationHeader';
import { ConversationContext } from '../ConversationContext/ConversationContext';
import { MessageList } from '../MessageList/MessageList';
import { MessageComposer } from '../MessageComposer/MessageComposer';
import styles from './ConversationPane.module.css';
import { ReportButton } from '@/features/moderation/ReportButton';

export function ConversationPane({ conversationId }: { conversationId: string }) {
  const { thread, composer, scroll, read, decision, userId, onReturn } =
    useConversationPane(conversationId);
  return (
    <div className={styles.pane}>
      <ConversationHeader
        context={thread.context}
        unavailable={thread.unavailable}
        onReturn={onReturn}
      />
      {thread.unavailable ? (
        <div className={styles.notice}>
          <h3>This conversation is no longer available.</h3>
          <button onClick={onReturn}>Back to messages</button>
        </div>
      ) : (
        <>
          {thread.contextError && (
            <div className={styles.notice} role={thread.context ? 'status' : 'alert'}>
              {thread.contextError} <button onClick={thread.refreshContext}>Retry details</button>
            </div>
          )}
          {!thread.context && !thread.contextError && (
            <p className={styles.notice} role="status">
              Loading conversation details…
            </p>
          )}
          {thread.context && (
            <>
              <ConversationContext conversation={thread.context} decision={decision} />
              <ReportButton
                targetType="conversation"
                targetId={conversationId}
                label="Report this conversation"
              />
            </>
          )}
          <MessageList thread={thread} composer={composer} scroll={scroll} userId={userId} />
          {read.error && (
            <p className={styles.notice} role="status">
              {read.error} <button onClick={read.retry}>Retry read status</button>
            </p>
          )}
          {composer.error && (
            <p className={styles.notice} role="alert">
              {composer.error}
            </p>
          )}
          {thread.context &&
            (thread.context.canSendMessages ? (
              <MessageComposer composer={composer} />
            ) : (
              <section className={styles.readonly} aria-label="Read-only conversation">
                <p role="status">
                  {thread.context.moderationClosed
                    ? 'Messaging has been paused by moderation.'
                    : 'This conversation is read-only.'}
                  {composer.hasDraft && ' Your unsent draft has been kept for this session.'}
                </p>
                {composer.draft.images.length > 0 && (
                  <p>
                    {composer.draft.images.length} unsent{' '}
                    {composer.draft.images.length === 1 ? 'photo' : 'photos'} attached.
                  </p>
                )}
                {composer.draft.text.length > 0 && (
                  <>
                    <label htmlFor="unsent-conversation-draft">Unsent draft</label>
                    <p id="unsent-draft-hint">
                      You can select and copy this text. It has not been sent.
                    </p>
                    <textarea
                      id="unsent-conversation-draft"
                      value={composer.draft.text}
                      readOnly
                      rows={3}
                      aria-describedby="unsent-draft-hint"
                    />
                  </>
                )}
              </section>
            ))}
        </>
      )}
    </div>
  );
}
