import { useCallback } from 'react';
import { Outlet, useParams } from 'react-router';
import { isConversationUnavailable } from '../../model/conversation-errors';
import type { MessagesWorkspaceApi } from '../../model/messages-workspace-context';
import { useConversationInbox } from '../../model/use-conversation-inbox';
import { useConversationUnread } from '../../model/use-conversation-unread';
import { useMessagesNavigation } from '../../model/use-messages-navigation';
import { ConversationInbox } from '../ConversationInbox/ConversationInbox';
import styles from './MessagesWorkspace.module.css';

export function MessagesWorkspace() {
  const { conversationId } = useParams();
  const { inboxRef, inboxLinkState, returnToInbox } = useMessagesNavigation(conversationId);
  const inbox = useConversationInbox();
  const { removeConversation } = inbox;
  const { refreshUnread } = useConversationUnread();
  const reportConversationError = useCallback(
    (id: string, error: unknown) => {
      if (!isConversationUnavailable(error)) return false;
      removeConversation(id);
      refreshUnread();
      return true;
    },
    [removeConversation, refreshUnread],
  );
  const workspace: MessagesWorkspaceApi = { inbox, reportConversationError, returnToInbox };
  return (
    <div className={styles.workspace} data-conversation-open={Boolean(conversationId)}>
      <div className={styles.inbox} ref={inboxRef}>
        <ConversationInbox inbox={inbox} selectedId={conversationId} linkState={inboxLinkState} />
      </div>
      <section className={styles.detail} aria-label="Conversation">
        <Outlet context={workspace} />
      </section>
    </div>
  );
}
