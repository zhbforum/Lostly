import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './client';
import { advanceSessionGeneration, subscribeToSessionExpiry } from './session-events';

afterEach(() => {
  vi.unstubAllGlobals();
  advanceSessionGeneration();
});

const failure = (code = 'UNAUTHENTICATED') =>
  Response.json({ error: { code, message: 'No session' } }, { status: 401 });

describe('API client', () => {
  it.each([true, false])(
    'preserves Retry-After even when JSON error body is valid: %s',
    async (json) => {
      const response = json
        ? Response.json(
            { error: { code: 'RATE_LIMITED', message: 'Wait' } },
            { status: 429, headers: { 'Retry-After': '42' } },
          )
        : new Response('Busy', { status: 429, headers: { 'Retry-After': '42' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(apiRequest('/conversations/A/messages')).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: 42,
      });
    },
  );

  it('keeps the existing ApiError constructor compatible', () => {
    expect(new ApiError(409, 'CONFLICT', 'Conflict').retryAfterSeconds).toBeNull();
  });

  it('sends FormData unchanged and lets the browser set the multipart boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ image: { id: 'photo' } }));
    vi.stubGlobal('fetch', fetcher);
    const body = new FormData();

    body.append('file', new File(['png'], 'photo.png'));
    await apiRequest('/listings/id/images', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'request' },
    });

    const options = fetcher.mock.calls[0][1];

    expect(options.body).toBe(body);
    expect(options.credentials).toBe('include');
    expect(options.headers.has('Content-Type')).toBe(false);
    expect(options.headers.get('X-CSRF-Protection')).toBe('1');
    expect(options.headers.get('Idempotency-Key')).toBe('request');
  });

  it('serializes JSON, includes cookies and CSRF only on mutations, and supports 204', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();

    await apiRequest('/listings', { signal: controller.signal });

    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      credentials: 'include',
      signal: controller.signal,
    });
    expect((fetcher.mock.calls[0]![1].headers as Headers).has('X-CSRF-Protection')).toBe(false);
    await expect(apiRequest('/auth/logout', { method: 'post', body: {} })).resolves.toBeUndefined();

    const options = fetcher.mock.calls[1]![1];

    expect(options).toMatchObject({ method: 'POST', body: '{}' });
    expect((options.headers as Headers).get('X-CSRF-Protection')).toBe('1');
  });

  it('notifies once on session expiry, but not for invalid credentials', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpiry(listener);

    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(failure('INVALID_CREDENTIALS'))
          .mockResolvedValueOnce(failure()),
      );

      await expect(apiRequest('/auth/login')).rejects.toBeInstanceOf(ApiError);
      expect(listener).not.toHaveBeenCalled();
      await expect(apiRequest('/listings')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('ignores a delayed 401 from a previous login generation', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpiry(listener);

    try {
      const request = apiRequest('/listings');

      advanceSessionGeneration();
      resolve(failure());

      await expect(request).rejects.toBeInstanceOf(ApiError);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it.each([null, [], { error: 42 }, { error: { message: 42 } }])(
    'handles untrusted error bodies: %j',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 503 })));

      await expect(apiRequest('/listings')).rejects.toMatchObject({
        status: 503,
        code: 'HTTP_ERROR',
      });
    },
  );

  it('handles non-JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway down', { status: 502 })),
    );

    await expect(apiRequest('/listings')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
    });
  });
});
