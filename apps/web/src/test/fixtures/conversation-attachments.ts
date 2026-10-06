import type { ClaimMessageAttachment } from '@/features/conversations/model/types';

export function attachment(
  position = 0,
  overrides: Partial<ClaimMessageAttachment> = {},
): ClaimMessageAttachment {
  return {
    id: `attachment-${position}`,
    kind: 'image',
    position,
    url: `https://private.example/image-${position}.webp?signature=initial`,
    urlExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    width: 600,
    height: 400,
    ...overrides,
  };
}

export function renewed(attachments: readonly ClaimMessageAttachment[], lifetime = 15 * 60_000) {
  return attachments.map((image) => ({
    ...image,
    url: `${image.url}-renewed`,
    urlExpiresAt: new Date(Date.now() + lifetime).toISOString(),
  }));
}
