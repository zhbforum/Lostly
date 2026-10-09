import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { ImageError } from './errors';
import { ImageUploadBodyError } from '@/image-upload/errors';
import { readBoundedRequestBody } from '@/image-upload/read-body';

export const IMAGE_REQUEST_MAX_BYTES = LISTING_IMAGE_CONSTRAINTS.maxSizeBytes + 64 * 1024;
export const IMAGE_BODY_READ_TIMEOUT_MS = 30_000;

export async function parseImageUpload(request: Request, timeoutMs = IMAGE_BODY_READ_TIMEOUT_MS) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ImageError('invalid-multipart');
  }
  if (Number(request.headers.get('content-length')) > IMAGE_REQUEST_MAX_BYTES)
    throw new ImageError('body-too-large');
  try {
    const body = await readBoundedRequestBody(request, {
      maxBytes: IMAGE_REQUEST_MAX_BYTES,
      timeoutMs,
    });
    const form = await new Response(body, {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
    const entries = [...form.entries()];
    const file = form.get('file');
    if (entries.length !== 1 || !(file instanceof File)) throw new ImageError('invalid-multipart');
    return { file };
  } catch (error) {
    if (error instanceof ImageUploadBodyError)
      throw new ImageError(error.reason === 'missing-body' ? 'invalid-multipart' : error.reason);
    if (error instanceof ImageError) throw error;
    throw new ImageError('invalid-multipart');
  }
}
