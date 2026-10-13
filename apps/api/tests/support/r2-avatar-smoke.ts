import sharp from 'sharp';
import { prepareAvatar } from '@/profile/processing';
import { R2ObjectStorage, readR2Config } from '@/storage/r2-storage';
import { gifFixture } from './image-fixture';

if (process.argv.length > 2) throw new Error('Avatar smoke does not accept arguments');
readR2Config();
const storage = new R2ObjectStorage();
const prefix = `avatars/${crypto.randomUUID()}/${crypto.randomUUID()}`;
const objects: { key: string; data: Blob; signedUrl?: string }[] = [];
let failed = false;
let stage = 'normalize';
let currentKey: string | undefined;
try {
  const prepared = await prepareAvatar(await gifFixture());
  if (!prepared.animated) throw new Error('Expected an animated avatar');
  objects.push(
    { key: `${prefix}.webp`, data: prepared.image },
    { key: `${prefix}-still.webp`, data: prepared.still },
  );
  for (const object of objects) {
    currentKey = object.key;
    stage = 'put';
    await storage.put(object.key, object.data, 'image/webp');
    stage = 'signed-get';
    object.signedUrl = storage.createReadUrl(object.key, 60).url;
    const response = await fetch(object.signedUrl, { signal: AbortSignal.timeout(15_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      !response.ok ||
      response.headers.get('content-type') !== 'image/webp' ||
      !bytes.equals(Buffer.from(await object.data.arrayBuffer()))
    )
      throw new Error('Avatar read verification failed');
    const metadata = await sharp(bytes, { animated: true }).metadata();
    const still = object.key.endsWith('-still.webp');
    if (metadata.width !== 256 || (metadata.pages ?? 1) !== (still ? 1 : 2))
      throw new Error('Avatar frames or dimensions were not preserved');
    stage = 'unsigned-get';
    const unsigned = new URL(object.signedUrl);
    unsigned.search = '';
    const privateResponse = await fetch(unsigned, { signal: AbortSignal.timeout(15_000) });
    await privateResponse.body?.cancel();
    if (privateResponse.status < 400 || privateResponse.status >= 500)
      throw new Error('Unexpected unsigned access result');
  }
  console.log('R2 avatar checks passed: animated and still WebP, signed reads, private access.');
} catch {
  failed = true;
  console.error(JSON.stringify({ event: 'avatar_smoke_failed', stage, objectKey: currentKey }));
} finally {
  for (const object of objects) {
    try {
      await storage.delete(object.key);
      if (object.signedUrl) {
        const deleted = await fetch(object.signedUrl, {
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
        });
        await deleted.body?.cancel();
        if (deleted.status !== 404) throw new Error('Deleted object remains retrievable');
      }
      console.log('Temporary avatar smoke object deleted.');
    } catch {
      failed = true;
      console.error(
        JSON.stringify({ event: 'avatar_smoke_cleanup_failed', objectKey: object.key }),
      );
    }
  }
}
process.exitCode = failed ? 1 : 0;
