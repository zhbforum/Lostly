import { R2ObjectStorage, readR2Config } from '@/storage/r2-storage';
import { prepareImage } from '@/listing-images/processing';
import { imageFixture } from './image-fixture';

// Explicit, manual-only smoke test. Never invoked by the test runner or CI.
// Uses one unique object; it cannot overwrite or delete a listing's photos.
readR2Config();
const storage = new R2ObjectStorage();
const requestedKey = process.argv[2];
if (requestedKey && !/^_smoke\/listing-photos\/[0-9a-f-]{36}\.webp$/.test(requestedKey)) {
  throw new Error('Only a temporary photo smoke key may be retried');
}
const key = requestedKey ?? `_smoke/listing-photos/${crypto.randomUUID()}.webp`;
let failed = false;
try {
  const prepared = await prepareImage(await imageFixture());
  await storage.put(key, prepared.data, prepared.contentType);
  const { url } = storage.createReadUrl(key, 60);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
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
  const privateResponse = await fetch(unsigned, { signal: AbortSignal.timeout(15_000) });
  if (privateResponse.ok) throw new Error('Unexpected unsigned access');
  await privateResponse.body?.cancel();
  console.log('R2 upload, signed GET, byte comparison and unsigned-access rejection passed.');
} catch {
  failed = true;
  console.error('R2 smoke test failed. Check connectivity and bucket-scoped credentials.');
} finally {
  try {
    await storage.delete(key);
    console.log('Temporary R2 smoke object deleted.');
  } catch {
    failed = true;
    console.error(JSON.stringify({ event: 'smoke_cleanup_failed', objectKey: key }));
  }
}
process.exitCode = failed ? 1 : 0;
