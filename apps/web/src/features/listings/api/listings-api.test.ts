import { afterEach, expect, it, vi } from 'vitest';
import { ownerReport } from '@/test/fixtures/listing-management';
import {
  archiveListing,
  createListing,
  getListing,
  getListings,
  resolveListing,
  updateListing,
} from './listings-api';

afterEach(() => vi.unstubAllGlobals());

const input = {
  kind: 'lost' as const,
  title: 'Blue backpack',
  description: 'A blue backpack with a red zip.',
  location: 'Berlin library',
  occurredOn: '2026-09-01',
};

it('creates a report with its details in the body and returns the saved listing', async () => {
  const response = { listing: ownerReport().listing };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);

  await expect(createListing(input)).resolves.toEqual(response);

  const [url, options] = fetcher.mock.calls[0]!;

  expect(new URL(String(url)).pathname).toBe('/listings');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
  expect(new Headers(options!.headers).get('X-CSRF-Protection')).toBe('1');
});

it('fetches encoded report IDs and forwards cancellation', async () => {
  const response = ownerReport();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();

  await expect(getListing('report/1', signal)).resolves.toEqual(response);
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/listings/report%2F1');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', signal });
});

it('includes the expected version in an update and preserves a stale-write rejection', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'LISTING_CHANGED', message: 'Reload the report' } },
        { status: 409 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { signal } = new AbortController();
  const change = { ...input, expectedVersion: 3 };

  await expect(updateListing('report/1', change, signal)).rejects.toMatchObject({
    status: 409,
    code: 'LISTING_CHANGED',
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/listings/report%2F1');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'PATCH',
    body: JSON.stringify(change),
    signal,
  });
});

it.each([
  ['resolve', resolveListing],
  ['archive', archiveListing],
] as const)('posts the %s transition without a fabricated body', async (action, request) => {
  const response = { listing: ownerReport(action === 'resolve' ? 'resolved' : 'archived').listing };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);

  await expect(request('report/1')).resolves.toEqual(response);
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe(
    `/listings/report%2F1/${action}`,
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: undefined });
});

it.each([{}, { kind: 'found' as const, sort: 'oldest' as const, cursor: 'a+/= b' }])(
  'serializes only supplied feed filters: %j',
  async (query) => {
    const response = { listings: [], pageInfo: { endCursor: null, hasNextPage: false } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    const { signal } = new AbortController();

    await expect(getListings(query, signal)).resolves.toEqual(response);

    const url = new URL(String(fetcher.mock.calls[0]![0]));

    expect(url.pathname).toBe('/listings');
    expect(Object.fromEntries(url.searchParams)).toEqual(query);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', signal });
  },
);
