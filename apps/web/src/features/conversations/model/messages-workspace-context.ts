import { useOutletContext } from 'react-router';
import type { useConversationInbox } from './use-conversation-inbox';

export interface MessagesWorkspaceApi {
  inbox: ReturnType<typeof useConversationInbox>;
  reportConversationError: (conversationId: string, error: unknown) => boolean;
  returnToInbox: (conversationId: string) => void;
}

export function useMessagesWorkspace() {
  return useOutletContext<MessagesWorkspaceApi>();
}
