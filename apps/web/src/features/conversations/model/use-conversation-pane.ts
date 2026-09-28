import { useCallback } from 'react';
import { useAuth } from '@/features/auth/model/auth-context';
import { useMessagesWorkspace } from './messages-workspace-context';
import { useConversationUnread } from './use-conversation-unread';
import { useConversationThread } from './use-conversation-thread';
import { useConversationRead } from './use-conversation-read';
import { useMessageComposer } from './use-message-composer';
import { useMessageScroll } from './use-message-scroll';
import type { ReadConversationResponse } from './types';
import { useClaimDecision } from '@/features/claims/model/use-claim-decision';
import type { Claim } from '@/features/claims/model/types';

export function useConversationPane(conversationId: string) {
  const { user } = useAuth();
  const { inbox, reportConversationError, returnToInbox } = useMessagesWorkspace();
  const { refreshUnread } = useConversationUnread();
  const thread = useConversationThread(conversationId, reportConversationError, inbox.refresh);
  const onDecided = (claim: Claim) => {
    inbox.applyDecision(claim);
    thread.refreshContext();
    refreshUnread();
  };
  const decision = useClaimDecision(onDecided, () => {
    thread.refreshContext();
    inbox.refresh();
    refreshUnread();
  });
  const composer = useMessageComposer(
    conversationId,
    Boolean(thread.context?.canSendMessages) && !thread.unavailable,
  );
  const userId = user!.id;
  const scroll = useMessageScroll(
    thread.history.messages,
    thread.history.initialized,
    composer.operations,
    thread.sentVersion,
    userId,
    thread.loadOlder,
  );
  const { applyRead: applyInboxRead } = inbox;
  const { applyRead: applyThreadRead } = thread;
  const onRead = useCallback(
    (response: ReadConversationResponse) => {
      applyThreadRead(response);
      applyInboxRead(conversationId, response.unreadCount);
      refreshUnread();
    },
    [applyThreadRead, applyInboxRead, conversationId, refreshUnread],
  );
  const read = useConversationRead({
    conversationId,
    userId,
    messages: thread.history.messages,
    root: scroll.root,
    enabled: Boolean(thread.context) && !thread.unavailable,
    onRead,
    onUnavailable: thread.reportError,
    reconcile: thread.reconcileReadTarget,
  });
  return {
    thread,
    composer,
    scroll,
    read,
    decision,
    userId,
    onReturn: () => returnToInbox(conversationId),
  };
}
