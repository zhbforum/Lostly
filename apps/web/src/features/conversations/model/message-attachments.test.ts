import { expect, it } from 'vitest';
import { imageSelectionError } from './message-attachments';
import { CONVERSATION_IMAGE_CONSTRAINTS } from './types';

const image = (type = 'image/jpeg', size = 1) =>
  new File([new Uint8Array(size)], 'private', { type });

it.each(['image/jpeg', 'image/png', 'image/webp', ''])(
  'allows advisory MIME %j, duplicates and exactly four files',
  (type) => {
    const file = image(type, CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes);
    expect(imageSelectionError([file, file, file, file])).toBeNull();
  },
);
it.each([
  [() => image('image/jpeg', 0), 'This image is empty.'],
  [
    () => image('image/jpeg', CONVERSATION_IMAGE_CONSTRAINTS.maxSizeBytes + 1),
    'Each image must be 5 MiB or smaller.',
  ],
  [() => image('application/octet-stream'), 'Choose JPEG, PNG, or WebP images.'],
  [() => image('image/gif'), 'Choose JPEG, PNG, or WebP images.'],
] as const)('rejects the whole mixed batch: %s', (makeInvalid, error) => {
  expect(imageSelectionError([image(), makeInvalid(), image()])).toBe(error);
});
it('rejects overflow including previously selected files', () => {
  expect(imageSelectionError([image(), image(), image()], 2)).toBe(
    'You can attach up to 4 images.',
  );
  expect(imageSelectionError([image(), image(), image(), image(), image()])).not.toBeNull();
});
