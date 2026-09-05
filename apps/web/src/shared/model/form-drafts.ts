// Deliberately memory-only: never persist private proofs or passwords in browser storage.
const drafts = new Map<string, unknown>();
let owner: string | null = null;

export function selectDraftOwner(userId: string) {
  if (owner !== userId) drafts.clear();
  owner = userId;
}

export function clearDrafts() {
  drafts.clear();
  owner = null;
}

export function readDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}
export function saveDraft<T>(key: string, value: T) {
  drafts.set(key, value);
}
export function discardDraft(key: string) {
  drafts.delete(key);
}
