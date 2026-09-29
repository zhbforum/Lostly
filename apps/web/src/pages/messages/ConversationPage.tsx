import { useParams } from 'react-router';
import { useSyncExternalStore } from 'react';
import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';
import { ConversationPane } from '@/features/conversations/ui/ConversationPane/ConversationPane';

export function ConversationPage() {
  const { conversationId } = useParams();
  const generation = useSyncExternalStore(subscribeToSessionGeneration, getSessionGeneration);
  return (
    <ConversationPane key={`${generation}:${conversationId}`} conversationId={conversationId!} />
  );
}
