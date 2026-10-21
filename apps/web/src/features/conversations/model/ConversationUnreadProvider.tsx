import {
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useAuth } from '@/features/auth/model/auth-context';
import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';
import { useVisiblePolling } from '@/shared/model/use-visible-polling';
import { getUnreadConversationCount } from '../api/conversations-api';
import { CONVERSATION_POLLING } from './polling-intervals';
import { createRequestRevision } from './request-revision';
import { ConversationUnreadContext } from './use-conversation-unread';

export function ConversationUnreadProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const generation = useSyncExternalStore(subscribeToSessionGeneration, getSessionGeneration);
  const revision = useRef(createRequestRevision());
  const [snapshot, setSnapshot] = useState({ generation, count: 0 });
  const task = useCallback(async (signal: AbortSignal) => {
    const token = revision.current.capture();
    try {
      const response = await getUnreadConversationCount(signal);
      if (!signal.aborted && revision.current.isCurrent(token)) {
        setSnapshot({
          generation: token.sessionGeneration,
          count: response.unreadConversationCount,
        });
      }
    } catch {
      // Keep the last confirmed count during a temporary failure; the next poll retries.
    }
  }, []);
  const poll = useVisiblePolling({
    task,
    intervalMs: CONVERSATION_POLLING.unread,
    enabled: status === 'authenticated',
    resourceKey: generation,
  });
  const refreshUnread = useCallback(() => {
    revision.current.invalidate();
    poll();
  }, [poll]);

  const unreadConversationCount =
    status === 'authenticated' && snapshot.generation === generation ? snapshot.count : 0;

  const value = useMemo(
    () => ({
      unreadConversationCount,
      refreshUnread,
    }),
    [refreshUnread, unreadConversationCount],
  );

  return (
    <ConversationUnreadContext.Provider value={value}>
      {children}
    </ConversationUnreadContext.Provider>
  );
}
