import { ImageError } from './errors';

export async function readImageUploadBody(
  request: Request,
  { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs: number },
) {
  if (!request.body) throw new ImageError('invalid-multipart');
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const deadline = performance.now() + timeoutMs;
  let size = 0;
  let failure: ImageError | undefined;
  let complete = false;

  function stop(reason: ImageError) {
    if (failure) return;
    failure = reason;
    // cancel() settles pending reads. Do not wait on an underlying source's cleanup promise.
    void reader.cancel(reason).catch(() => {});
  }
  const onAbort = () => stop(new ImageError('upload-aborted'));
  const timer = setTimeout(() => stop(new ImageError('body-timeout')), timeoutMs);
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) onAbort();

  try {
    while (true) {
      if (performance.now() >= deadline) stop(new ImageError('body-timeout'));
      if (failure) throw failure;
      const chunk = await reader.read();
      if (performance.now() >= deadline) stop(new ImageError('body-timeout'));
      if (failure) throw failure;
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new ImageError('body-too-large');
      chunks.push(new Uint8Array(chunk.value));
    }
    complete = true;
    return new Blob(chunks);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
    if (!complete && !failure) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
