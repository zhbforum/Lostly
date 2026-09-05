export function requireApiUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('VITE_API_URL is required when building or starting web');
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid API URL');
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error(
      'VITE_API_URL must be an absolute HTTP(S) URL without credentials, query or fragment',
    );
  }
}
