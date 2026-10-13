import type { ProfileAvatar } from '@lostly/contracts/profile';

export function reconcileProfileAvatar(
  current: ProfileAvatar | null | undefined,
  incoming: ProfileAvatar | null | undefined,
) {
  if (
    current &&
    incoming &&
    current.id === incoming.id &&
    Date.parse(current.urlExpiresAt) > Date.parse(incoming.urlExpiresAt)
  )
    return current;
  return incoming;
}
