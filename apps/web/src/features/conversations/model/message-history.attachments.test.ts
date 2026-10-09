import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { deferred } from '@/test/deferred';
import { attachment, renewed } from '@/test/fixtures/conversation-attachments';
import { historyPage, message } from '@/test/fixtures/conversations';
import { getConversationMessages, refreshMessageAttachments } from '../api/conversations-api';
import type { ConversationMessagesResponse } from './types';
import { createMessageHistory } from './message-history';

vi.mock('../api/conversations-api');
beforeEach(() => vi.resetAllMocks());

it('projects refresh into history atomically without changing message identity or pagination', async () => {
  const images = [attachment(), attachment(1)];
  const persisted = message(5, { body: 'Caption', attachments: images });
  vi.mocked(getConversationMessages).mockResolvedValueOnce(historyPage([persisted], true));
  const history = createMessageHistory('A');
  await history.loadInitial();
  const before = history.getSnapshot();
  const next = renewed(images, 30 * 60_000);
  vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: next });
  await history.attachmentResource(persisted.id).recover(true);
  expect(history.getSnapshot()).toEqual({
    ...before,
    messages: [{ ...persisted, attachments: next }],
  });
  expect(history.getSnapshot().messages[0].attachments).toBe(
    history.attachmentResource(persisted.id).getSnapshot().attachments,
  );
  history.dispose();
});

it('reconciles send success, delayed initial/older pages and catch-up through the same authority', async () => {
  const images = [attachment()];
  const newest = renewed(images, 45 * 60_000);
  const initial = deferred<ConversationMessagesResponse>();
  vi.mocked(getConversationMessages)
    .mockReturnValueOnce(initial.promise)
    .mockResolvedValueOnce(historyPage([message(5, { attachments: images })]))
    .mockResolvedValueOnce(historyPage([message(20, { attachments: images })]));
  const history = createMessageHistory('A');
  const loading = history.loadInitial();
  history.acceptSentMessage(message(5, { attachments: images }));
  history.acceptSentMessage(message(20, { attachments: images }));
  vi.mocked(refreshMessageAttachments).mockResolvedValue({ attachments: newest });
  await history.attachmentResource('message-5').recover(true);
  await history.attachmentResource('message-20').recover(true);
  initial.resolve(historyPage([message(5, { attachments: images }), message(10)], true));
  await loading;
  await history.loadOlder();
  await history.catchUp();
  history.acceptSentMessage(message(20, { attachments: images }));
  for (const id of ['message-5', 'message-20']) {
    expect(history.getSnapshot().messages.find((m) => m.id === id)?.attachments).toEqual(newest);
  }
  expect(history.getSnapshot().caughtUpThroughSequence).toBe(20);
  history.dispose();
});

it.each(['empty', 'missing'])(
  'does not resurrect a %s tombstone from delayed history, catch-up, or another mounted history',
  async (kind) => {
    const images = [attachment()];
    const oldPage = deferred<ConversationMessagesResponse>();
    vi.mocked(getConversationMessages).mockReturnValueOnce(oldPage.promise);
    const history = createMessageHistory('A');
    const loading = history.loadInitial();
    history.acceptSentMessage(message(5, { attachments: images }));
    const resource = history.attachmentResource('message-5');
    if (kind === 'empty')
      vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: [] });
    else
      vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(
        new ApiError(404, 'MESSAGE_NOT_FOUND', 'missing'),
      );
    await resource.recover(true);
    oldPage.resolve(historyPage([message(1)]));
    await loading;
    vi.mocked(getConversationMessages).mockResolvedValueOnce(
      historyPage([message(5, { attachments: renewed(images) })]),
    );
    await history.catchUp();
    expect(history.getSnapshot().messages.find((m) => m.id === 'message-5')?.attachments).toEqual(
      [],
    );
    history.dispose();
    const reopened = createMessageHistory('A');
    vi.mocked(getConversationMessages).mockResolvedValueOnce(
      historyPage([message(5, { attachments: renewed(images) })]),
    );
    await reopened.loadInitial();
    expect(reopened.getSnapshot().messages[0].attachments).toEqual([]);
    expect(reopened.attachmentResource('message-5').getSnapshot().unavailable).toBe(true);
    vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: renewed(images) });
    await reopened.attachmentResource('message-5').recover(true);
    expect(reopened.getSnapshot().messages[0].attachments).toHaveLength(1);
    reopened.dispose();
  },
);
