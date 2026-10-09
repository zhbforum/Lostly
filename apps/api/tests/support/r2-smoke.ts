import { R2ObjectStorage, readR2Config } from '@/storage/r2-storage';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { prepareImage, readImageSource } from '@/image-upload/processing';
import { imageFixture } from './image-fixture';

// Explicit, manual-only smoke test. Never invoked by the test runner or CI.
// --conversation uses fresh UUIDs for a conversation attempt, without creating any DB rows.
// Otherwise the existing temporary listing-photo smoke mode is preserved.
const args = process.argv.slice(2);
const conversation = args[0] === '--conversation';
if (args.length > 1) {
  throw new Error(
    conversation
      ? 'Conversation smoke does not accept an object key or additional arguments'
      : 'Listing smoke accepts at most one temporary object key',
  );
}
const requestedKey = conversation ? undefined : args[0];
if (
  requestedKey !== undefined &&
  !/^_smoke\/listing-photos\/[0-9a-f-]{36}\.webp$/.test(requestedKey)
) {
  throw new Error('Only a temporary listing-photo smoke key may be retried');
}
const key =
  requestedKey ??
  (conversation
    ? `conversations/${crypto.randomUUID()}/${crypto.randomUUID()}/0.webp`
    : `_smoke/listing-photos/${crypto.randomUUID()}.webp`);
// Reject unsafe arguments before configuration or any storage work (including cleanup).
readR2Config();
const storage = new R2ObjectStorage();
let failed = false;
let signedUrl: string | undefined;
let stage = 'normalize';
let httpStatus: number | undefined;
try {
  const source = await readImageSource(await imageFixture(), {
    maxBytes: LISTING_IMAGE_CONSTRAINTS.maxSizeBytes,
  });
  const prepared = await prepareImage(source.bytes, {
    maxOutputBytes: LISTING_IMAGE_CONSTRAINTS.maxSizeBytes,
  });
  stage = 'put';
  try {
    await storage.put(key, prepared.data, prepared.contentType);
  } catch (error) {
    console.error(JSON.stringify({ event: 'smoke_put_unknown', objectKey: key }));
    throw error;
  }
  stage = 'sign';
  const { url } = storage.createReadUrl(key, conversation ? 900 : 60);
  signedUrl = url;
  stage = 'signed-get';
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  httpStatus = response.status;
  if (
    !response.ok ||
    response.headers.get('content-type') !== 'image/webp' ||
    !Buffer.from(await response.arrayBuffer()).equals(
      Buffer.from(await prepared.data.arrayBuffer()),
    )
  ) {
    throw new Error('R2 read verification failed');
  }
  const unsigned = new URL(url);
  unsigned.search = '';
  stage = 'unsigned-get';
  const privateResponse = await fetch(unsigned, { signal: AbortSignal.timeout(15_000) });
  httpStatus = privateResponse.status;
  // Missing S3 authentication can also return 400. Require a client rejection, not an outage.
  if (privateResponse.status < 400 || privateResponse.status >= 500)
    throw new Error('Unexpected unsigned access result');
  await privateResponse.body?.cancel();
  console.log('R2 upload, signed GET, byte comparison and unsigned-access rejection passed.');
} catch {
  failed = true;
  console.error('R2 smoke test failed. Check connectivity and bucket-scoped credentials.');
  console.error(JSON.stringify({ event: 'smoke_failed', stage, httpStatus, objectKey: key }));
} finally {
  try {
    await storage.delete(key);
    console.log('Temporary R2 smoke object deleted.');
    if (signedUrl) {
      const deleted = await fetch(signedUrl, {
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      await deleted.body?.cancel();
      if (deleted.status !== 404) throw new Error('Deleted object remains retrievable');
      console.log('Previously signed URL returns 404 after deletion.');
    }
  } catch {
    failed = true;
    console.error(JSON.stringify({ event: 'smoke_cleanup_failed', objectKey: key }));
  }
}
process.exitCode = failed ? 1 : 0;
