import { describe, expect, it } from 'vitest';
import { validateImageSelection } from './image-selection';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';

describe('photo selection limits', () => {
  it('allows zero through five photos and counts existing photos', () => {
    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    expect(validateImageSelection([], 0)).toBeNull();
    expect(
      validateImageSelection(
        Array.from({ length: 5 }, () => file),
        0,
      ),
    ).toBeNull();
    expect(validateImageSelection([file], 4)).toBeNull();
    expect(validateImageSelection([file, file], 4)).toContain('5');
  });
  it('validates MIME, empty files and inclusive size boundary', () => {
    expect(validateImageSelection([new File([], 'empty.png', { type: 'image/png' })], 0)).toContain(
      'non-empty',
    );
    expect(
      validateImageSelection([new File(['svg'], 'file.svg', { type: 'image/svg+xml' })], 0),
    ).toContain('JPEG');
    const limit = LISTING_IMAGE_CONSTRAINTS.maxSizeBytes;
    expect(
      validateImageSelection(
        [new File([new Uint8Array(limit)], 'photo.png', { type: 'image/png' })],
        0,
      ),
    ).toBeNull();
    expect(
      validateImageSelection(
        [new File([new Uint8Array(limit + 1)], 'photo.png', { type: 'image/png' })],
        0,
      ),
    ).toContain('5 MiB');
  });
  it('allows an unknown MIME for server inspection without bypassing size or count limits', () => {
    const file = new File(['bytes to inspect on the server'], 'photo.jpg');
    expect(file.type).toBe('');
    expect(validateImageSelection([file], 4)).toBeNull();
    expect(validateImageSelection([file], 5)).toContain('5');
    expect(validateImageSelection([new File([], 'empty.jpg')], 0)).toContain('non-empty');
    expect(
      validateImageSelection(
        [new File([new Uint8Array(LISTING_IMAGE_CONSTRAINTS.maxSizeBytes + 1)], 'large.jpg')],
        0,
      ),
    ).toContain('5 MiB');
    expect(
      validateImageSelection([new File(['bytes'], 'photo.jpg', { type: 'text/plain' })], 0),
    ).toContain('JPEG');
  });
});
