import { useCallback, useSyncExternalStore } from 'react';
import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';

export interface ConversationMessageDraft {
  text: string;
  images: File[];
}

// Conversation files belong to a session generation, not merely to an account ID.
// Other form drafts retain their existing retention policy.
const drafts = new Map<string, ConversationMessageDraft>();
const listeners = new Set<() => void>();
const EMPTY: ConversationMessageDraft = { text: '', images: [] };
const notify = () => {
  for (const listener of [...listeners]) listener();
};
subscribeToSessionGeneration(() => {
  drafts.clear();
  notify();
});

export function readConversationDraft(id: string, generation = getSessionGeneration()) {
  return generation === getSessionGeneration() ? (drafts.get(id) ?? EMPTY) : EMPTY;
}

export function saveConversationDraft(
  id: string,
  draft: ConversationMessageDraft,
  generation: number,
) {
  if (generation !== getSessionGeneration()) return false;
  if (!draft.text.length && !draft.images.length) drafts.delete(id);
  else drafts.set(id, draft);
  notify();
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConversationDraft(id: string) {
  const generation = useSyncExternalStore(subscribeToSessionGeneration, getSessionGeneration);
  const snapshot = useCallback(() => readConversationDraft(id, generation), [id, generation]);
  const draft = useSyncExternalStore(subscribe, snapshot);
  const setDraft = useCallback(
    (
      update:
        | ConversationMessageDraft
        | ((previous: ConversationMessageDraft) => ConversationMessageDraft),
    ) => {
      if (generation !== getSessionGeneration()) return;
      saveConversationDraft(
        id,
        typeof update === 'function' ? update(snapshot()) : update,
        generation,
      );
    },
    [id, generation, snapshot],
  );
  return { draft, setDraft, generation };
}
