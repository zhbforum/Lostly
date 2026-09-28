import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

export function useMessagesNavigation(conversationId?: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const inboxRef = useRef<HTMLDivElement>(null);
  const inboxEntryKey = useRef<string | null>(null);
  const focusAfterReturn = useRef<string | null>(null);

  useEffect(() => {
    if (conversationId) return;
    inboxEntryKey.current = location.key;
    const id = focusAfterReturn.current;
    if (!id) return;
    focusAfterReturn.current = null;
    const row = Array.from(
      inboxRef.current?.querySelectorAll<HTMLAnchorElement>('[data-conversation-id]') ?? [],
    ).find((element) => element.dataset.conversationId === id);
    // CSS has revealed the still-mounted inbox; focusing must not reset its scroll position.
    (row ?? inboxRef.current?.querySelector<HTMLHeadingElement>('h1'))?.focus({
      preventScroll: true,
    });
  }, [conversationId, location.key]);

  const returnToInbox = useCallback(
    (id: string) => {
      focusAfterReturn.current = id;
      const origin = location.state?.messagesInboxKey;
      // A key remembered by this workspace proves the previous entry was its inbox.
      // A cold/direct entry (including reload) has no such proof and must not leave the app.
      if (typeof origin === 'string' && origin === inboxEntryKey.current) void navigate(-1);
      else void navigate('/messages', { replace: true });
    },
    [location.state, navigate],
  );

  return {
    inboxRef,
    inboxLinkState: conversationId ? undefined : { messagesInboxKey: location.key },
    returnToInbox,
  };
}
