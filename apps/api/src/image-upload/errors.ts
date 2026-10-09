export class InvalidImageError extends Error {
  readonly reason = 'invalid-image';

  constructor() {
    super('Invalid image');
    this.name = 'InvalidImageError';
  }
}

export type ImageUploadBodyFailure =
  'missing-body' | 'body-too-large' | 'body-timeout' | 'upload-aborted';

export class ImageUploadBodyError extends Error {
  constructor(readonly reason: ImageUploadBodyFailure) {
    super(reason);
    this.name = 'ImageUploadBodyError';
  }
}
