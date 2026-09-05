let generation = 0;
const listeners = new Set<() => void>();

export function getSessionGeneration() {
  return generation;
}
export function advanceSessionGeneration() {
  generation += 1;
}

export function subscribeToSessionExpiry(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySessionExpiry(requestGeneration: number) {
  // A delayed response from an old session must not sign out a new login.
  if (requestGeneration !== generation) return;
  advanceSessionGeneration();
  for (const listener of listeners) listener();
}
