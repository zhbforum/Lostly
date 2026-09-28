import { createContext, useContext } from 'react';

export interface ConversationUnreadContextValue {
  unreadConversationCount: number;
  refreshUnread: () => void;
}

export const ConversationUnreadContext = createContext<ConversationUnreadContextValue | null>(null);

export function useConversationUnread() {
  const value = useContext(ConversationUnreadContext);
  if (!value)
    throw new Error('useConversationUnread must be used within ConversationUnreadProvider');
  return value;
}
