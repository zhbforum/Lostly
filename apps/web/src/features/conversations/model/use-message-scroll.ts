import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PendingSendOperation } from './send-operations';
import type { ClaimMessage } from './types';
import { anchoredScrollTop, isNearMessageBottom } from './message-scroll';
import { imageCountLabel } from './message-attachments';

function captureAnchor(element: HTMLDivElement, first: number) {
  const top = element.getBoundingClientRect().top;
  const row = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (row) => row.getBoundingClientRect().bottom > top,
  );
  return {
    height: element.scrollHeight,
    top: element.scrollTop,
    first,
    id: row?.dataset.messageId,
    offset: row ? row.getBoundingClientRect().top - top : 0,
  };
}

export function useMessageScroll(
  messages: readonly ClaimMessage[],
  initialized: boolean,
  operations: readonly PendingSendOperation[],
  sentVersion: number,
  userId: string,
  loadOlder: () => Promise<boolean>,
) {
  const root = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previous = useRef({
    initialized: false,
    first: 0,
    ids: new Set<string>(),
    operations: new Set<string>(),
    sentVersion: 0,
  });
  const anchor = useRef<ReturnType<typeof captureAnchor> | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const [announcement, setAnnouncement] = useState({ revision: 0, text: '' });
  const bottom = useCallback((smooth = false) => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth && !reduced ? 'smooth' : 'instant',
    });
    nearBottom.current = true;
    setHasNew(false);
  }, []);
  const onScroll = useCallback(() => {
    const element = root.current;
    if (!element) return;
    if (anchor.current) anchor.current = captureAnchor(element, anchor.current.first);
    nearBottom.current = isNearMessageBottom(
      element.scrollHeight,
      element.scrollTop,
      element.clientHeight,
    );
    if (nearBottom.current) setHasNew(false);
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (!initialized) {
      previous.current.initialized = false;
      return;
    }
    const old = previous.current;
    // Known POST sequences may be ahead of catch-up: new incoming 51/52 still count after own 53.
    const newIncoming = old.initialized
      ? messages.filter(
          (message) =>
            !old.ids.has(message.id) &&
            message.sequence >= old.first &&
            message.senderUserId !== userId,
        )
      : [];
    const ownSend =
      sentVersion > old.sentVersion ||
      operations.some((operation) => !old.operations.has(operation.operationId));
    const saved = anchor.current;
    if (!old.initialized || ownSend) {
      anchor.current = null;
      bottom();
    } else if (saved && (messages[0]?.sequence ?? 0) < saved.first) {
      const row = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (row) => row.dataset.messageId === saved.id,
      );
      // Preserve the actual row, including grouping/date changes or a concurrent append.
      element.scrollTop = row
        ? element.scrollTop +
          row.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          saved.offset
        : anchoredScrollTop(saved.height, saved.top, element.scrollHeight);
      anchor.current = null;
    } else if (newIncoming.length > 0 && nearBottom.current) bottom(true);
    if (newIncoming.length > 0) {
      if (!nearBottom.current && !ownSend) setHasNew(true);
      const latest = newIncoming.at(-1)!;
      const preview = latest.body ?? imageCountLabel(latest.attachments.length);
      setAnnouncement((value) => ({
        revision: value.revision + 1,
        text: `${newIncoming.length} new ${newIncoming.length === 1 ? 'message' : 'messages'}. ${preview}`,
      }));
    }
    previous.current = {
      initialized: true,
      first: messages[0]?.sequence ?? 0,
      ids: new Set(messages.map((message) => message.id)),
      operations: new Set(operations.map((operation) => operation.operationId)),
      sentVersion,
    };
  }, [messages, initialized, operations, sentVersion, userId, bottom]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) bottom();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [bottom]);

  const earlier = useCallback(async () => {
    const element = root.current;
    if (!element || anchor.current) return;
    anchor.current = captureAnchor(element, messages[0]?.sequence ?? 0);
    const prepended = await loadOlder();
    if (!prepended) anchor.current = null;
  }, [loadOlder, messages]);
  return { root, onScroll, bottom, earlier, hasNew, announcement };
}
