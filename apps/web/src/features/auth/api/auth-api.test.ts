import { afterEach, expect, it, vi } from 'vitest';
import { profileUser } from '@/test/fixtures/profile';
import { login, register, startGoogleAuth } from './auth-api';

afterEach(() => vi.unstubAllGlobals());

it('registers with credentials in a CSRF-protected request body', async () => {
  const response = { user: profileUser() };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const input = {
    displayName: 'Alex Morgan',
    email: 'alex@example.com',
    password: 'a long safe password',
  };

  await expect(register(input)).resolves.toEqual(response);

  const [url, options] = fetcher.mock.calls[0]!;

  expect(new URL(String(url)).pathname).toBe('/auth/register');
  expect(new URL(String(url)).search).toBe('');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
  expect(new Headers(options!.headers).get('X-CSRF-Protection')).toBe('1');
});

it.each(['login', 'link'] as const)(
  'starts explicit Google %s with a return destination',
  async (mode) => {
    const response = { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    const returnTo = '/listings?kind=found';

    await expect(startGoogleAuth(mode, returnTo)).resolves.toEqual(response);
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/auth/google/start');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ mode, returnTo }),
    });
  },
);

it('preserves login errors and never retries credentials automatically', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect credentials' } },
        { status: 401 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const input = { email: 'alex@example.com', password: 'incorrect password' };

  await expect(login(input)).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/auth/login');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
});
