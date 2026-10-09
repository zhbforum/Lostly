import { useLayoutEffect, useRef } from 'react';
import type { useMessageComposer } from '../../model/use-message-composer';
import { CONVERSATION_CONSTRAINTS, CONVERSATION_IMAGE_CONSTRAINTS } from '../../model/types';
import { SelectedImagePreviews } from './SelectedImagePreviews';
import styles from './MessageComposer.module.css';

export function MessageComposer({ composer }: { composer: ReturnType<typeof useMessageComposer> }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const maxImages = CONVERSATION_IMAGE_CONSTRAINTS.maxCount;
  const maxLength = CONVERSATION_CONSTRAINTS.messageMaxLength;
  const composing = useRef(false);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
    }
  }, [composer.draft.text]);
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) void composer.submit();
      }}
    >
      <SelectedImagePreviews
        files={composer.draft.images}
        disabled={composer.locked}
        onRemove={composer.removeImage}
      />
      <label className={styles.srOnly} htmlFor="conversation-draft">
        Write a message
      </label>
      <textarea
        id="conversation-draft"
        ref={textarea}
        value={composer.draft.text}
        readOnly={composer.locked}
        rows={1}
        placeholder="Write a message…"
        aria-describedby={
          composer.hasUnresolvedOperation
            ? 'message-delivery-notice'
            : composer.count >= 1800
              ? 'message-count'
              : undefined
        }
        aria-invalid={composer.invalidText || undefined}
        onChange={(event) => composer.setText(event.target.value)}
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
      <input
        ref={picker}
        className={styles.srOnly}
        type="file"
        multiple
        accept={CONVERSATION_IMAGE_CONSTRAINTS.allowedContentTypes.join(',')}
        aria-label="Choose images"
        aria-describedby={composer.selectionError ? 'image-selection-error' : 'image-count'}
        disabled={composer.locked || composer.draft.images.length >= maxImages}
        onChange={(event) => {
          const input = event.currentTarget;
          try {
            composer.addImages([...(input.files ?? [])]);
          } finally {
            input.value = '';
          }
        }}
      />
      {composer.selectionError && (
        <p id="image-selection-error" role="alert" className={styles.invalid}>
          {composer.selectionError}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.addPhotos}
          disabled={composer.locked || composer.draft.images.length >= maxImages}
          onClick={() => picker.current?.click()}
        >
          Add photos
        </button>
        <span
          id="image-count"
          role="status"
          aria-label={`${composer.draft.images.length} of ${maxImages} images selected`}
        >
          {composer.draft.images.length}/{maxImages}
        </span>
        {composer.count >= 1800 && (
          <span id="message-count" className={composer.overLimit ? styles.invalid : undefined}>
            {composer.overLimit ? `${maxLength}+` : composer.count} / {maxLength}
          </span>
        )}
        <button type="submit" disabled={!composer.canSubmit}>
          Send <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
