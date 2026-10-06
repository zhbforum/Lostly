import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionGeneration } from '@/shared/api/session-events';
import { useVisiblePolling } from '@/shared/model/use-visible-polling';
import { getConversation } from '../api/conversations-api';
import { useConversationSend } from './conversation-send-context';
import { isConversationUnavailable } from './conversation-errors';
import { createMessageHistory, emptyMessageHistory } from './message-history';
import { CONVERSATION_POLLING } from './polling-intervals';
import { createRequestRevision } from './request-revision';
import type { ConversationDetail, ReadConversationResponse } from './types';

const initial = () => ({
  context: null as ConversationDetail | null,
  history: emptyMessageHistory(),
  contextError: null as string | null,
  historyError: null as string | null,
  olderError: null as string | null,
  loadingOlder: false,
  unavailable: false,
  sentVersion: 0,
});
type Snapshot = ReturnType<typeof initial>;
type Runtime = {
  snapshot: Snapshot;
  history: ReturnType<typeof createMessageHistory>;
  unsubscribe: () => void;
  revision: ReturnType<typeof createRequestRevision>;
  abort: AbortController;
  generation: number;
};

/** Mounted with a conversation/session key. No state here outlives that resource. */
export function useConversationThread(
  conversationId: string,
  onUnavailable: (id: string, error: unknown) => boolean,
  onActivity: () => void,
) {
  const [snapshot, setSnapshot] = useState(initial);
  const current = useRef<Runtime | null>(null);
  const { subscribeToResults } = useConversationSend();
  const active = useCallback(
    (runtime: Runtime) =>
      current.current === runtime && runtime.generation === getSessionGeneration(),
    [],
  );
  const publish = useCallback(
    (runtime: Runtime, patch: Partial<Snapshot>) => {
      if (!active(runtime)) return;
      runtime.snapshot = { ...runtime.snapshot, ...patch };
      setSnapshot(runtime.snapshot);
    },
    [active],
  );

  useEffect(() => {
    const history = createMessageHistory(conversationId);
    const runtime: Runtime = {
      snapshot: initial(),
      history,
      unsubscribe: () => {},
      revision: createRequestRevision(),
      abort: new AbortController(),
      generation: getSessionGeneration(),
    };
    current.current = runtime;
    runtime.unsubscribe = history.subscribe(() =>
      publish(runtime, { history: history.getSnapshot() }),
    );
    return () => {
      runtime.unsubscribe();
      runtime.history.dispose();
      runtime.revision.dispose();
      runtime.abort.abort();
      if (current.current === runtime) current.current = null;
    };
  }, [conversationId, publish]);

  const reportError = useCallback(
    (error: unknown) => {
      const runtime = current.current;
      if (!runtime || !active(runtime) || !isConversationUnavailable(error)) return false;
      publish(runtime, { unavailable: true });
      runtime.abort.abort();
      runtime.history.dispose();
      onUnavailable(conversationId, error);
      return true;
    },
    [active, conversationId, onUnavailable, publish],
  );

  const contextTask = useCallback(
    async (signal: AbortSignal) => {
      const runtime = current.current;
      if (!runtime || runtime.snapshot.unavailable) return;
      const token = runtime.revision.capture();
      const requestSignal = AbortSignal.any([runtime.abort.signal, signal]);
      try {
        const { conversation } = await getConversation(conversationId, requestSignal);
        if (requestSignal.aborted || !runtime.revision.isCurrent(token)) return;
        publish(runtime, { context: conversation, contextError: null });
      } catch (error) {
        if (requestSignal.aborted || !runtime.revision.isCurrent(token)) return;
        if (!reportError(error))
          publish(runtime, { contextError: 'Could not load conversation details.' });
      }
    },
    [conversationId, publish, reportError],
  );
  const historyTask = useCallback(
    async (signal: AbortSignal) => {
      const runtime = current.current;
      if (!runtime || runtime.snapshot.unavailable) return;
      const history = runtime.history;
      try {
        if (!history.getSnapshot().initialized) await history.loadInitial(signal);
        else await history.catchUp(signal);
        if (!signal.aborted && runtime.history === history)
          publish(runtime, { historyError: null });
      } catch (error) {
        if (
          signal.aborted ||
          !active(runtime) ||
          runtime.history !== history ||
          runtime.snapshot.unavailable
        )
          return;
        if (!reportError(error))
          publish(runtime, {
            historyError: history.getSnapshot().initialized
              ? 'Could not check for new messages. We will try again.'
              : 'Could not load message history.',
          });
      }
    },
    [active, publish, reportError],
  );
  const refreshContext = useVisiblePolling({
    task: contextTask,
    intervalMs: CONVERSATION_POLLING.context,
    enabled: !snapshot.unavailable,
  });
  const refreshMessages = useVisiblePolling({
    task: historyTask,
    intervalMs: CONVERSATION_POLLING.messages,
    enabled: !snapshot.unavailable,
  });

  useEffect(
    () =>
      subscribeToResults((result) => {
        const runtime = current.current;
        if (
          !runtime ||
          !active(runtime) ||
          runtime.snapshot.unavailable ||
          !('operation' in result) ||
          result.operation.conversationId !== conversationId
        )
          return;
        if (result.status === 'sent') {
          runtime.history.acceptSentMessage(result.message);
          publish(runtime, { sentVersion: runtime.snapshot.sentVersion + 1 });
          onActivity();
        } else if ('error' in result && result.error && !reportError(result.error)) {
          if (result.error.code === 'CONVERSATION_READ_ONLY') refreshContext();
        }
      }),
    [active, conversationId, onActivity, publish, refreshContext, reportError, subscribeToResults],
  );

  const loadOlder = useCallback(async () => {
    const runtime = current.current;
    if (!runtime || runtime.snapshot.loadingOlder || runtime.snapshot.unavailable) return false;
    const history = runtime.history;
    const first = history.getSnapshot().oldestLoadedSequence;
    publish(runtime, { loadingOlder: true, olderError: null });
    try {
      await history.loadOlder();
      return history.getSnapshot().oldestLoadedSequence !== first;
    } catch (error) {
      if (
        active(runtime) &&
        runtime.history === history &&
        !runtime.snapshot.unavailable &&
        !reportError(error)
      ) {
        publish(runtime, { olderError: 'Could not load earlier messages.' });
      }
      return false;
    } finally {
      if (runtime.history === history) publish(runtime, { loadingOlder: false });
    }
  }, [active, publish, reportError]);

  const applyRead = useCallback(
    (response: ReadConversationResponse) => {
      const runtime = current.current;
      if (!runtime || runtime.snapshot.unavailable) return;
      runtime.revision.invalidate();
      if (runtime.snapshot.context)
        publish(runtime, {
          context: { ...runtime.snapshot.context, unreadCount: response.unreadCount },
        });
      refreshContext();
    },
    [publish, refreshContext],
  );

  const reconcileReadTarget = useCallback(async () => {
    const runtime = current.current;
    if (!runtime || runtime.snapshot.unavailable) return;
    runtime.history.dispose();
    runtime.unsubscribe();
    const history = createMessageHistory(conversationId);
    runtime.history = history;
    runtime.unsubscribe = history.subscribe(() =>
      publish(runtime, { history: history.getSnapshot() }),
    );
    publish(runtime, {
      history: history.getSnapshot(),
      loadingOlder: false,
      olderError: null,
    });
    refreshContext();
    await historyTask(runtime.abort.signal);
  }, [conversationId, historyTask, publish, refreshContext]);

  return {
    ...snapshot,
    refreshContext,
    refreshMessages,
    loadOlder,
    applyRead,
    reconcileReadTarget,
    reportError,
    attachmentResource: (messageId: string) =>
      current.current!.history.attachmentResource(messageId),
  };
}
