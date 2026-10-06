import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { ApiError } from '@/shared/api/client';
import type { MessageAttachmentResource } from './attachment-resource';
import {
  ATTACHMENT_REFRESH_LEAD_MS,
  attachmentExpiry,
  earliestAttachmentExpiry,
} from './attachment-capabilities';

export function useMessageAttachments(
  resource: MessageAttachmentResource,
  onUnavailable: (error: unknown) => void,
  root?: RefObject<HTMLDivElement | null>,
) {
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  // A stable primitive snapshot of the external clock, not a constantly changing Date.now().
  // Re-evaluated on every render, including offscreen rerenders with no active expiry timer.
  const expiredMask = useSyncExternalStore(resource.subscribe, () => {
    const now = Date.now();
    return resource
      .getSnapshot()
      .attachments.reduce(
        (mask, attachment, index) =>
          attachmentExpiry(attachment) <= now ? mask | (1 << index) : mask,
        0,
      );
  });
  const element = useRef<HTMLDivElement>(null);
  const [intersection, setIntersection] = useState<{
    resource: MessageAttachmentResource;
    active: boolean;
  } | null>(null);
  const active =
    typeof IntersectionObserver === 'undefined' ||
    (intersection?.resource === resource && intersection.active);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [clock, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !element.current) return;
    let observing = true;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (observing && entry.target === element.current) {
            setIntersection({ resource, active: entry.isIntersecting });
            tick();
          }
      },
      { root: root?.current, rootMargin: '200px', threshold: 0 },
    );
    observer.observe(element.current);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [root, resource]);
  useEffect(() => {
    const changed = () => {
      setVisible(document.visibilityState === 'visible');
      tick();
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (state.conversationUnavailable && resource.isCurrent(state.version))
      onUnavailable(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation unavailable'));
  }, [state.conversationUnavailable, state.version, resource, onUnavailable]);
  useEffect(() => {
    if (
      !active ||
      !visible ||
      document.visibilityState !== 'visible' ||
      state.unavailable ||
      state.conversationUnavailable ||
      !state.attachments.length
    )
      return;
    const now = Date.now();
    const earliest = earliestAttachmentExpiry(state.attachments);
    if (
      state.automaticAvailable &&
      (state.failed.length || earliest <= now + ATTACHMENT_REFRESH_LEAD_MS)
    ) {
      void resource.recover(false, true);
    }
    // Only active/visible groups have a timer. Even an exhausted budget still needs expiry removal.
    const deadlines = state.attachments.map(attachmentExpiry).filter((expiry) => expiry > now);
    if (state.automaticAvailable && earliest - ATTACHMENT_REFRESH_LEAD_MS > now)
      deadlines.push(earliest - ATTACHMENT_REFRESH_LEAD_MS);
    if (!deadlines.length) return;
    const timer = setTimeout(tick, Math.min(Math.min(...deadlines) - now, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [active, visible, state, resource, clock]);
  return {
    state,
    expiredMask,
    element,
    retry: () => {
      tick();
      return resource.recover(true);
    },
    recheck: tick,
  };
}
