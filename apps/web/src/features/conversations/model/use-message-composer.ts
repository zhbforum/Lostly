import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionGeneration } from '@/shared/api/session-events';
import { useConversationDraft, readConversationDraft } from './message-drafts';
import { useConversationSend } from './conversation-send-context';
import { analyzeMessageBody, normalizeMessageBody } from './message-body';
import { imageSelectionError } from './message-attachments';
import type { PendingSendOperation } from './send-operations';

const EMPTY: readonly PendingSendOperation[] = [];
export function useMessageComposer(conversationId: string, canSend: boolean) {
  const { draft, setDraft, generation } = useConversationDraft(conversationId);
  const scope = `${generation}:${conversationId}`;
  const [errors, setErrors] = useState<{
    scope: string;
    send: string | null;
    selection: string | null;
  }>({ scope, send: null, selection: null });
  const setError = useCallback(
    (kind: 'send' | 'selection', message: string | null) => {
      if (generation !== getSessionGeneration()) return;
      setErrors((previous) => ({
        ...(previous.scope === scope ? previous : { scope, send: null, selection: null }),
        [kind]: message,
      }));
    },
    [generation, scope],
  );
  const [now, setNow] = useState(Date.now);
  const submitting = useRef<string | null>(null);
  const { operations: registry, sendMessage, retry, subscribeToResults } = useConversationSend();
  const operations = registry[conversationId] ?? EMPTY;
  const hasUnresolvedOperation = operations.length > 0;
  const locked = !canSend || hasUnresolvedOperation;
  const isEditable = () =>
    !locked && submitting.current !== scope && generation === getSessionGeneration();
  const deadline = Math.max(0, ...operations.map((operation) => operation.retryAfterUntil ?? 0));
  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= deadline) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [deadline]);
  useEffect(
    () =>
      subscribeToResults((result) => {
        if (
          !('operation' in result) ||
          result.operation.conversationId !== conversationId ||
          result.status !== 'rejected'
        )
          return;
        // The provider has already restored the session-scoped draft, including files.
        setError(
          'send',
          result.error.code === 'IDEMPOTENCY_CONFLICT'
            ? "Couldn't safely retry this message. Refresh the conversation and send it again."
            : result.error.code === 'CONVERSATION_READ_ONLY'
              ? 'This conversation is read-only. Your draft has been kept.'
              : 'Could not send this message. Your draft has been kept.',
        );
      }),
    [conversationId, setError, subscribeToResults],
  );

  const analysis = analyzeMessageBody(draft.text);
  const normalized = analysis.normalization;
  const canSubmit =
    !locked &&
    normalized.status !== 'invalid' &&
    (normalized.status === 'text' || draft.images.length > 0);
  const submit = async () => {
    if (!isEditable()) return;
    // Read the current store as keyboard/programmatic handlers may precede a rerender.
    const current = readConversationDraft(conversationId, generation);
    const body = normalizeMessageBody(current.text);
    if (body.status === 'invalid' || (body.status === 'empty' && !current.images.length)) {
      setError('send', 'Write a valid message of up to 2000 Unicode characters, or attach images.');
      return;
    }
    submitting.current = scope;
    setError('send', null);
    try {
      let started: ReturnType<typeof sendMessage>;
      try {
        started = sendMessage(conversationId, {
          body: body.status === 'text' ? body.body : null,
          images: current.images,
        });
      } catch {
        setError('send', 'Could not start sending this message. Your draft has been kept.');
        return;
      }
      if (!started.accepted) return;
      // Only the registry retains accepted files. Previews belong to the cleared draft UI.
      setDraft({ text: '', images: [] });
      setError('selection', null);
      await started.completion;
    } finally {
      if (submitting.current === scope) submitting.current = null;
    }
  };

  return {
    draft,
    setText: (text: string) => {
      if (isEditable()) setDraft((previous) => ({ ...previous, text }));
    },
    addImages: (images: readonly File[]) => {
      if (!isEditable() || !images.length) return;
      const current = readConversationDraft(conversationId, generation);
      const error = imageSelectionError(images, current.images.length);
      setError('selection', error);
      if (!error) setDraft({ ...current, images: [...current.images, ...images] });
    },
    removeImage: (index: number) => {
      if (!isEditable()) return false;
      const current = readConversationDraft(conversationId, generation);
      if (index < 0 || index >= current.images.length) return false;
      setDraft({ ...current, images: current.images.filter((_, position) => position !== index) });
      setError('selection', null);
      return true;
    },
    error: errors.scope === scope ? errors.send : null,
    selectionError: errors.scope === scope ? errors.selection : null,
    operations,
    submit,
    canSubmit,
    locked,
    hasDraft: draft.text.length > 0 || draft.images.length > 0,
    invalidText: normalized.status === 'invalid',
    count: analysis.count,
    overLimit: analysis.overLimit,
    hasUnresolvedOperation,
    retry: (operationId: string) => retry(conversationId, operationId),
    retrySeconds: (operation: PendingSendOperation) =>
      Math.max(0, Math.ceil(((operation.retryAfterUntil ?? 0) - Math.max(now, Date.now())) / 1000)),
  };
}
