import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { attachment, renewed } from '@/test/fixtures/conversation-attachments';
import { refreshMessageAttachments } from '../api/conversations-api';
import { acceptMessageAttachments } from './attachment-resource';
import { reconcileAttachmentCapabilities } from './attachment-capabilities';
import type { RefreshMessageAttachmentsResponse } from './types';

vi.mock('../api/conversations-api');

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-05T15:00:00Z');
});

afterEach(() => {
  vi.useRealTimers();
});

const expiry = (time: string) => `2026-10-05T${time}:00Z`;
const resource = (images = [attachment()], sequence = 1, conversationId = 'A') =>
  acceptMessageAttachments(message(sequence, { conversationId, attachments: images }));

describe('monotonic capabilities', () => {
  it('atomically combines incoming A with current B, in position order', () => {
    const current = [
      attachment(0, { urlExpiresAt: expiry('15:10') }),
      attachment(1, { urlExpiresAt: expiry('15:20') }),
    ];
    const incoming = [
      attachment(1, { url: 'B-old', urlExpiresAt: expiry('15:15') }),
      attachment(0, { url: 'A-new', urlExpiresAt: expiry('15:30') }),
    ];
    const state = resource(current);
    const published = vi.fn();

    state.subscribe(published);
    state.ingest(incoming);

    expect(published).toHaveBeenCalledOnce();
    expect(state.getSnapshot().attachments).toEqual([incoming[1], current[1]]);
  });

  it.each([expiry('15:15'), expiry('15:10'), 'invalid'])(
    'keeps identity and version for equal, older or invalid incoming expiry: %s',
    (urlExpiresAt) => {
      const current = resource();
      const before = current.getSnapshot();

      current.ingest([attachment(0, { url: 'other', urlExpiresAt })]);

      expect(current.getSnapshot()).toBe(before);
    },
  );

  it('allows valid expiry to replace invalid, but keeps current when both are invalid', () => {
    const original = [attachment(0, { urlExpiresAt: 'invalid' })];

    expect(
      reconcileAttachmentCapabilities(original, [attachment(0, { urlExpiresAt: 'also-invalid' })]),
    ).toBe(original);
    expect(
      Date.parse(reconcileAttachmentCapabilities(original, [attachment()])[0].urlExpiresAt),
    ).toBe(Date.parse(expiry('15:15')));
  });

  it('compares delayed refresh with live state, not its request-start snapshot', async () => {
    const late = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
    const current = resource();
    const pending = current.recover(true);
    const later = attachment(0, { url: 'history-newest', urlExpiresAt: expiry('15:40') });

    // WHEN: history supplies a newer capability before the pending refresh returns.
    current.ingest([later]);
    late.resolve({
      attachments: [attachment(0, { url: 'refresh-older', urlExpiresAt: expiry('15:30') })],
    });
    await pending;

    // THEN: compare with live state, preserving the newer capability.
    expect(current.getSnapshot().attachments).toEqual([later]);
  });

  it.each([
    { kind: 'network', error: new TypeError('Offline') },
    { kind: '5xx', error: new ApiError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Unavailable') },
  ])(
    'ignores a delayed $kind failure after a newer fresh group has fully loaded',
    async ({ error }) => {
      const late = deferred<RefreshMessageAttachmentsResponse>();
      vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
      const images = [attachment(), attachment(1)];
      const current = resource(images);
      const pending = current.recover(false, true);

      await Promise.resolve();

      expect(refreshMessageAttachments).toHaveBeenCalledOnce();
      expect(current.getSnapshot().automaticAvailable).toBe(false);

      current.ingest(renewed(images, 30 * 60_000));

      const version = current.getSnapshot().version;

      for (const image of images) current.loaded(version, image.id);

      expect(current.getSnapshot()).toMatchObject({ automaticAvailable: true, retryable: false });

      const recovered = current.getSnapshot();

      // WHEN: the obsolete refresh fails after every replacement image has loaded.
      late.reject(error);
      await pending;

      // THEN: the failure cannot undo recovery or consume the renewed retry budget.
      expect(current.getSnapshot()).toEqual({ ...recovered, refreshing: false });
      expect(current.getSnapshot().attachments).toBe(recovered.attachments);
    },
  );

  it('keeps a delayed failure retryable when the newer group has not fully loaded', async () => {
    const late = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
    const images = [attachment(), attachment(1)];
    const current = resource(images);
    const pending = current.recover(false, true);

    await Promise.resolve();
    current.ingest(renewed(images, 30 * 60_000));
    current.loaded(current.getSnapshot().version, images[0].id);
    late.reject(new TypeError('Offline'));
    await pending;

    expect(current.getSnapshot()).toMatchObject({
      automaticAvailable: false,
      retryable: true,
      refreshing: false,
    });
  });
});

describe('single-flight and session boundaries', () => {
  it('coalesces all consumers, but separates conversations and messages', async () => {
    const late = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments).mockReturnValue(late.promise);
    const first = resource();

    expect(resource()).toBe(first);

    const pending = first.recover(false, true);

    for (let i = 0; i < 4; i++) expect(first.recover(true)).toBe(pending);

    const second = resource(undefined, 2);
    const other = resource(undefined, 1, 'B');
    const requests = [pending, second.recover(true), other.recover(true)];

    await Promise.resolve();

    expect(refreshMessageAttachments).toHaveBeenCalledTimes(3);

    late.resolve({ attachments: [attachment()] });
    await Promise.all(requests);
  });

  it('removes a settled rejected promise and allows a genuine manual retry', async () => {
    vi.mocked(refreshMessageAttachments)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ attachments: [attachment(0, { urlExpiresAt: expiry('15:30') })] });
    const current = resource();
    const first = current.recover(false, true);

    await first;

    expect(current.getSnapshot()).toMatchObject({
      refreshing: false,
      retryable: true,
      automaticAvailable: false,
    });

    await current.recover(false, true);

    expect(refreshMessageAttachments).toHaveBeenCalledOnce();

    const second = current.recover(true);

    expect(second).not.toBe(first);

    await second;

    expect(refreshMessageAttachments).toHaveBeenCalledTimes(2);
  });

  it('clears capabilities and ignores old completion even on same-user relogin', async () => {
    const oldResponse = deferred<RefreshMessageAttachmentsResponse>();
    const newResponse = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments)
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(newResponse.promise);
    const old = resource();
    const oldPending = old.recover(true);

    await Promise.resolve();
    advanceSessionGeneration();

    expect(old.getSnapshot().attachments).toEqual([]);

    const current = resource();
    const currentPending = current.recover(true);

    expect(currentPending).not.toBe(oldPending);

    // WHEN: a previous session's refresh finishes after the new session has started its own.
    await Promise.resolve();
    oldResponse.resolve({
      attachments: [attachment(0, { url: 'old-session-secret', urlExpiresAt: expiry('16:00') })],
    });
    await oldPending;

    expect(old.getSnapshot().attachments).toEqual([]);
    expect(current.getSnapshot().attachments[0].url).not.toContain('old-session');

    // Only the current session may publish its capability URLs.
    newResponse.resolve({
      attachments: [attachment(0, { url: 'current-session', urlExpiresAt: expiry('15:30') })],
    });
    await currentPending;

    expect(current.getSnapshot().attachments[0].url).toBe('current-session');
  });
});

describe('finite recovery and availability', () => {
  it.each(['empty', 'missing'])(
    'tombstone from %s dominates passive input, including after navigation; only explicit recovery restores',
    async (kind) => {
      if (kind === 'empty')
        vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: [] });
      else
        vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(
          new ApiError(404, 'MESSAGE_NOT_FOUND', 'missing'),
        );

      const current = resource();

      await current.recover(false, true);

      expect(current.getSnapshot()).toMatchObject({ attachments: [], unavailable: true });

      resource([attachment(0, { urlExpiresAt: expiry('17:00') })]);

      expect(current.getSnapshot().attachments).toEqual([]);

      await current.recover(false, true);

      expect(refreshMessageAttachments).toHaveBeenCalledOnce();

      vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: [attachment()] });

      await current.recover(true);

      expect(current.getSnapshot().unavailable).toBe(false);
      expect(current.getSnapshot().attachments).toHaveLength(1);
    },
  );

  it('makes conversation unavailable without retaining error details or capabilities', async () => {
    vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(
      new ApiError(404, 'CONVERSATION_NOT_FOUND', 'sensitive-url'),
    );
    const current = resource();

    await current.recover(true);

    expect(current.getSnapshot()).toMatchObject({ conversationUnavailable: true, attachments: [] });
    expect(JSON.stringify(current.getSnapshot())).not.toContain('sensitive-url');

    await current.recover(true);

    expect(refreshMessageAttachments).toHaveBeenCalledOnce();

    const restored = resource();

    expect(restored).not.toBe(current);
    expect(restored.getSnapshot().conversationUnavailable).toBe(false);
    expect(restored.getSnapshot().attachments).toHaveLength(1);
  });

  it.each(['failed', 'equal'])(
    'does not reuse old loaded flags or equal URLs after %s refresh',
    async (kind) => {
      const images = [attachment(0, { urlExpiresAt: expiry('15:01') })];
      const current = resource(images);
      const version = current.getSnapshot().version;

      current.loaded(version, images[0].id);

      if (kind === 'failed')
        vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('offline'));
      else vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: images });

      await current.recover(false, true);
      current.loaded(version, images[0].id);
      await current.recover(false, true);

      expect(current.getSnapshot().automaticAvailable).toBe(false);
      expect(refreshMessageAttachments).toHaveBeenCalledOnce();
    },
  );

  it('requires all siblings of a genuinely newer fresh set, ignores stale load/error, and allows a later cycle', async () => {
    const images = [attachment(), attachment(1)];
    const current = resource(images);
    const oldVersion = current.getSnapshot().version;
    vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({
      attachments: renewed(images, 30 * 60_000),
    });

    current.failed(oldVersion, images[1].id);
    await current.recover(false, true);

    const nextVersion = current.getSnapshot().version;

    current.loaded(oldVersion, images[0].id);
    current.failed(oldVersion, images[1].id);

    expect(current.getSnapshot().failed).toEqual([]);

    current.loaded(nextVersion, images[0].id);

    expect(current.getSnapshot().automaticAvailable).toBe(false);

    current.failed(nextVersion, images[1].id);
    await current.recover(false, true);

    expect(refreshMessageAttachments).toHaveBeenCalledOnce();

    // A later manual recovery must also wait for the entire next set to load.
    vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({
      attachments: renewed(images, 45 * 60_000),
    });

    await current.recover(true);

    const freshVersion = current.getSnapshot().version;

    current.loaded(freshVersion, images[0].id);
    current.loaded(freshVersion, images[1].id);

    expect(current.getSnapshot().automaticAvailable).toBe(true);
  });

  it.each([30_000, -1, NaN])(
    'does not reset for completely loaded but near/expired/invalid refreshed set: %s',
    async (lifetime) => {
      const images = [attachment(0, { urlExpiresAt: expiry('14:00') })];
      const current = resource(images);
      const next = Number.isNaN(lifetime)
        ? [attachment(0, { urlExpiresAt: 'invalid' })]
        : renewed(images, lifetime);
      vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: next });

      await current.recover(false, true);
      current.loaded(current.getSnapshot().version, images[0].id);

      expect(current.getSnapshot().automaticAvailable).toBe(false);

      await current.recover(false, true);

      expect(refreshMessageAttachments).toHaveBeenCalledOnce();
    },
  );
});
