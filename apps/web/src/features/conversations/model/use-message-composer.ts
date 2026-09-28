import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormDraft } from '@/shared/model/use-form-draft';
import { useConversationSend } from './conversation-send-context';
import { normalizeMessageBody } from './message-body';
import type { PendingSendOperation } from './send-operations';

const EMPTY: readonly PendingSendOperation[] = [];
export function useMessageComposer(conversationId: string, canSend: boolean) {
  const [draft, setDraft] = useFormDraft(`conversation:${conversationId}`, () => '');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const submitting = useRef(false);
  const { operations: registry, sendMessage, retry, subscribeToResults } = useConversationSend();
  const operations = registry[conversationId] ?? EMPTY;
  const hasUnresolvedOperation = operations.length > 0;
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
        setDraft(result.operation.body);
        setError(
          result.error.code === 'IDEMPOTENCY_CONFLICT'
            ? "Couldn't safely retry this message. Refresh the conversation and send it again."
            : result.error.code === 'CONVERSATION_READ_ONLY'
              ? 'This conversation is read-only. Your draft has been kept.'
              : 'Could not send this message. Your draft has been kept.',
        );
      }),
    [conversationId, setDraft, subscribeToResults],
  );

  const updateDraft = useCallback(
    (value: string) => {
      if (!hasUnresolvedOperation && !submitting.current) setDraft(value);
    },
    [hasUnresolvedOperation, setDraft],
  );
  const submit = useCallback(async () => {
    if (!canSend || submitting.current || hasUnresolvedOperation) return;
    const body = normalizeMessageBody(draft);
    if (body === null) {
      setError('Write a message of 1–2000 Unicode characters, without invalid characters.');
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      let started: ReturnType<typeof sendMessage>;
      try {
        started = sendMessage(conversationId, body);
      } catch {
        setError('Could not start sending this message. Your draft has been kept.');
        return;
      }
      if (!started.accepted) return;

      // From this point the session-level registry owns the outgoing body.
      setDraft('');
      await started.completion;
    } finally {
      submitting.current = false;
    }
  }, [canSend, conversationId, draft, hasUnresolvedOperation, sendMessage, setDraft]);

  return {
    draft,
    setDraft: updateDraft,
    error,
    operations,
    submit,
    count: Array.from(draft.replace(/\r\n?/g, '\n').trim()).length,
    hasUnresolvedOperation,
    retry: (operationId: string) => retry(conversationId, operationId),
    retrySeconds: (operation: PendingSendOperation) =>
      Math.max(0, Math.ceil(((operation.retryAfterUntil ?? 0) - Math.max(now, Date.now())) / 1000)),
  };
}
