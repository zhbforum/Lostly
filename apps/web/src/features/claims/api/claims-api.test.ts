import { afterEach, expect, it, vi } from 'vitest';
import { claim } from '@/test/fixtures/claims';
import { createClaim, decideClaim, getIncomingClaims } from './claims-api';

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, 'a+/= b'])(
  'loads incoming claims with cursor %s and cancellation',
  async (cursor) => {
    const response = { claims: [], pageInfo: { endCursor: null, hasNextPage: false } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await getIncomingClaims('report/1', signal, cursor)).toEqual(response);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/listings/report%2F1/claims');
    expect(new URL(String(url)).searchParams.get('cursor')).toBe(cursor ?? null);
    expect(options).toMatchObject({ method: 'GET', credentials: 'include', signal });
  },
);

it('submits ownership proof in a protected request body, not in the URL', async () => {
  const input = { verificationDetails: 'A green keychain in the inside pocket.' };
  const response = { claim: claim({ verificationDetails: input.verificationDetails }) };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response, { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await createClaim('report/1', input)).toEqual(response);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toBe('/listings/report%2F1/claims');
  expect(new URL(String(url)).search).toBe('');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
  expect(new Headers(options!.headers).get('X-CSRF-Protection')).toBe('1');
});

it.each([
  { decision: 'approved' as const, handoverDetails: 'Meet at the library reception.' },
  { decision: 'rejected' as const },
])('submits a $decision decision and returns the authoritative claim', async (input) => {
  const response = {
    claim: claim({
      status: input.decision,
      handoverDetails: input.handoverDetails ?? null,
      reviewedAt: '2026-09-25T12:00:00.000Z',
    }),
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  expect(await decideClaim('claim/1', input)).toEqual(response);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toBe('/claims/claim%2F1');
  expect(options).toMatchObject({ method: 'PATCH', body: JSON.stringify(input) });
  expect(new Headers(options!.headers).get('X-CSRF-Protection')).toBe('1');
});

it('preserves a stale decision conflict without retrying the mutation', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'CLAIM_ALREADY_DECIDED', message: 'Refresh the claim' } },
        { status: 409 },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(decideClaim('claim-1', { decision: 'rejected' })).rejects.toMatchObject({
    status: 409,
    code: 'CLAIM_ALREADY_DECIDED',
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
