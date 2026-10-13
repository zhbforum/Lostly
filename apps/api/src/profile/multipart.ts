import { PROFILE_CONSTRAINTS } from '@lostly/contracts/profile';
import { ImageUploadBodyError } from '@/image-upload/errors';
import { readBoundedRequestBody } from '@/image-upload/read-body';
import { ProfileError } from './errors';

export const AVATAR_REQUEST_MAX_BYTES = PROFILE_CONSTRAINTS.avatarMaxBytes + 64 * 1024;

export async function parseAvatarUpload(request: Request, timeoutMs = 30_000) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;'))
    throw new ProfileError('invalid-multipart');
  try {
    if (Number(request.headers.get('content-length')) > AVATAR_REQUEST_MAX_BYTES)
      throw new ProfileError('body-too-large');
    const body = await readBoundedRequestBody(request, {
      maxBytes: AVATAR_REQUEST_MAX_BYTES,
      timeoutMs,
    });
    const form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
    const file = form.get('file');
    const version = form.get('expectedVersion');
    if (
      [...form.entries()].length !== 2 ||
      !(file instanceof File) ||
      typeof version !== 'string' ||
      !/^[1-9]\d*$/.test(version) ||
      !Number.isSafeInteger(Number(version))
    ) {
      throw new ProfileError('invalid-multipart');
    }
    return { file, expectedVersion: Number(version) };
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    if (error instanceof ImageUploadBodyError)
      throw new ProfileError(error.reason === 'missing-body' ? 'invalid-multipart' : error.reason);
    throw new ProfileError('invalid-multipart');
  }
}
