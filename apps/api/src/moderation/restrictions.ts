import type { AccountRestriction } from '@lostly/contracts/moderation';

export function accountRestriction(
  record: {
    suspendedPermanently: boolean;
    suspendedUntil: Date | null;
    suspensionReason: string | null;
  },
  now = new Date(),
): AccountRestriction | null {
  if (!record.suspendedPermanently && (!record.suspendedUntil || record.suspendedUntil <= now))
    return null;
  return {
    reason: record.suspensionReason ?? 'Your account has been restricted by a moderator.',
    until: record.suspendedPermanently ? null : record.suspendedUntil!.toISOString(),
  };
}
