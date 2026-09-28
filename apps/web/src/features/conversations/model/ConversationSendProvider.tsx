import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useAuth } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';
import { randomUuid } from '@/shared/lib/random-uuid';
import { sendConversationMessage } from '../api/conversations-api';
import { ConversationSendContext } from './conversation-send-context';
import { isConversationUnavailable } from './conversation-errors';
import { normalizeMessageBody } from './message-body';
import type { PendingSendOperation, SendRegistry, SendResult, SendStart } from './send-operations';

const EMPTY: SendRegistry = {};

export function ConversationSendProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const generation = useSyncExternalStore(subscribeToSessionGeneration, getSessionGeneration);
  const [snapshot, setSnapshot] = useState({ generation, operations: EMPTY });
  const registry = useRef({ generation, operations: new Map<string, PendingSendOperation>() });
  const inFlight = useRef(new Map<string, Promise<SendResult>>());
  const listeners = useRef(new Set<(result: SendResult) => void>());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const pendingRequests = inFlight.current;
    const resultListeners = listeners.current;
    const reset = () => {
      const next = getSessionGeneration();
      registry.current = { generation: next, operations: new Map() };
      pendingRequests.clear();
      resultListeners.clear();
      setSnapshot({ generation: next, operations: EMPTY });
    };
    const unsubscribe = subscribeToSessionGeneration(reset);
    if (registry.current.generation !== getSessionGeneration()) reset();
    return () => {
      mounted.current = false;
      unsubscribe();
      registry.current.operations.clear();
      pendingRequests.clear();
      resultListeners.clear();
      // A committed POST cannot be cancelled by unmounting its consumer.
    };
  }, []);

  const publish = useCallback(() => {
    const operations: Record<string, PendingSendOperation[]> = {};
    for (const operation of registry.current.operations.values()) {
      (operations[operation.conversationId] ??= []).push(operation);
    }
    setSnapshot({ generation: registry.current.generation, operations });
  }, []);

  const attempt = useCallback(
    (operation: PendingSendOperation): Promise<SendResult> => {
      const existing = inFlight.current.get(operation.operationId);
      if (existing) return existing;
      const isCurrent = () =>
        mounted.current &&
        operation.sessionGeneration === getSessionGeneration() &&
        registry.current.operations.get(operation.operationId) === operation;

      registry.current.operations.set(operation.operationId, operation);
      publish();
      const pending = (async (): Promise<SendResult> => {
        // Defer transport until the operation and its single-flight promise are registered.
        await Promise.resolve();
        if (!isCurrent()) return { status: 'ignored' };
        let result: SendResult;
        try {
          const { message } = await sendConversationMessage(
            operation.conversationId,
            operation.body,
            operation.operationId,
          );
          if (!isCurrent()) return { status: 'ignored' };
          result = { status: 'sent', operation, message };
          registry.current.operations.delete(operation.operationId);
        } catch (error) {
          if (!isCurrent()) return { status: 'ignored' };
          // Access is checked before idempotent replay. A hidden conversation cannot
          // establish whether an earlier ambiguous attempt was already committed.
          const unresolvedUnavailable =
            operation.mayBePersisted && isConversationUnavailable(error);
          if (error instanceof ApiError && error.status === 429) {
            const limited: PendingSendOperation = {
              ...operation,
              status: 'rate-limited',
              retryAfterUntil:
                error.retryAfterSeconds === null
                  ? undefined
                  : Date.now() + error.retryAfterSeconds * 1000,
            };
            registry.current.operations.set(operation.operationId, limited);
            result = { status: 'rate-limited', operation: limited };
          } else if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408 &&
            !unresolvedUnavailable
          ) {
            registry.current.operations.delete(operation.operationId);
            result = { status: 'rejected', operation, error };
          } else {
            const uncertain: PendingSendOperation = {
              ...operation,
              status: 'uncertain',
              mayBePersisted: true,
            };
            registry.current.operations.set(operation.operationId, uncertain);
            result = {
              status: 'uncertain',
              operation: uncertain,
              error: error instanceof ApiError ? error : undefined,
            };
          }
        }
        publish();
        for (const listener of [...listeners.current]) {
          if (!listeners.current.has(listener)) continue;
          try {
            listener(result);
          } catch (error) {
            // Consumer failures (including their reporting) cannot reject a send.
            queueMicrotask(() => {
              if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
              else console.error('Conversation send result subscriber failed', error);
            });
          }
        }
        return result;
      })();
      inFlight.current.set(operation.operationId, pending);
      const finish = () => {
        if (
          operation.sessionGeneration === getSessionGeneration() &&
          inFlight.current.get(operation.operationId) === pending
        ) {
          inFlight.current.delete(operation.operationId);
        }
      };
      void pending.then(finish, finish);
      return pending;
    },
    [publish],
  );

  const sendMessage = useCallback(
    (conversationId: string, input: string): SendStart => {
      if (!mounted.current || status !== 'authenticated' || generation !== getSessionGeneration()) {
        return { accepted: false, result: { status: 'ignored' } };
      }
      const body = normalizeMessageBody(input);
      if (body === null) return { accepted: false, result: { status: 'invalid' } };
      const operation: PendingSendOperation = {
        conversationId,
        operationId: randomUuid(),
        body,
        sessionGeneration: generation,
        createdAt: new Date().toISOString(),
        status: 'sending',
        mayBePersisted: false,
      };
      const completion = attempt(operation);
      return { accepted: true, operation, completion };
    },
    [attempt, generation, status],
  );

  const retry = useCallback(
    (conversationId: string, operationId: string): Promise<SendResult> => {
      if (!mounted.current || status !== 'authenticated' || generation !== getSessionGeneration()) {
        return Promise.resolve({ status: 'ignored' });
      }
      const operation = registry.current.operations.get(operationId);
      if (
        !operation ||
        operation.conversationId !== conversationId ||
        operation.sessionGeneration !== generation
      ) {
        return Promise.resolve({ status: 'ignored' });
      }
      const existing = inFlight.current.get(operationId);
      if (existing) return existing;
      if (operation.status === 'rate-limited' && (operation.retryAfterUntil ?? 0) > Date.now()) {
        return Promise.resolve({ status: 'rate-limited', operation });
      }
      return attempt({ ...operation, status: 'sending', retryAfterUntil: undefined });
    },
    [attempt, generation, status],
  );

  const subscribeToResults = useCallback(
    (listener: (result: SendResult) => void) => {
      const guarded = (result: SendResult) => {
        if (generation === getSessionGeneration()) listener(result);
      };
      listeners.current.add(guarded);
      return () => {
        listeners.current.delete(guarded);
      };
    },
    [generation],
  );

  return (
    <ConversationSendContext.Provider
      value={{
        operations: snapshot.generation === generation ? snapshot.operations : EMPTY,
        sendMessage,
        retry,
        subscribeToResults,
      }}
    >
      {children}
    </ConversationSendContext.Provider>
  );
}
