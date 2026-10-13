export const PROFILE_ERRORS = {
  'username-invalid': [
    422,
    'INVALID_USERNAME',
    'Use 3–30 letters, numbers or underscores. Start and end with a letter or number.',
  ],
  'username-reserved': [
    422,
    'USERNAME_RESERVED',
    'This username is reserved. Please choose another.',
  ],
  'username-taken': [
    409,
    'USERNAME_TAKEN',
    'This username is not available. Please choose another.',
  ],
  'username-locked': [409, 'USERNAME_LOCKED', 'You can change your username once every 30 days.'],
  'not-found': [404, 'PROFILE_NOT_FOUND', 'Profile not found'],
  conflict: [
    409,
    'PROFILE_CHANGED',
    'Your profile changed in another tab. Review the latest details and try again.',
  ],
  'name-locked': [
    409,
    'DISPLAY_NAME_LOCKED',
    'You can change your display name once every 7 days.',
  ],
  'invalid-image': [
    422,
    'INVALID_AVATAR',
    'Choose a valid JPEG, PNG, WebP or GIF up to 5 MiB, 100 frames and 40 million total pixels.',
  ],
  'invalid-multipart': [400, 'INVALID_MULTIPART', 'Send one file and the current profile version.'],
  'body-too-large': [413, 'REQUEST_TOO_LARGE', 'The avatar upload is too large.'],
  'body-timeout': [
    408,
    'AVATAR_UPLOAD_TIMEOUT',
    'The avatar upload took too long. Please try again.',
  ],
  'upload-aborted': [400, 'REQUEST_ABORTED', 'The upload was cancelled.'],
  busy: [429, 'RATE_LIMITED', 'Too many uploads. Please try again shortly.'],
} as const;

export class ProfileError extends Error {
  constructor(readonly reason: keyof typeof PROFILE_ERRORS) {
    super(PROFILE_ERRORS[reason][2]);
    this.name = 'ProfileError';
  }
}
