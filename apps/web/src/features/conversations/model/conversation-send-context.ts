import { createContext, useContext } from 'react';
import type { ConversationSendContextValue } from './send-operations';

export const ConversationSendContext = createContext<ConversationSendContextValue | null>(null);

export function useConversationSend() {
  const value = useContext(ConversationSendContext);
  if (!value) throw new Error('useConversationSend must be used within ConversationSendProvider');
  return value;
}
