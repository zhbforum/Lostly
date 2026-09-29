import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createConversationReadController } from './conversation-read-controller';
import type { ClaimMessage, ReadConversationResponse } from './types';

interface Options {
  conversationId: string;
  userId: string;
  messages: readonly ClaimMessage[];
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onRead: (response: ReadConversationResponse) => void;
  onUnavailable: (error: unknown) => void;
  reconcile: () => Promise<void>;
}

export function useConversationRead({
  conversationId,
  userId,
  messages,
  root,
  enabled,
  onRead,
  onUnavailable,
  reconcile,
}: Options) {
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createConversationReadController> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const current = createConversationReadController(conversationId, {
      onRead,
      onUnavailable,
      reconcile,
      onError: setError,
    });
    controller.current = current;
    return () => {
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [conversationId, enabled, onRead, onUnavailable, reconcile]);

  useEffect(() => {
    const current = controller.current;
    const container = root.current;
    if (!current || !container || typeof IntersectionObserver === 'undefined') return;
    const incoming = new Map(
      messages
        .filter((message) => message.senderUserId !== userId)
        .map((message) => [message.id, message]),
    );
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      current.setActive(!document.hidden);
      if (document.hidden) return;
      // Recreate on visibility return: cached intersections from a hidden tab are not evidence.
      observer = new IntersectionObserver(
        (entries) => {
          if (document.hidden) return;
          const visible = entries
            .filter(
              (entry) =>
                entry.isIntersecting &&
                entry.intersectionRect.height >= Math.min(24, entry.boundingClientRect.height),
            )
            .map((entry) => incoming.get((entry.target as HTMLElement).dataset.messageId!))
            .filter((message): message is ClaimMessage => Boolean(message));
          current.observe(visible);
        },
        { root: container, threshold: [0, 0.1, 0.5, 1] },
      );
      for (const element of container.querySelectorAll<HTMLElement>('[data-message-id]')) {
        if (incoming.has(element.dataset.messageId!)) observer.observe(element);
      }
    };
    observe();
    document.addEventListener('visibilitychange', observe);
    return () => {
      observer?.disconnect();
      current.setActive(false);
      document.removeEventListener('visibilitychange', observe);
    };
  }, [enabled, messages, root, userId, onRead, onUnavailable, reconcile]);
  return { error, retry: useCallback(() => controller.current?.retry(), []) };
}
