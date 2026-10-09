import { getConversationMessages } from '../api/conversations-api';
import { createRequestRevision } from './request-revision';
import { reconcileAttachmentCapabilities } from './attachment-capabilities';
import { acceptMessageAttachments, type MessageAttachmentResource } from './attachment-resource';
import { CONVERSATION_MESSAGE_PAGINATION, type ClaimMessage } from './types';

export interface MessageHistoryState {
  messages: readonly ClaimMessage[];
  initialized: boolean;
  hasOlder: boolean;
  oldestLoadedSequence: number | null;
  caughtUpThroughSequence: number;
}

export const emptyMessageHistory = (): MessageHistoryState => ({
  messages: [],
  initialized: false,
  hasOlder: false,
  oldestLoadedSequence: null,
  caughtUpThroughSequence: 0,
});

export function mergeMessages(
  existing: readonly ClaimMessage[],
  incoming: readonly ClaimMessage[],
): ClaimMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    byId.set(
      message.id,
      previous
        ? {
            ...message,
            attachments: reconcileAttachmentCapabilities(previous.attachments, message.attachments),
          }
        : message,
    );
  }
  const bySequence = new Map<number, ClaimMessage>();
  for (const message of byId.values()) bySequence.set(message.sequence, message);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Owned by one mounted conversation. Only this model's GETs advance the catch-up cursor. */
export function createMessageHistory(conversationId: string) {
  let state = emptyMessageHistory();
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  const revision = createRequestRevision();
  const lifetime = revision.capture();
  const requests = new Map<string, Promise<void>>();
  const attachments = new Map<
    string,
    { resource: MessageAttachmentResource; unsubscribe: () => void }
  >();
  let merging = false;

  function assertActive() {
    if (controller.signal.aborted || !revision.isCurrent(lifetime)) {
      throw new DOMException('Conversation changed', 'AbortError');
    }
  }
  function update(next: MessageHistoryState) {
    assertActive();
    state = next;
    for (const listener of listeners) listener();
  }
  function merge(messages: readonly ClaimMessage[]) {
    assertActive();
    if (messages.some((message) => message.conversationId !== conversationId)) {
      throw new Error('Messages belong to a different conversation');
    }
    merging = true;
    try {
      for (const message of messages) {
        const resource = acceptMessageAttachments(message);
        if (!attachments.has(message.id)) {
          const unsubscribe = resource.subscribe(() => {
            if (merging || !revision.isCurrent(lifetime)) return;
            const current = state.messages.find((m) => m.id === message.id);
            const next = resource.getSnapshot().attachments;
            if (current && current.attachments !== next) {
              update({
                ...state,
                messages: state.messages.map((m) =>
                  m.id === message.id ? { ...m, attachments: next } : m,
                ),
              });
            }
          });
          attachments.set(message.id, { resource, unsubscribe });
        }
      }
      return mergeMessages(state.messages, messages).map((message) => {
        const next = attachments.get(message.id)!.resource.getSnapshot().attachments;
        return message.attachments === next ? message : { ...message, attachments: next };
      });
    } finally {
      merging = false;
    }
  }
  function request(kind: string, task: () => Promise<void>): Promise<void> {
    const existing = requests.get(kind);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => {
      assertActive();
      return task();
    });
    requests.set(kind, pending);
    const finish = () => {
      if (requests.get(kind) === pending) requests.delete(kind);
    };
    void pending.then(finish, finish);
    return pending;
  }

  return {
    getSnapshot: () => state,
    attachmentResource(messageId: string) {
      const entry = attachments.get(messageId);
      if (!entry) throw new Error('Message has not been loaded');
      return entry.resource;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loadInitial: (signal?: AbortSignal) =>
      request('initial', async () => {
        if (state.initialized) return;
        const page = await getConversationMessages(
          conversationId,
          {
            limit: CONVERSATION_MESSAGE_PAGINATION.defaultLimit,
          },
          signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        );
        assertActive();
        signal?.throwIfAborted();
        update({
          messages: merge(page.messages),
          initialized: true,
          hasOlder: page.pageInfo.hasMore,
          oldestLoadedSequence: page.messages[0]?.sequence ?? null,
          // A POST may already have added a newer message. It must not affect this boundary.
          caughtUpThroughSequence: page.messages.at(-1)?.sequence ?? 0,
        });
      }),
    loadOlder: (signal?: AbortSignal) =>
      request('older', async () => {
        if (!state.initialized || !state.hasOlder || state.oldestLoadedSequence === null) return;
        const page = await getConversationMessages(
          conversationId,
          {
            before: state.oldestLoadedSequence,
            limit: CONVERSATION_MESSAGE_PAGINATION.defaultLimit,
          },
          signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        );
        assertActive();
        signal?.throwIfAborted();
        update({
          ...state,
          messages: merge(page.messages),
          hasOlder: page.pageInfo.hasMore,
          oldestLoadedSequence: page.messages[0]?.sequence ?? state.oldestLoadedSequence,
        });
      }),
    catchUp: (signal?: AbortSignal) =>
      request('catch-up', async () => {
        if (!state.initialized) return;
        while (true) {
          assertActive();
          signal?.throwIfAborted();
          const after = state.caughtUpThroughSequence;
          const page = await getConversationMessages(
            conversationId,
            {
              after,
              limit: CONVERSATION_MESSAGE_PAGINATION.maxLimit,
            },
            signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
          );
          assertActive();
          signal?.throwIfAborted();
          const lastSequence = page.messages.at(-1)?.sequence ?? after;
          if (
            (page.pageInfo.hasMore && lastSequence <= after) ||
            page.messages.some((message) => message.sequence <= after)
          ) {
            throw new Error('Message catch-up did not advance');
          }
          update({
            ...state,
            messages: merge(page.messages),
            caughtUpThroughSequence: lastSequence,
          });
          if (!page.pageInfo.hasMore) return;
        }
      }),
    acceptSentMessage(message: ClaimMessage) {
      update({ ...state, messages: merge([message]) });
    },
    dispose() {
      revision.dispose();
      controller.abort();
      listeners.clear();
      for (const entry of attachments.values()) entry.unsubscribe();
      attachments.clear();
    },
  };
}
