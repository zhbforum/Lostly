import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
import { apiRequest } from '@/shared/api/client';
import { readDraft, saveDraft } from '@/shared/model/form-drafts';

const user = { id: 'user-1', email: 'alex@example.com', displayName: 'Alex', role: 'user' };
const unauthorized = () =>
  Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, { status: 401 });
afterEach(() => vi.unstubAllGlobals());

describe('AuthProvider', () => {
  it('expires the session on a later 401 and retains drafts only for the same account', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user }))
        .mockResolvedValueOnce(unauthorized())
        .mockResolvedValueOnce(Response.json({ user }))
        .mockResolvedValueOnce(Response.json({ user: { ...user, id: 'different-user' } })),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    saveDraft('proof', 'private proof');
    await act(async () => {
      await apiRequest('/listings').catch(() => {});
    });
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    expect(result.current.sessionExpired).toBe(true);
    await act(() => result.current.login({ email: user.email, password: 'unused' }));
    expect(readDraft('proof')).toBe('private proof');
    await act(() => result.current.login({ email: 'different@example.com', password: 'unused' }));
    expect(readDraft('proof')).toBeUndefined();
  });

  it('clears drafts on explicit logout', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user }))
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    saveDraft('proof', 'private');
    await act(() => result.current.logout());
    expect(result.current.status).toBe('unauthenticated');
    expect(readDraft('proof')).toBeUndefined();
  });

  it('does not allow a late bootstrap response to overwrite a newer login', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValueOnce(Response.json({ user: { ...user, id: 'new-user' } })),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(() => result.current.login({ email: user.email, password: 'unused' }));
    await act(async () => {
      resolve(Response.json({ user }));
    });
    expect(result.current.user?.id).toBe('new-user');
  });

  it('cancels bootstrap on unmount and distinguishes unavailable API from guest', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('error'));
    unmount();
    expect((fetcher.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
  });
});
