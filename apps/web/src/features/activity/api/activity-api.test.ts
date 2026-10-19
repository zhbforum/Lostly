import { afterEach, expect, it, vi } from 'vitest';
import { getActivity } from './activity-api';

afterEach(() => vi.unstubAllGlobals());

it.each(['reports', 'claims', 'incoming'] as const)(
  'loads the %s tab with its cursor, credentials and cancellation signal',
  async (tab) => {
    const pageInfo = { endCursor: 'next', hasNextPage: true };
    const response = tab === 'reports' ? { listings: [], pageInfo } : { claims: [], pageInfo };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;

    expect(await getActivity(tab, 'a+/= b', signal)).toEqual({
      ...response,
      kind: tab === 'reports' ? 'reports' : 'claims',
    });
    const [url, options] = fetcher.mock.calls[0]!;
    const address = new URL(String(url));
    expect(address.pathname).toBe(tab === 'reports' ? '/me/listings' : '/me/claims');
    expect(address.searchParams.get('cursor')).toBe('a+/= b');
    expect(address.searchParams.get('direction')).toBe(
      tab === 'reports' ? null : tab === 'incoming' ? 'incoming' : 'outgoing',
    );
    expect(options).toMatchObject({ method: 'GET', credentials: 'include', signal });
  },
);

it('omits an absent cursor and preserves an invalid-cursor error for the page to recover', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'INVALID_CURSOR', message: 'Restart pagination' } },
        { status: 400 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(
    getActivity('reports', undefined, new AbortController().signal),
  ).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_CURSOR',
  });
  expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.has('cursor')).toBe(false);
});
