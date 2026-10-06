import { messageTime } from '../../model/conversation-formatters';
import { imageCountLabel } from '../../model/message-attachments';
import type { ClaimMessage } from '../../model/types';
import type { PendingSendOperation } from '../../model/send-operations';
import type { MessageAttachmentResource } from '../../model/attachment-resource';
import type { RefObject } from 'react';
import { MessageAttachments } from '../MessageAttachments/MessageAttachments';
import styles from './MessageBubble.module.css';

export function MessageBubble({
  message,
  own,
  grouped,
  sender,
  attachmentResource,
  onUnavailable,
  root,
}: {
  message: ClaimMessage;
  own: boolean;
  grouped: boolean;
  sender: string;
  attachmentResource: MessageAttachmentResource;
  onUnavailable: (error: unknown) => void;
  root?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <li className={styles.row} data-own={own} data-grouped={grouped} data-message-id={message.id}>
      {!own && !grouped && (
        <span className={styles.avatar} aria-hidden="true">
          {Array.from(sender)[0]}
        </span>
      )}
      <div className={styles.message}>
        <span className={styles.srOnly}>{own ? 'You' : sender}: </span>
        {message.body !== null && <p className={styles.bubble}>{message.body}</p>}
        <MessageAttachments
          resource={attachmentResource}
          onUnavailable={onUnavailable}
          root={root}
        />
        <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
      </div>
    </li>
  );
}

export function PendingBubble({
  operation,
  seconds,
  onRetry,
}: {
  operation: PendingSendOperation;
  seconds: number;
  onRetry: () => void;
}) {
  return (
    <li className={styles.row} data-own="true" data-operation-id={operation.operationId}>
      <div className={styles.message}>
        {operation.body !== null && <p className={styles.bubble}>{operation.body}</p>}
        {operation.images.length > 0 && (
          <p className={styles.bubble}>{imageCountLabel(operation.images.length)}</p>
        )}
        <div className={styles.delivery}>
          <span role="status">
            {operation.status === 'sending'
              ? 'Sending…'
              : operation.status === 'uncertain'
                ? 'Delivery status unknown'
                : 'Temporarily rate-limited.'}
          </span>
          {operation.status === 'rate-limited' && (
            <span>{seconds > 0 ? `Try again in ${seconds}s.` : 'You can retry now.'}</span>
          )}
          {operation.status !== 'sending' && (
            <button
              type="button"
              onClick={onRetry}
              disabled={operation.status === 'rate-limited' && seconds > 0}
            >
              {operation.status === 'uncertain' ? 'Retry to confirm' : 'Retry'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
