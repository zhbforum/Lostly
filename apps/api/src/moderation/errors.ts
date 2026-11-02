export class ModerationError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 410 | 429,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function notFound(): never {
  throw new ModerationError(404, 'MODERATION_NOT_FOUND', 'Record not found');
}
export function conflict(): never {
  throw new ModerationError(
    409,
    'MODERATION_CONFLICT',
    'Record changed. Refresh before continuing.',
  );
}
