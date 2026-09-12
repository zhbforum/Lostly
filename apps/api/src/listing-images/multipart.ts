import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { ImageError } from './errors';

export const IMAGE_REQUEST_MAX_BYTES = LISTING_IMAGE_CONSTRAINTS.maxSizeBytes + 64 * 1024;

export async function parseImageUpload(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ImageError('invalid-multipart');
  }
  if (Number(request.headers.get('content-length')) > IMAGE_REQUEST_MAX_BYTES)
    throw new ImageError('body-too-large');
  const reader = request.body?.getReader();
  if (!reader) throw new ImageError('invalid-multipart');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > IMAGE_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw new ImageError('body-too-large');
      }
      chunks.push(new Uint8Array(chunk.value));
    }
    const form = await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
    const entries = [...form.entries()];
    const file = form.get('file');
    if (entries.length !== 1 || !(file instanceof File)) throw new ImageError('invalid-multipart');
    return { file };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError('invalid-multipart');
  } finally {
    reader.releaseLock();
  }
}
