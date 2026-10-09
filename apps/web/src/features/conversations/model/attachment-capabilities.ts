import type { ClaimMessageAttachment } from './types';

export const ATTACHMENT_REFRESH_LEAD_MS = 60_000;

export function attachmentExpiry(attachment: ClaimMessageAttachment): number {
  const expiry = Date.parse(attachment.urlExpiresAt);
  return Number.isFinite(expiry) ? expiry : -Infinity;
}

export function earliestAttachmentExpiry(attachments: readonly ClaimMessageAttachment[]) {
  return Math.min(...attachments.map(attachmentExpiry));
}

/** One atomic result; equal/invalid expiry must not replace a usable capability. */
export function reconcileAttachmentCapabilities(
  current: ClaimMessageAttachment[],
  incoming: readonly ClaimMessageAttachment[],
): ClaimMessageAttachment[] {
  const byId = new Map(current.map((attachment) => [attachment.id, attachment]));
  const next = [...incoming]
    .sort((a, b) => a.position - b.position)
    .map((attachment) => {
      const previous = byId.get(attachment.id);
      return previous && attachmentExpiry(previous) >= attachmentExpiry(attachment)
        ? previous
        : attachment;
    });
  return next.length === current.length && next.every((attachment, i) => attachment === current[i])
    ? current
    : next;
}
