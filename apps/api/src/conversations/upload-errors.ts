export const CONVERSATION_UPLOAD_ERRORS = {
  'unsupported-media-type': [415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON or multipart/form-data'],
  'invalid-multipart': [
    400,
    'INVALID_MULTIPART',
    'Send one optional text body and one to four image files',
  ],
  'body-too-large': [413, 'REQUEST_TOO_LARGE', 'The upload request is too large'],
  'body-timeout': [408, 'IMAGE_UPLOAD_TIMEOUT', 'The upload body took too long'],
  'upload-aborted': [400, 'REQUEST_ABORTED', 'The upload request was cancelled'],
  'invalid-image': [
    422,
    'VALIDATION_ERROR',
    'Choose valid, non-animated JPEG, PNG or WebP images up to 5 MiB and 40 megapixels',
  ],
  busy: [429, 'RATE_LIMITED', 'Request temporarily limited by upload capacity'],
} as const;

export class ConversationUploadError extends Error {
  constructor(readonly reason: keyof typeof CONVERSATION_UPLOAD_ERRORS) {
    super(CONVERSATION_UPLOAD_ERRORS[reason][2]);
    this.name = 'ConversationUploadError';
  }
}
