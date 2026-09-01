const apiUrl = import.meta.env.VITE_API_URL;

if (!apiUrl) {
  throw new Error('VITE_API_URL is not configured');
}

const API_URL = apiUrl.replace(/\/+$/, '');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_HEADER_NAME = 'X-CSRF-Protection';
const CSRF_HEADER_VALUE = '1';

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
  }

  const response = await fetch(`${API_URL}${normalizePath(path)}`, {
    ...options,
    method,
    headers,
    body,
    credentials: 'include',
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function createApiError(response: Response): Promise<ApiError> {
  let errorResponse: ApiErrorResponse | undefined;

  try {
    errorResponse = (await response.json()) as ApiErrorResponse;
  } catch {
    // The response may not contain a JSON error body.
  }

  return new ApiError(
    response.status,
    errorResponse?.error?.code ?? 'HTTP_ERROR',
    errorResponse?.error?.message ?? `Request failed with status ${response.status}`,
  );
}
