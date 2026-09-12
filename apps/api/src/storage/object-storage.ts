export interface ReadUrl {
  url: string;
  expiresAt: string;
}

export interface ObjectStorage {
  put(key: string, data: Blob, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  createReadUrl(key: string, expiresInSeconds: number): ReadUrl;
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Image storage is temporarily unavailable');
    this.name = 'StorageUnavailableError';
  }
}
