import { useLayoutEffect, useRef } from 'react';
import type { useMessageComposer } from '../../model/use-message-composer';
import styles from './MessageComposer.module.css';

export function MessageComposer({ composer }: { composer: ReturnType<typeof useMessageComposer> }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
    }
  }, [composer.draft]);
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) void composer.submit();
      }}
    >
      <label className={styles.srOnly} htmlFor="conversation-draft">
        Write a message
      </label>
      <textarea
        id="conversation-draft"
        ref={textarea}
        value={composer.draft}
        readOnly={composer.hasUnresolvedOperation}
        rows={1}
        placeholder="Write a message…"
        aria-describedby={
          composer.hasUnresolvedOperation
            ? 'message-delivery-notice'
            : composer.count >= 1800
              ? 'message-count'
              : undefined
        }
        aria-invalid={composer.count > 2000 || undefined}
        onChange={(event) => composer.setDraft(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            !composing.current
          ) {
            event.preventDefault();
            void composer.submit();
          }
        }}
      />
      {composer.hasUnresolvedOperation && (
        <p id="message-delivery-notice" className={styles.notice}>
          Resolve your previous message before writing another.
        </p>
      )}
      <div className={styles.actions}>
        {composer.count >= 1800 && (
          <span id="message-count" className={composer.count > 2000 ? styles.invalid : undefined}>
            {composer.count} / 2000
          </span>
        )}
        <button type="submit" disabled={composer.hasUnresolvedOperation || !composer.draft.trim()}>
          Send <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
