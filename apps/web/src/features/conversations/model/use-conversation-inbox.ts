import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';
import { useVisiblePolling } from '@/shared/model/use-visible-polling';
import { getConversationInbox } from '../api/conversations-api';
import {
  emptyInbox,
  applyInboxDecision,
  applyInboxRead,
  mergeInboxPage,
  removeInboxConversation,
  sortedInbox,
  type ConversationInboxState,
} from './inbox-merge';
import { CONVERSATION_POLLING } from './polling-intervals';
import { createRequestRevision } from './request-revision';
import type { Claim } from '@/features/claims/model/types';

interface Snapshot {
  generation: number;
  data: ConversationInboxState;
  initialized: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  moreError: string | null;
  unavailableIds: ReadonlySet<string>;
}
const initialSnapshot = (generation: number): Snapshot => ({
  generation,
  data: emptyInbox(),
  initialized: false,
  refreshing: true,
  loadingMore: false,
  error: null,
  moreError: null,
  unavailableIds: new Set(),
});
interface Runtime {
  snapshot: Snapshot;
  revision: ReturnType<typeof createRequestRevision>;
  controllers: Set<AbortController>;
  tail: Promise<void>;
  append: Promise<void> | null;
}

export function useConversationInbox() {
  const generation = useSyncExternalStore(subscribeToSessionGeneration, getSessionGeneration);
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(generation));
  const current = useRef<Runtime | null>(null);
  useEffect(() => {
    const runtime: Runtime = {
      snapshot: initialSnapshot(generation),
      revision: createRequestRevision(),
      controllers: new Set(),
      tail: Promise.resolve(),
      append: null,
    };
    current.current = runtime;
    return () => {
      runtime.revision.dispose();
      for (const controller of runtime.controllers) controller.abort();
      if (current.current === runtime) current.current = null;
    };
  }, [generation]);

  const publish = useCallback((runtime: Runtime, patch: Partial<Snapshot>) => {
    if (current.current !== runtime || runtime.snapshot.generation !== getSessionGeneration())
      return;
    runtime.snapshot = { ...runtime.snapshot, ...patch };
    setSnapshot(runtime.snapshot);
  }, []);

  const request = useCallback(
    (kind: 'head' | 'append', signal?: AbortSignal): Promise<void> => {
      const runtime = current.current;
      if (!runtime || runtime.snapshot.generation !== getSessionGeneration())
        return Promise.resolve();
      if (kind === 'append' && runtime.append) return runtime.append;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      runtime.controllers.add(controller);
      publish(runtime, kind === 'head' ? { refreshing: true } : { loadingMore: true });
      // Serialize head and continuation requests so an older page cannot overwrite a newer refresh.
      const pending = runtime.tail
        .then(async () => {
          if (controller.signal.aborted || current.current !== runtime) return;
          const token = runtime.revision.capture();
          const before = runtime.snapshot;
          if (
            kind === 'append' &&
            (!before.initialized || !before.data.hasMore || !before.data.loadMoreCursor)
          )
            return;
          try {
            const page = await getConversationInbox(
              {
                limit: 20,
                cursor: kind === 'append' ? before.data.loadMoreCursor! : undefined,
              },
              controller.signal,
            );
            if (controller.signal.aborted || !runtime.revision.isCurrent(token)) return;
            const unavailableIds = new Set(runtime.snapshot.unavailableIds);
            for (const row of page.conversations) unavailableIds.delete(row.id);
            publish(runtime, {
              data: mergeInboxPage(
                runtime.snapshot.data,
                page,
                kind === 'append' ? 'append' : before.initialized ? 'refresh' : 'initial',
              ),
              initialized: true,
              unavailableIds,
              ...(kind === 'head' ? { error: null } : { moreError: null }),
            });
          } catch {
            if (!controller.signal.aborted && runtime.revision.isCurrent(token)) {
              publish(
                runtime,
                kind === 'head'
                  ? {
                      error: before.initialized
                        ? 'Could not refresh messages. Your conversations are still available.'
                        : 'Could not load your conversations.',
                    }
                  : { moreError: 'Could not load more conversations.' },
              );
            }
          }
        })
        .finally(() => {
          runtime.controllers.delete(controller);
          signal?.removeEventListener('abort', abort);
          publish(runtime, kind === 'head' ? { refreshing: false } : { loadingMore: false });
          if (runtime.append === pending) runtime.append = null;
        });
      runtime.tail = pending;
      if (kind === 'append') runtime.append = pending;
      return pending;
    },
    [publish],
  );
  const task = useCallback((signal: AbortSignal) => request('head', signal), [request]);
  const poll = useVisiblePolling({
    task,
    intervalMs: CONVERSATION_POLLING.inbox,
    resourceKey: generation,
  });
  const refresh = useCallback(() => {
    current.current?.revision.invalidate();
    poll();
  }, [poll]);
  const loadMore = useCallback(() => request('append'), [request]);
  const applyRead = useCallback(
    (id: string, unreadCount: number) => {
      const runtime = current.current;
      if (!runtime) return;
      runtime.revision.invalidate();
      publish(runtime, { data: applyInboxRead(runtime.snapshot.data, id, unreadCount) });
      poll();
    },
    [poll, publish],
  );
  const removeConversation = useCallback(
    (id: string) => {
      const runtime = current.current;
      if (!runtime) return;
      runtime.revision.invalidate();
      const unavailableIds = new Set(runtime.snapshot.unavailableIds).add(id);
      publish(runtime, {
        data: removeInboxConversation(runtime.snapshot.data, id),
        unavailableIds,
      });
      poll();
    },
    [poll, publish],
  );
  const applyDecision = useCallback(
    (claim: Claim) => {
      const runtime = current.current;
      if (!runtime || claim.status === 'pending') return;
      runtime.revision.invalidate();
      publish(runtime, {
        data: applyInboxDecision(runtime.snapshot.data, claim.listingId, claim.id, claim.status),
      });
      poll();
    },
    [poll, publish],
  );
  const visible = snapshot.generation === generation ? snapshot : initialSnapshot(generation);
  return {
    conversations: sortedInbox(visible.data),
    initialized: visible.initialized,
    refreshing: visible.refreshing,
    loadingMore: visible.loadingMore,
    error: visible.error,
    moreError: visible.moreError,
    hasMore: visible.data.hasMore,
    unavailableIds: visible.unavailableIds,
    refresh,
    loadMore,
    removeConversation,
    applyRead,
    applyDecision,
  };
}
