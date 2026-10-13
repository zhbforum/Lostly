import { expect, it } from 'vitest';
import { reconcileProfileAvatar } from './profile-avatar';

it('reconciles both URLs as one capability for an immutable avatar, without reviving removed or replaced avatars', () => {
  const old = {
    id: 'avatar',
    url: 'old',
    staticUrl: 'old-still',
    animated: true,
    urlExpiresAt: '2026-10-11T12:00:00Z',
  };
  const fresh = {
    ...old,
    url: 'fresh',
    staticUrl: 'fresh-still',
    urlExpiresAt: '2026-10-11T13:00:00Z',
  };
  expect(reconcileProfileAvatar(fresh, old)).toBe(fresh);
  expect(reconcileProfileAvatar(old, fresh)).toBe(fresh);
  expect(reconcileProfileAvatar(fresh, null)).toBeNull();
  const replacement = { ...old, id: 'new-avatar' };
  expect(reconcileProfileAvatar(fresh, replacement)).toBe(replacement);
});
