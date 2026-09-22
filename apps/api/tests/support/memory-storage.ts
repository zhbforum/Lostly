import type { ObjectStorage } from '@/storage/object-storage';

export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Blob>();
  constructor(
    private readonly origin = 'http://localhost:3000',
    private readonly now = Date.now,
  ) {}
  async put(key: string, data: Blob, contentType: string) {
    this.objects.set(key, new Blob([data], { type: contentType }));
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  createReadUrl(key: string, expiresInSeconds: number) {
    const expires = this.now() + expiresInSeconds * 1000;
    return {
      url: `${this.origin}/__test/images/${key}?expires=${expires}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }
}
