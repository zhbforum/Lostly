const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER_NAME = 'X-CSRF-Protection';
export const CSRF_HEADER_VALUE = '1';

export function isCsrfProtectedRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  return request.headers.get(CSRF_HEADER_NAME) === CSRF_HEADER_VALUE;
}
