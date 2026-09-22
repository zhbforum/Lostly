import type { ListingImage } from '@lostly/contracts/listings';

export function photo(position = 0): ListingImage {
  return {
    id: `550e8400-e29b-41d4-a716-44665544001${position}`,
    position,
    width: 320,
    height: 240,
    url: `https://images.example.test/photo-${position}.webp?signature=test`,
    urlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}
