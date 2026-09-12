import { S3Client } from 'bun';
import { StorageUnavailableError, type ObjectStorage } from './object-storage';

export function readR2Config(env: Record<string, string | undefined> = process.env) {
  const {
    R2_ENDPOINT: endpoint,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required',
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('R2_ENDPOINT must be an HTTPS Cloudflare R2 endpoint');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !url.hostname.endsWith('.r2.cloudflarestorage.com')
  ) {
    throw new Error('R2_ENDPOINT must be an HTTPS Cloudflare R2 endpoint');
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export class R2ObjectStorage implements ObjectStorage {
  private client: S3Client | undefined;
  private inFlight = 0;

  private async run(operation: () => Promise<unknown>): Promise<void> {
    if (this.inFlight >= 4) throw new StorageUnavailableError();
    this.inFlight++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep the slot until the native operation settles, even if the caller times out.
    // A timeout is an unknown storage outcome, not proof that PUT was cancelled.
    const pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        this.inFlight--;
      });
    try {
      await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StorageUnavailableError()), 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Lazy construction keeps route compilation and tests independent of credentials.
  private getClient() {
    try {
      return (this.client ??= new S3Client(readR2Config()));
    } catch {
      throw new StorageUnavailableError();
    }
  }

  async put(key: string, data: Blob, contentType: string) {
    try {
      await this.run(() => this.getClient().write(key, data, { type: contentType, retry: 0 }));
    } catch {
      throw new StorageUnavailableError();
    }
  }

  async delete(key: string) {
    try {
      await this.run(() => this.getClient().delete(key));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'NoSuchKey') return;
      throw new StorageUnavailableError();
    }
  }

  createReadUrl(key: string, expiresInSeconds: number) {
    try {
      return {
        url: this.getClient().presign(key, { method: 'GET', expiresIn: expiresInSeconds }),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      };
    } catch {
      throw new StorageUnavailableError();
    }
  }
}

export const objectStorage: ObjectStorage = new R2ObjectStorage();
