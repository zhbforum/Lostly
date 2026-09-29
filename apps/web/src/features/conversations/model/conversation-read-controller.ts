import { readConversation } from '../api/conversations-api';
import { isConversationUnavailable, isReadTargetMissing } from './conversation-errors';
import { createRequestRevision } from './request-revision';
import type { ClaimMessage, ReadConversationResponse } from './types';

interface Callbacks {
  onRead: (response: ReadConversationResponse) => void;
  onUnavailable: (error: unknown) => void;
  reconcile: () => Promise<void>;
  onError: (message: string | null) => void;
}

export function createConversationReadController(conversationId: string, callbacks: Callbacks) {
  const abort = new AbortController();
  const revision = createRequestRevision();
  const lifetime = revision.capture();
  const missing = new Set<string>();
  let desired: ClaimMessage | null = null;
  let confirmed = 0;
  let active = false;
  let running = false;
  let blocked = false;
  const alive = () => revision.isCurrent(lifetime);

  async function flush() {
    if (!alive() || !active || running || blocked || !desired || desired.sequence <= confirmed)
      return;
    running = true;
    const target = desired;
    try {
      const response = await readConversation(conversationId, target.id, abort.signal);
      if (!alive()) return;
      confirmed = Math.max(confirmed, response.lastReadSequence);
      callbacks.onRead(response);
      callbacks.onError(null);
      // A non-advancing response must not cause a hot retry loop.
      if (response.lastReadSequence < target.sequence) blocked = true;
    } catch (error) {
      if (!alive()) return;
      if (isConversationUnavailable(error)) {
        blocked = true;
        callbacks.onUnavailable(error);
      } else if (isReadTargetMissing(error)) {
        missing.add(target.id);
        desired = null;
        await callbacks.reconcile();
        // Only a fresh observation of server-backed messages can choose another target.
      } else {
        blocked = true;
        callbacks.onError('Could not update read status.');
      }
    } finally {
      running = false;
      if (alive()) queueMicrotask(() => void flush());
    }
  }
  return {
    observe(messages: readonly ClaimMessage[]) {
      if (!active || !alive()) return;
      for (const message of messages) {
        if (
          message.conversationId === conversationId &&
          !missing.has(message.id) &&
          message.sequence > confirmed &&
          (!desired || message.sequence > desired.sequence)
        )
          desired = message;
      }
      queueMicrotask(() => void flush());
    },
    setActive(value: boolean) {
      active = value;
      if (value) queueMicrotask(() => void flush());
    },
    retry() {
      blocked = false;
      callbacks.onError(null);
      queueMicrotask(() => void flush());
    },
    dispose() {
      revision.dispose();
      abort.abort();
    },
  };
}
