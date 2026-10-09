import type { MouseEvent, RefObject } from 'react';
import { attachmentExpiry } from '../../model/attachment-capabilities';
import type { MessageAttachmentResource } from '../../model/attachment-resource';
import { imageCountLabel } from '../../model/message-attachments';
import { useMessageAttachments } from '../../model/use-message-attachments';
import styles from './MessageAttachments.module.css';

export function MessageAttachments({
  resource,
  onUnavailable,
  root,
}: {
  resource: MessageAttachmentResource;
  onUnavailable: (error: unknown) => void;
  root?: RefObject<HTMLDivElement | null>;
}) {
  const { state, element, retry, recheck, expiredMask } = useMessageAttachments(
    resource,
    onUnavailable,
    root,
  );
  const { attachments, version } = state;
  const expired = expiredMask !== 0;
  if (!attachments.length && !state.unavailable) return null;
  return (
    <div
      ref={element}
      className={styles.group}
      role="group"
      aria-label={
        state.unavailable ? 'Attachments unavailable' : imageCountLabel(attachments.length)
      }
    >
      <div className={styles.grid} data-count={attachments.length}>
        {attachments.map((attachment, index) => {
          const label = `Attached image ${index + 1} of ${attachments.length}`;
          // Bound display geometry; object-fit: contain preserves the full intrinsic image.
          const presentationRatio = Math.min(
            2,
            Math.max(0.5, attachment.width / attachment.height),
          );
          const usable = !(expiredMask & (1 << index)) && !state.failed.includes(attachment.id);
          const open = (event: MouseEvent<HTMLAnchorElement>) => {
            if (!resource.isCurrent(version)) {
              event.preventDefault();
              return;
            }
            if (attachmentExpiry(attachment) <= Date.now()) {
              event.preventDefault();
              recheck();
              void retry();
            }
          };
          return (
            <div
              // New effective sets need new load evidence; equal sets retain these DOM nodes.
              key={`${resource.id}:${version}:${attachment.id}`}
              className={styles.cell}
              style={{ aspectRatio: String(presentationRatio) }}
            >
              {usable ? (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  onClick={open}
                  onAuxClick={open}
                >
                  <img
                    src={attachment.url}
                    width={attachment.width}
                    height={attachment.height}
                    alt={label}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={() => resource.loaded(version, attachment.id)}
                    onError={() => resource.failed(version, attachment.id)}
                  />
                </a>
              ) : (
                <span className={styles.placeholder} role="img" aria-label={`${label} unavailable`}>
                  Photo unavailable
                </span>
              )}
            </div>
          );
        })}
      </div>
      {state.unavailable && <p>Attachments unavailable</p>}
      {state.refreshing ? (
        <p role="status">Refreshing images…</p>
      ) : (
        (state.unavailable || state.retryable || state.failed.length > 0 || expired) && (
          <div className={styles.recovery}>
            {!state.unavailable && <span>Some images are unavailable or need refreshing.</span>}
            <button type="button" onClick={() => void retry()}>
              Retry images
            </button>
          </div>
        )
      )}
    </div>
  );
}
