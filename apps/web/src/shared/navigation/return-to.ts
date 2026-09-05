export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  try {
    const decodedPath = decodeURIComponent(value.split(/[?#]/)[0]!);
    if (
      decodedPath.startsWith('//') ||
      decodedPath.includes('\\') ||
      hasControlCharacters(decodedPath) ||
      hasControlCharacters(value)
    )
      return '/';
    const url = new URL(value, 'https://lostly.invalid');
    if (
      url.origin !== 'https://lostly.invalid' ||
      /^\/(login|register)\/?$/.test(decodeURIComponent(url.pathname))
    )
      return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
