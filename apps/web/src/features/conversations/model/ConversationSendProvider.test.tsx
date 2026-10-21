import { type ReactNode, StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import {
  advanceSessionGeneration,
  getSessionGeneration,
  notifySessionExpiry,
} from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { clearDrafts } from '@/shared/model/form-drafts';
import { readConversationDraft, saveConversationDraft } from './message-drafts';
import { message } from '@/test/fixtures/conversations';
import { sendConversationMessage } from '../api/conversations-api';
import { ConversationSendProvider } from './ConversationSendProvider';
import { useConversationSend } from './conversation-send-context';
import type { SendResult, SendStart } from './send-operations';
import type { ClaimMessageResponse } from './types';

vi.mock('../api/conversations-api');

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  cleanup();
  clearDrafts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  advanceSessionGeneration();
});

const auth = {
  status: 'authenticated' as const,
  user: { id: 'user-1', email: 'alex@example.com', displayName: 'Alex', role: 'user' as const },
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  updateProfile: () => {},
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <ConversationSendProvider>{children}</ConversationSendProvider>
      </AuthContext.Provider>
    </StrictMode>
  );
}

function acceptedCompletion(start: SendStart): Promise<SendResult> {
  assert(start.accepted);
  return start.completion;
}

describe('session-owned send operations', () => {
  it('registers synchronously and sends without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

    expect(crypto.randomUUID).toBeUndefined();

    vi.mocked(sendConversationMessage).mockResolvedValueOnce({ message: message(1) });
    const { result } = renderHook(useConversationSend, { wrapper });
    let started!: SendStart;

    act(() => {
      started = result.current.sendMessage('A', { body: '  Hello\r\nAlex  ', images: [] });
      assert(started.accepted);
      expect(sendConversationMessage).not.toHaveBeenCalled();
      expect(result.current.retry('A', started.operation.operationId)).toBe(started.completion);
    });
    assert(started.accepted);

    expect(result.current.operations.A).toEqual([started.operation]);
    expect(started.operation).toMatchObject({ body: 'Hello\nAlex', status: 'sending' });
    expect(started.operation.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const { operation, completion } = started;

    await act(async () => {
      expect(await completion).toMatchObject({ status: 'sent', operation });
    });

    expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(
      'A',
      { body: operation.body, images: [] },
      operation.operationId,
    );
    expect(result.current.operations).toEqual({});
  });

  it('retains a normalized uncertain send and confirms it with the same UUID/body', async () => {
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new TypeError('Response lost after commit'))
      .mockResolvedValueOnce({ message: message(1) });
    const { result } = renderHook(useConversationSend, { wrapper });

    await act(async () => {
      await acceptedCompletion(
        result.current.sendMessage('A', { body: ' \r\nHello\r\nAlex  ', images: [] }),
      );
    });

    const operation = result.current.operations.A[0];

    expect(operation).toMatchObject({
      body: 'Hello\nAlex',
      status: 'uncertain',
      sessionGeneration: getSessionGeneration(),
    });
    expect(operation.operationId).toMatch(/^[0-9a-f-]{36}$/);

    const listener = vi.fn();
    const unsubscribe = result.current.subscribeToResults(listener);

    await act(async () => {
      expect(await result.current.retry('A', operation.operationId)).toMatchObject({
        status: 'sent',
        message: message(1),
      });
    });

    expect(vi.mocked(sendConversationMessage).mock.calls).toEqual([
      ['A', { body: 'Hello\nAlex', images: [] }, operation.operationId],
      ['A', { body: 'Hello\nAlex', images: [] }, operation.operationId],
    ]);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
    expect(result.current.operations).toEqual({});

    unsubscribe();
  });

  it('single-flights retries and never reconciles two identical messages by body', async () => {
    const transport = deferred<ClaimMessageResponse>();
    vi.mocked(sendConversationMessage).mockReturnValue(transport.promise);
    const { result } = renderHook(useConversationSend, { wrapper });
    let first!: Promise<SendResult>;
    let second!: Promise<SendResult>;

    act(() => {
      first = acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
      second = acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
    });

    const [a, b] = result.current.operations.A;

    expect(a.operationId).not.toBe(b.operationId);
    expect(result.current.retry('A', a.operationId)).toBe(first);
    expect(await result.current.retry('B', a.operationId)).toEqual({ status: 'ignored' });
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(2));

    await act(async () => {
      transport.resolve({ message: message(1) });
      await Promise.all([first, second]);
    });

    expect(result.current.operations).toEqual({});
  });

  it('retains a possibly committed key through an unavailable retry and resolves it after restore', async () => {
    // GIVEN: the original send may be committed, but both its response and a later retry fail.
    const unavailableResponse = deferred<ClaimMessageResponse>();
    const unavailable = new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Unavailable');
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new TypeError('Committed, response lost'))
      .mockReturnValueOnce(unavailableResponse.promise)
      .mockResolvedValueOnce({ message: message(7) });
    const { result } = renderHook(useConversationSend, { wrapper });

    await act(async () => {
      await acceptedCompletion(
        result.current.sendMessage('A', { body: ' \r\nHello\r\nAlex  ', images: [] }),
      );
    });

    const operation = result.current.operations.A[0];

    expect(operation).toMatchObject({
      status: 'uncertain',
      mayBePersisted: true,
      body: 'Hello\nAlex',
    });

    const listener = vi.fn();

    result.current.subscribeToResults(listener);

    let retry!: Promise<SendResult>;

    act(() => {
      retry = result.current.retry('A', operation.operationId);
    });

    expect(result.current.operations.A[0]).toMatchObject({
      status: 'sending',
      mayBePersisted: true,
      operationId: operation.operationId,
    });

    await act(async () => {
      unavailableResponse.reject(unavailable);
      expect(await retry).toMatchObject({
        status: 'uncertain',
        error: unavailable,
        operation: { operationId: operation.operationId, mayBePersisted: true },
      });
    });

    expect(result.current.operations.A).toEqual([{ ...operation, status: 'uncertain' }]);
    // The thread still receives the disappearance signal independently of delivery uncertainty.
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'uncertain',
        error: unavailable,
      }),
    );

    // WHEN: the conversation becomes available again, retry the retained operation.
    await act(async () => {
      expect(await result.current.retry('A', operation.operationId)).toMatchObject({
        status: 'sent',
        message: message(7),
      });
    });

    // THEN: every attempt uses the original key and normalized payload.
    expect(vi.mocked(sendConversationMessage).mock.calls).toEqual([
      ['A', { body: 'Hello\nAlex', images: [] }, operation.operationId],
      ['A', { body: 'Hello\nAlex', images: [] }, operation.operationId],
      ['A', { body: 'Hello\nAlex', images: [] }, operation.operationId],
    ]);
    expect(result.current.operations).toEqual({});
  });

  it('removes an initial definitive CONVERSATION_NOT_FOUND without prior delivery uncertainty', async () => {
    const error = new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Unavailable');
    vi.mocked(sendConversationMessage).mockRejectedValueOnce(error);
    const { result } = renderHook(useConversationSend, { wrapper });

    await act(async () => {
      expect(
        await acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] })),
      ).toMatchObject({
        status: 'rejected',
        error,
        operation: { mayBePersisted: false },
      });
    });

    expect(result.current.operations).toEqual({});
    expect(sendConversationMessage).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'isolates a throwing subscriber from later listeners and send completion (reportError: %s)',
    async (hasReportError) => {
      const failure = new Error('Thread controller was disposed');
      const report = vi.fn();
      vi.stubGlobal('reportError', hasReportError ? report : undefined);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(sendConversationMessage).mockResolvedValueOnce({ message: message(1) });
      const { result } = renderHook(useConversationSend, { wrapper });
      const throwingListener = vi.fn(() => {
        throw failure;
      });
      const nextListener = vi.fn();

      result.current.subscribeToResults(throwingListener);
      result.current.subscribeToResults(nextListener);

      let outcome!: SendResult;

      await act(async () => {
        outcome = await acceptedCompletion(
          result.current.sendMessage('A', { body: 'Hello', images: [] }),
        );
      });

      expect(outcome).toMatchObject({ status: 'sent', message: message(1) });
      expect(throwingListener).toHaveBeenCalledOnce();
      expect(nextListener).toHaveBeenCalledExactlyOnceWith(outcome);
      expect(result.current.operations).toEqual({});

      if (hasReportError) {
        expect(report).toHaveBeenCalledExactlyOnceWith(failure);
        expect(consoleError).not.toHaveBeenCalled();
      } else {
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
      }
    },
  );

  it('retains 429 operations and permits a same-key retry only after Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Wait', 42))
      .mockResolvedValueOnce({ message: message(1) });
    const { result } = renderHook(useConversationSend, { wrapper });

    await act(async () => {
      await acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
    });

    const operation = result.current.operations.A[0];

    expect(operation).toMatchObject({
      status: 'rate-limited',
      retryAfterUntil: Date.now() + 42_000,
    });
    expect(await result.current.retry('A', operation.operationId)).toMatchObject({
      status: 'rate-limited',
    });
    expect(sendConversationMessage).toHaveBeenCalledOnce();

    vi.setSystemTime(Date.now() + 42_000);

    await act(async () => {
      await result.current.retry('A', operation.operationId);
    });

    expect(vi.mocked(sendConversationMessage).mock.calls[1]).toEqual([
      'A',
      { body: 'Hello', images: [] },
      operation.operationId,
    ]);
    expect(result.current.operations).toEqual({});
  });

  it.each([
    new ApiError(409, 'CONVERSATION_READ_ONLY', 'Read only'),
    new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Conflict'),
    new ApiError(422, 'VALIDATION_ERROR', 'Invalid'),
  ])(
    'returns definitive errors with the original body, without uncertain/automatic retry: $code',
    async (error) => {
      vi.mocked(sendConversationMessage).mockRejectedValue(error);
      const { result } = renderHook(useConversationSend, { wrapper });
      let outcome!: SendResult;

      await act(async () => {
        outcome = await acceptedCompletion(
          result.current.sendMessage('A', { body: 'Keep this body', images: [] }),
        );
      });

      expect(outcome).toMatchObject({
        status: 'rejected',
        operation: { body: 'Keep this body' },
        error,
      });
      expect(result.current.operations).toEqual({});
      expect(sendConversationMessage).toHaveBeenCalledOnce();
    },
  );

  it.each([
    new Error('Offline'),
    new ApiError(503, 'HTTP_ERROR', 'Gateway unavailable'),
    new ApiError(408, 'HTTP_ERROR', 'Timeout'),
  ])('treats ambiguous transport/server failures as uncertain: %s', async (error) => {
    vi.mocked(sendConversationMessage).mockRejectedValue(error);
    const { result } = renderHook(useConversationSend, { wrapper });

    await act(async () => {
      await acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
    });

    expect(result.current.operations.A[0]).toMatchObject({
      status: 'uncertain',
      mayBePersisted: true,
    });
  });

  it.each(['success', 'error', 'rejection'] as const)(
    'ignores a late old-session %s without disturbing a newer operation',
    async (completion) => {
      const oldRequest = deferred<ClaimMessageResponse>();
      const newRequest = deferred<ClaimMessageResponse>();
      vi.mocked(sendConversationMessage)
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(newRequest.promise);
      const { result } = renderHook(useConversationSend, { wrapper });
      const oldMethods = result.current;
      const oldListener = vi.fn();

      oldMethods.subscribeToResults(oldListener);

      let oldSend!: Promise<SendResult>;

      act(() => {
        oldSend = acceptedCompletion(
          result.current.sendMessage('A', { body: 'Old session', images: [] }),
        );
      });

      await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledOnce());

      // WHEN: a new session starts while the old transport is still pending.
      act(() => advanceSessionGeneration());
      saveConversationDraft('A', { text: 'New session draft', images: [] }, getSessionGeneration());

      expect(result.current.operations).toEqual({});
      expect(oldMethods.sendMessage('A', { body: 'Stale handler', images: [] })).toEqual({
        accepted: false,
        result: { status: 'ignored' },
      });
      expect(result.current.operations).toEqual({});
      expect(sendConversationMessage).toHaveBeenCalledOnce();

      let newSend!: Promise<SendResult>;

      act(() => {
        newSend = acceptedCompletion(
          result.current.sendMessage('A', { body: 'New session', images: [] }),
        );
      });

      await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(2));

      const current = result.current.operations.A[0];

      // WHEN: the previous session completes after the replacement send has started.
      await act(async () => {
        if (completion === 'success') oldRequest.resolve({ message: message(1) });
        else if (completion === 'rejection')
          oldRequest.reject(new ApiError(409, 'CONVERSATION_READ_ONLY', 'Read-only'));
        else oldRequest.reject(new Error('Old network error'));
        expect(await oldSend).toEqual({ status: 'ignored' });
      });

      // THEN: neither old listeners nor the new session's draft and operation are affected.
      expect(oldListener).not.toHaveBeenCalled();
      expect(readConversationDraft('A').text).toBe('New session draft');
      expect(result.current.operations.A).toEqual([current]);

      // Only the current session's completion can clear its operation.
      await act(async () => {
        newRequest.resolve({ message: message(2) });
        await newSend;
      });

      expect(result.current.operations).toEqual({});
    },
  );

  it('clears immediately on session expiry and never sends invalid text', async () => {
    vi.mocked(sendConversationMessage).mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(useConversationSend, { wrapper });

    expect(result.current.sendMessage('A', { body: ' \n ', images: [] })).toEqual({
      accepted: false,
      result: { status: 'invalid' },
    });
    expect(result.current.operations).toEqual({});
    expect(sendConversationMessage).not.toHaveBeenCalled();

    await act(async () => {
      await acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
    });
    act(() => notifySessionExpiry(getSessionGeneration()));

    expect(result.current.operations).toEqual({});
  });

  it('does not publish completions after the session provider unmounts', async () => {
    const transport = deferred<ClaimMessageResponse>();
    vi.mocked(sendConversationMessage).mockReturnValue(transport.promise);
    const { result, unmount } = renderHook(useConversationSend, { wrapper });
    const listener = vi.fn();

    result.current.subscribeToResults(listener);

    let pending!: Promise<SendResult>;

    act(() => {
      pending = acceptedCompletion(result.current.sendMessage('A', { body: 'Hello', images: [] }));
    });

    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledOnce());

    unmount();
    transport.resolve({ message: message(1) });

    expect(await pending).toEqual({ status: 'ignored' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('image operation ownership', () => {
  const photo = (name: string) => new File([name], name, { type: 'image/jpeg' });

  it('keeps the first post-commit 404 uncertain through 429 and restore, retrying the exact snapshot', async () => {
    const a = photo('A');
    const b = photo('B');
    const images = [a, b, a];
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Hidden after commit'))
      .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Capacity', 0))
      .mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Still hidden'))
      .mockResolvedValueOnce({ message: message(7, { body: null }) });
    const { result } = renderHook(useConversationSend, { wrapper });
    let started!: SendStart;

    act(() => {
      started = result.current.sendMessage('A', { body: ' \r\n ', images });
    });
    assert(started.accepted);

    const original = started.operation;
    const completion = started.completion;

    expect(original.body).toBeNull();
    expect(original.images).not.toBe(images);
    expect(Object.isFrozen(original.images)).toBe(true);

    images[0] = b;
    images.pop();
    await act(async () => {
      await completion;
    });

    expect(result.current.operations.A[0]).toMatchObject({
      status: 'uncertain',
      mayBePersisted: true,
    });
    expect(readConversationDraft('A')).toEqual({ text: '', images: [] });

    await act(() => result.current.retry('A', original.operationId));

    expect(result.current.operations.A[0]).toMatchObject({
      status: 'rate-limited',
      mayBePersisted: true,
    });

    await act(() => result.current.retry('A', original.operationId));

    expect(result.current.operations.A[0]).toMatchObject({
      status: 'uncertain',
      mayBePersisted: true,
    });

    await act(() => result.current.retry('A', original.operationId));

    expect(result.current.operations).toEqual({});

    for (const [id, payload, key] of vi.mocked(sendConversationMessage).mock.calls) {
      expect(id).toBe('A');
      expect(key).toBe(original.operationId);
      expect(payload.body).toBeNull();
      expect(payload.images).toBe(original.images);

      [a, b, a].forEach((file, index) => expect(payload.images[index]).toBe(file));
    }
  });

  it.each([
    new TypeError('Network uncertain'),
    new ApiError(408, 'IMAGE_UPLOAD_TIMEOUT', 'Timeout'),
    new ApiError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Unavailable'),
    new ApiError(429, 'RATE_LIMITED', 'Busy', 2),
  ])('retains body/files and operation identity on %s', async (error) => {
    const files = [photo('A'), photo('B')];
    vi.mocked(sendConversationMessage).mockRejectedValueOnce(error);
    const { result } = renderHook(useConversationSend, { wrapper });
    let operation!: SendStart;

    await act(async () => {
      operation = result.current.sendMessage('A', { body: ' \r\nCaption\rText ', images: files });
      await acceptedCompletion(operation);
    });
    assert(operation.accepted);

    const pending = result.current.operations.A[0];

    expect(pending.body).toBe('Caption\nText');
    expect(pending.operationId).toBe(operation.operation.operationId);
    expect(pending.images).toBe(operation.operation.images);

    files.forEach((file, index) => expect(pending.images[index]).toBe(file));

    expect(pending.status).toBe(
      error instanceof ApiError && error.status === 429 ? 'rate-limited' : 'uncertain',
    );
  });

  it.each([413, 415, 422, 409])(
    'restores normalized payload on definitive HTTP %i, even without a composer',
    async (status) => {
      const files = [photo('A'), photo('B')];
      vi.mocked(sendConversationMessage).mockRejectedValueOnce(
        new ApiError(status, 'REJECTED', 'Rejected'),
      );
      const { result } = renderHook(useConversationSend, { wrapper });

      await act(async () => {
        await acceptedCompletion(
          result.current.sendMessage('A', { body: ' Caption\r\n ', images: files }),
        );
      });

      expect(result.current.operations).toEqual({});

      const restored = readConversationDraft('A');

      expect(restored.text).toBe('Caption');

      files.forEach((file, index) => expect(restored.images[index]).toBe(file));
    },
  );

  it.each(['success', 'rejection', 'uncertain'] as const)(
    'ignores old-session image %s without resurrecting its files',
    async (outcome) => {
      const transport = deferred<ClaimMessageResponse>();
      const file = photo('Old file');
      vi.mocked(sendConversationMessage).mockReturnValueOnce(transport.promise);
      const { result } = renderHook(useConversationSend, { wrapper });
      const listener = vi.fn();

      result.current.subscribeToResults(listener);

      let completion!: Promise<SendResult>;

      act(() => {
        completion = acceptedCompletion(
          result.current.sendMessage('A', { body: null, images: [file] }),
        );
      });

      await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledOnce());

      act(() => advanceSessionGeneration());

      const newFile = photo('New session');

      act(() =>
        saveConversationDraft('A', { text: 'New', images: [newFile] }, getSessionGeneration()),
      );

      // WHEN: the previous session finishes after the new session has attached its own file.
      await act(async () => {
        if (outcome === 'success') transport.resolve({ message: message(1) });
        else
          transport.reject(
            outcome === 'rejection'
              ? new ApiError(422, 'VALIDATION_ERROR', 'Bad image')
              : new Error('Offline'),
          );
        expect(await completion).toEqual({ status: 'ignored' });
      });

      // THEN: old files cannot reappear in the current session's draft.
      expect(result.current.operations).toEqual({});
      expect(listener).not.toHaveBeenCalled();
      expect(readConversationDraft('A').images).toHaveLength(1);
      expect(readConversationDraft('A').images[0]).toBe(newFile);
    },
  );
});
