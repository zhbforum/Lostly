import { describe, expect, it } from 'vitest';
import { imageErrorMessage, validateImageSelection } from './image-selection';
import { ApiError } from '@/shared/api/client';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';

describe('photo selection limits', () => {
  it('explains an upload body timeout without exposing server details', () => {
    expect(imageErrorMessage(new ApiError(408, 'IMAGE_UPLOAD_TIMEOUT', 'internal details'))).toBe(
      'The photo upload took too long. Check your connection and try again.',
    );
  });

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

describe('photo operation errors', () => {
  it.each([
    [401, 'UNAUTHORIZED', 'Sign in again to manage photos.'],
    [403, 'FORBIDDEN', 'Photos can only be changed on your own active report.'],
    [409, 'LISTING_IMAGES_NOT_EDITABLE', 'Photos can only be changed on your own active report.'],
    [404, 'NOT_FOUND', 'This photo or report is no longer available. Reload the report.'],
    [
      409,
      'LISTING_IMAGE_LIMIT_REACHED',
      'This report already has 5 photos. Reload the report to see the current photos.',
    ],
    [
      409,
      'INVALID_IMAGE_ORDER',
      'The photos changed elsewhere. Reload the report before reordering.',
    ],
    [
      409,
      'IMAGE_UPLOAD_CONFLICT',
      'This upload was already used or its photo was deleted. Reload the report.',
    ],
    [
      422,
      'INVALID_IMAGE',
      'Choose a valid, non-animated JPEG, PNG or WebP up to 5 MiB and 40 megapixels.',
    ],
    [
      413,
      'REQUEST_TOO_LARGE',
      'Choose a valid, non-animated JPEG, PNG or WebP up to 5 MiB and 40 megapixels.',
    ],
    [429, 'RATE_LIMITED', 'Too many uploads. Wait a minute, then try again.'],
    [500, 'INTERNAL_ERROR', 'We could not save this photo change. Please try again.'],
  ])(
    'gives actionable feedback for %s/%s without exposing server details',
    (status, code, message) => {
      expect(imageErrorMessage(new ApiError(status, code, 'Internal details'))).toBe(message);
    },
  );

  it.each([new TypeError('offline'), null, 'Unexpected response'])(
    'handles non-API failures safely: %s',
    (error) => {
      expect(imageErrorMessage(error)).toBe(
        'We could not save this photo change. Please try again.',
      );
    },
  );
});
