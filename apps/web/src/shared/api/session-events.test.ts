import { expect, it, vi } from 'vitest';
import {
  advanceSessionGeneration,
  getSessionGeneration,
  notifySessionExpiry,
  subscribeToSessionExpiry,
  subscribeToSessionGeneration,
} from './session-events';

it('notifies generation changes synchronously without expiring a session', () => {
  const changed = vi.fn(() => getSessionGeneration());
  const expired = vi.fn();
  const unsubscribeChanged = subscribeToSessionGeneration(changed);
  const unsubscribeExpired = subscribeToSessionExpiry(expired);
  try {
    const before = getSessionGeneration();
    advanceSessionGeneration();
    expect(changed).toHaveReturnedWith(before + 1);
    expect(expired).not.toHaveBeenCalled();
    unsubscribeChanged();
    advanceSessionGeneration();
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    unsubscribeChanged();
    unsubscribeExpired();
  }
});

it('advances generation before expiry and ignores delayed expiry from a previous session', () => {
  const events: string[] = [];
  const unsubscribeChanged = subscribeToSessionGeneration(() => events.push('generation'));
  const unsubscribeExpired = subscribeToSessionExpiry(() => events.push('expiry'));
  try {
    const before = getSessionGeneration();
    notifySessionExpiry(before);
    notifySessionExpiry(before);
    expect(events).toEqual(['generation', 'expiry']);
    expect(getSessionGeneration()).toBe(before + 1);
  } finally {
    unsubscribeChanged();
    unsubscribeExpired();
  }
});
